-- ============================================================
-- 081_operation_automation_action_rpc.sql
--
-- execute_operation_automation_action — all 14 real actions (PRD
-- 16.5) implemented as ONE plpgsql function rather than 14 separate
-- TS-side .update()/.insert() calls. This is required, not just
-- tidier: chain-depth tracking (078's chain_depth column, stamped
-- from the app.automation_chain_depth GUC) only works race-free if
-- set_config() and the actual write happen in the SAME transaction —
-- across separate PostgREST calls from the TS engine there'd be a
-- real race between "mark the depth" and the write's own
-- operation_card_activity trigger firing (and, via 080, an instant
-- pg_net dispatch of a CHILD event that could arrive before the depth
-- was stamped). One function call = one implicit transaction closes
-- that race entirely.
--
-- 'wait' is deliberately NOT a branch here — it's handled by the TS
-- engine directly inserting into operation_automation_pending_executions
-- (076), since suspending mid-automation isn't a "write to Operations
-- data" the way the other 14 actions are.
--
-- SECURITY INVOKER intentionally: the dispatch/resume/sweep routes
-- call this via the service-role client (bypassing RLS at the
-- PostgREST layer already, same as the existing Deal/Conversation
-- engine's admin client), so DEFINER privilege escalation isn't
-- needed — this just needs to run in the caller's existing
-- transaction so set_config(..., true) (session/transaction-local)
-- actually reaches the operation_card_activity triggers fired by the
-- writes below.
--
-- Idempotent — safe to run multiple times (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION execute_operation_automation_action(
  p_step_type TEXT,
  p_step_config JSONB,
  p_card_id UUID,
  p_chain_depth INTEGER,
  p_context JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_card_assignee UUID;
  v_target_board_id UUID;
  v_target_stage_id UUID;
  v_to_card_id UUID;
  v_new_id UUID;
  v_detail TEXT;
  v_context JSONB := p_context;
BEGIN
  IF p_step_type = 'wait' THEN
    RAISE EXCEPTION 'execute_operation_automation_action: wait must be handled by the caller, not this function';
  END IF;

  -- Transaction-local (mirrors SET LOCAL) — read back by
  -- stamp_operation_card_activity_chain_depth() (078) on every
  -- operation_card_activity row this action's write goes on to create.
  PERFORM set_config('app.automation_chain_depth', p_chain_depth::text, true);

  CASE p_step_type
    WHEN 'move_card' THEN
      UPDATE operation_cards SET
        stage_id = (p_step_config->>'stage_id')::uuid,
        position = COALESCE(
          (p_step_config->>'position')::double precision,
          (SELECT COALESCE(MAX(position), 0) + 1000 FROM operation_cards WHERE stage_id = (p_step_config->>'stage_id')::uuid)
        )
      WHERE id = p_card_id;
      v_detail := 'moved to stage ' || (p_step_config->>'stage_id');

    WHEN 'change_field' THEN
      INSERT INTO operation_card_field_values (
        card_id, field_def_id, value_text, value_number, value_date, value_boolean, value_uuid, value_multi_select, long_text
      ) VALUES (
        p_card_id, (p_step_config->>'field_def_id')::uuid,
        p_step_config->>'value_text',
        (p_step_config->>'value_number')::numeric,
        (p_step_config->>'value_date')::timestamptz,
        (p_step_config->>'value_boolean')::boolean,
        NULLIF(p_step_config->>'value_uuid', '')::uuid,
        CASE WHEN p_step_config ? 'value_multi_select'
          THEN ARRAY(SELECT jsonb_array_elements_text(p_step_config->'value_multi_select'))
          ELSE NULL END,
        p_step_config->>'long_text'
      )
      ON CONFLICT (card_id, field_def_id) DO UPDATE SET
        value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number, value_date = EXCLUDED.value_date,
        value_boolean = EXCLUDED.value_boolean, value_uuid = EXCLUDED.value_uuid,
        value_multi_select = EXCLUDED.value_multi_select, long_text = EXCLUDED.long_text;
      v_detail := 'field ' || (p_step_config->>'field_def_id') || ' updated';

    WHEN 'change_priority' THEN
      UPDATE operation_cards SET priority = p_step_config->>'priority' WHERE id = p_card_id;
      v_detail := 'priority set to ' || (p_step_config->>'priority');

    WHEN 'assign_card' THEN
      UPDATE operation_cards SET assigned_to_user_id = NULLIF(p_step_config->>'user_id', '')::uuid WHERE id = p_card_id;
      v_detail := 'assignee set';

    WHEN 'add_card_tag' THEN
      INSERT INTO operation_card_tags (card_id, tag_id)
      VALUES (p_card_id, (p_step_config->>'tag_id')::uuid)
      ON CONFLICT (card_id, tag_id) DO NOTHING;
      v_detail := 'tag added';

    WHEN 'remove_card_tag' THEN
      DELETE FROM operation_card_tags WHERE card_id = p_card_id AND tag_id = (p_step_config->>'tag_id')::uuid;
      v_detail := 'tag removed';

    WHEN 'create_task' THEN
      SELECT account_id, assigned_to_user_id INTO v_account_id, v_card_assignee FROM operation_cards WHERE id = p_card_id;
      INSERT INTO operation_tasks (card_id, account_id, title, description, priority, assigned_to_user_id, due_at)
      VALUES (
        p_card_id, v_account_id, p_step_config->>'title', p_step_config->>'description',
        COALESCE(p_step_config->>'priority', 'normal'),
        CASE p_step_config->>'assignee_mode'
          WHEN 'specific_user' THEN NULLIF(p_step_config->>'assignee_user_id', '')::uuid
          WHEN 'card_assignee' THEN v_card_assignee
          ELSE NULL
        END,
        CASE WHEN p_step_config ? 'due_offset_days'
          THEN NOW() + ((p_step_config->>'due_offset_days')::int || ' days')::interval
          ELSE NULL END
      ) RETURNING id INTO v_new_id;
      v_detail := 'task created: ' || v_new_id;

    WHEN 'apply_task_template' THEN
      PERFORM apply_task_template(
        (p_step_config->>'template_id')::uuid, p_card_id,
        COALESCE((p_step_config->>'prevent_duplicate')::boolean, true)
      );
      v_detail := 'task template applied';

    WHEN 'add_checklist' THEN
      INSERT INTO operation_checklists (card_id, title)
      VALUES (p_card_id, COALESCE(p_step_config->>'title', 'Checklist'))
      RETURNING id INTO v_new_id;
      INSERT INTO operation_checklist_items (checklist_id, item_text, position)
      SELECT v_new_id, item, (ord - 1) * 1000
      FROM jsonb_array_elements_text(COALESCE(p_step_config->'items', '[]'::jsonb)) WITH ORDINALITY AS t(item, ord);
      v_detail := 'checklist added: ' || v_new_id;

    WHEN 'apply_checklist_template' THEN
      PERFORM apply_checklist_template((p_step_config->>'template_id')::uuid, p_card_id, NULL);
      v_detail := 'checklist template applied';

    WHEN 'add_comment' THEN
      SELECT account_id INTO v_account_id FROM operation_cards WHERE id = p_card_id;
      INSERT INTO operation_card_comments (card_id, account_id, comment_text, is_internal)
      VALUES (p_card_id, v_account_id, p_step_config->>'text', true);
      v_detail := 'comment added';

    WHEN 'create_card' THEN
      v_target_board_id := COALESCE(
        NULLIF(p_step_config->>'target_board_id', '')::uuid,
        (SELECT board_id FROM operation_cards WHERE id = p_card_id)
      );
      v_target_stage_id := COALESCE(
        NULLIF(p_step_config->>'stage_id', '')::uuid,
        (SELECT id FROM operation_board_stages WHERE board_id = v_target_board_id AND is_initial LIMIT 1)
      );
      SELECT account_id INTO v_account_id FROM operation_boards WHERE id = v_target_board_id;
      INSERT INTO operation_cards (account_id, board_id, stage_id, title, description, position)
      VALUES (
        v_account_id, v_target_board_id, v_target_stage_id, p_step_config->>'title', p_step_config->>'description',
        (SELECT COALESCE(MAX(position), 0) + 1000 FROM operation_cards WHERE stage_id = v_target_stage_id)
      ) RETURNING id INTO v_new_id;
      v_context := jsonb_set(v_context, '{_last_created_card_id}', to_jsonb(v_new_id::text));
      v_detail := 'card created: ' || v_new_id;

    WHEN 'relate_cards' THEN
      v_to_card_id := COALESCE(NULLIF(p_step_config->>'to_card_id', '')::uuid, NULLIF(v_context->>'_last_created_card_id', '')::uuid);
      IF v_to_card_id IS NULL THEN
        RAISE EXCEPTION 'execute_operation_automation_action: relate_cards has no target card (no to_card_id and no prior create_card in this run)';
      END IF;
      INSERT INTO operation_card_relations (from_card_id, to_card_id, relation_type)
      VALUES (p_card_id, v_to_card_id, COALESCE(p_step_config->>'relation_type', 'related'))
      ON CONFLICT (from_card_id, to_card_id, relation_type) DO NOTHING;
      v_detail := 'related to ' || v_to_card_id;

    WHEN 'archive_card' THEN
      UPDATE operation_cards SET archived_at = NOW() WHERE id = p_card_id;
      v_detail := 'card archived';

    ELSE
      RAISE EXCEPTION 'execute_operation_automation_action: unknown step_type %', p_step_type;
  END CASE;

  RETURN jsonb_build_object('status', 'success', 'detail', v_detail, 'context', v_context);
END;
$$;

GRANT EXECUTE ON FUNCTION execute_operation_automation_action(TEXT, JSONB, UUID, INTEGER, JSONB) TO authenticated;

-- ============================================================
-- Sweep-support RPCs for time-sweep-cron. Both SECURITY INVOKER,
-- p_timezone DEFAULT 'America/Sao_Paulo' — same convention as 072.
-- Return raw candidates; time-sweep-cron itself (app layer) does the
-- operation_automation_fires dedup insert before executing anything,
-- so these stay pure read queries.
-- ============================================================

-- date_reached / days_before_date / days_after_date: compares a
-- date/datetime custom field (trigger_config.field_def_id) against
-- CURRENT_DATE +/- trigger_config.days.
CREATE OR REPLACE FUNCTION get_operation_date_trigger_candidates(
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS TABLE (automation_id UUID, card_id UUID, fired_for_key TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH today AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE p_timezone) AT TIME ZONE p_timezone)::date AS today_date
  )
  SELECT a.id, v.card_id, v.value_date::date::text
  FROM operation_automations a
  JOIN operation_card_field_values v ON v.field_def_id = (a.trigger_config->>'field_def_id')::uuid
  JOIN operation_cards c ON c.id = v.card_id AND c.archived_at IS NULL
  CROSS JOIN today
  WHERE a.is_active = true
    AND (
      (a.trigger_type = 'date_reached' AND v.value_date::date = today.today_date)
      OR (a.trigger_type = 'days_before_date'
          AND v.value_date::date = (today.today_date + ((a.trigger_config->>'days')::int || ' days')::interval)::date)
      OR (a.trigger_type = 'days_after_date'
          AND v.value_date::date = (today.today_date - ((a.trigger_config->>'days')::int || ' days')::interval)::date)
    );
$$;

GRANT EXECUTE ON FUNCTION get_operation_date_trigger_candidates(TEXT) TO authenticated;

-- card_stuck_in_stage_days: cards that have been in their current
-- stage for at least trigger_config.days, matched to an active
-- automation on that same stage.
CREATE OR REPLACE FUNCTION get_operation_stuck_stage_candidates(
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS TABLE (automation_id UUID, card_id UUID, fired_for_key TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, c.id, c.stage_entered_at::text
  FROM operation_automations a
  JOIN operation_cards c
    ON c.board_id = a.board_id
   AND c.stage_id = (a.trigger_config->>'stage_id')::uuid
   AND c.archived_at IS NULL
  WHERE a.is_active = true
    AND a.trigger_type = 'card_stuck_in_stage_days'
    AND c.stage_entered_at <= NOW() - ((a.trigger_config->>'days')::int || ' days')::interval;
$$;

GRANT EXECUTE ON FUNCTION get_operation_stuck_stage_candidates(TEXT) TO authenticated;
