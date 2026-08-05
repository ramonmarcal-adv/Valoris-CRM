-- ============================================================
-- 072_operation_board_rpcs.sql
--
-- Three RPCs for Release B. All SECURITY INVOKER — none of them
-- bypass the caller's own RLS (operation_cards/operation_tasks/
-- operation_board_indicators' own policies already scope everything
-- to account members), same convention as
-- reassign_and_delete_board_stage (061).
--
-- There's no accounts.timezone column today, so the date-sensitive
-- RPCs take p_timezone with a hardcoded default of 'America/Sao_Paulo'
-- (this product's market) — an accepted simplification for this
-- release; if a non-Brazil account ever needs this, add
-- accounts.timezone and thread it through instead of the default.
--
-- Idempotent — safe to run multiple times (CREATE OR REPLACE).
-- ============================================================

-- ============================================================
-- operation_cards.progress_percent — missing from 067, which added
-- the trigger that MAINTAINS this column (recompute_card_task_progress)
-- but never actually added the column itself. plpgsql function bodies
-- aren't validated against real columns at CREATE FUNCTION time (only
-- at execution), so 067 applied without error despite the gap — it
-- only surfaced here because get_board_overview_stats below is a
-- LANGUAGE sql function, which IS parsed/validated immediately.
-- Fixed here rather than editing 067, since 067 already applied to
-- production and migrations are append-only.
-- ============================================================
ALTER TABLE operation_cards
  ADD COLUMN IF NOT EXISTS progress_percent NUMERIC;

-- ============================================================
-- get_board_overview_stats — the fixed Dashboard indicators (PRD 11).
-- "Overdue"/"due today"/"due this week" are computed from the
-- SERVER's clock (not the browser's, unlike the app's two existing
-- client-side-aggregated dashboards) since they're clock-sensitive.
-- "Due this week" is a rolling 7-day window from today (not a
-- calendar week) — avoids the Sunday-vs-Monday start-of-week
-- ambiguity, and is a superset of "due today" by design (both are
-- useful as separate, differently-scoped stats).
-- ============================================================
CREATE OR REPLACE FUNCTION get_board_overview_stats(
  p_board_id UUID,
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS TABLE (
  active_cards BIGINT,
  completed_cards BIGINT,
  avg_progress NUMERIC,
  tasks_pending BIGINT,
  tasks_overdue BIGINT,
  tasks_due_today BIGINT,
  tasks_due_this_week BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE p_timezone) AT TIME ZONE p_timezone) AS today_start
  ),
  card_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE NOT s.is_final) AS active_cards,
      COUNT(*) FILTER (WHERE s.is_final) AS completed_cards,
      AVG(c.progress_percent) AS avg_progress
    FROM operation_cards c
    JOIN operation_board_stages s ON s.id = c.stage_id
    WHERE c.board_id = p_board_id AND c.archived_at IS NULL
  ),
  task_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE t.status IN ('todo', 'in_progress')) AS tasks_pending,
      COUNT(*) FILTER (
        WHERE t.status NOT IN ('done', 'cancelled') AND t.due_at IS NOT NULL AND t.due_at < b.today_start
      ) AS tasks_overdue,
      COUNT(*) FILTER (
        WHERE t.status NOT IN ('done', 'cancelled')
          AND t.due_at >= b.today_start AND t.due_at < b.today_start + INTERVAL '1 day'
      ) AS tasks_due_today,
      COUNT(*) FILTER (
        WHERE t.status NOT IN ('done', 'cancelled')
          AND t.due_at >= b.today_start AND t.due_at < b.today_start + INTERVAL '7 days'
      ) AS tasks_due_this_week
    FROM operation_tasks t
    JOIN operation_cards c ON c.id = t.card_id
    CROSS JOIN bounds b
    WHERE c.board_id = p_board_id AND c.archived_at IS NULL
  )
  SELECT
    card_stats.active_cards, card_stats.completed_cards, card_stats.avg_progress,
    task_stats.tasks_pending, task_stats.tasks_overdue, task_stats.tasks_due_today, task_stats.tasks_due_this_week
  FROM card_stats, task_stats;
$$;

GRANT EXECUTE ON FUNCTION get_board_overview_stats(UUID, TEXT) TO authenticated;

-- ============================================================
-- compute_board_indicator — a user-configured Dashboard indicator
-- (PRD 11's "configurável" part, on top of the fixed stats above).
-- Takes the indicator's id (not its raw agg_type/field_def_id/
-- filter_stage_id) so the caller can never submit a combination that
-- doesn't match what's actually persisted in operation_board_indicators.
-- ============================================================
CREATE OR REPLACE FUNCTION compute_board_indicator(p_indicator_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_indicator operation_board_indicators%ROWTYPE;
  v_result NUMERIC;
  v_total BIGINT;
  v_matching BIGINT;
BEGIN
  SELECT * INTO v_indicator FROM operation_board_indicators WHERE id = p_indicator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'compute_board_indicator: indicator % not found', p_indicator_id;
  END IF;

  IF v_indicator.agg_type = 'count' THEN
    SELECT COUNT(*) INTO v_result
    FROM operation_cards c
    WHERE c.board_id = v_indicator.board_id AND c.archived_at IS NULL
      AND (v_indicator.filter_stage_id IS NULL OR c.stage_id = v_indicator.filter_stage_id);

  ELSIF v_indicator.agg_type = 'percentage' THEN
    SELECT COUNT(*) FILTER (WHERE c.stage_id = v_indicator.filter_stage_id), COUNT(*)
    INTO v_matching, v_total
    FROM operation_cards c
    WHERE c.board_id = v_indicator.board_id AND c.archived_at IS NULL;
    v_result := CASE WHEN v_total = 0 THEN NULL ELSE ROUND(100.0 * v_matching / v_total, 1) END;

  ELSE -- sum / avg / min / max, over operation_card_field_values.value_number
    SELECT
      CASE v_indicator.agg_type
        WHEN 'sum' THEN SUM(v.value_number)
        WHEN 'avg' THEN AVG(v.value_number)
        WHEN 'min' THEN MIN(v.value_number)
        WHEN 'max' THEN MAX(v.value_number)
      END
    INTO v_result
    FROM operation_cards c
    JOIN operation_card_field_values v ON v.card_id = c.id AND v.field_def_id = v_indicator.field_def_id
    WHERE c.board_id = v_indicator.board_id AND c.archived_at IS NULL
      AND (v_indicator.filter_stage_id IS NULL OR c.stage_id = v_indicator.filter_stage_id);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_board_indicator(UUID) TO authenticated;

-- ============================================================
-- apply_task_template — clones a template's task (+ subtasks + its
-- internal checklist) onto a card. Independent copy, same behavioral
-- precedent as the static Flow/Automation templates (clone on apply,
-- never a live binding back to the template). Everything happens in
-- one function call = one implicit transaction — a failure partway
-- through never leaves a half-applied template on the card.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_task_template(
  p_template_id UUID,
  p_card_id UUID,
  p_prevent_duplicate BOOLEAN DEFAULT true,
  p_timezone TEXT DEFAULT 'America/Sao_Paulo'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_template operation_task_templates%ROWTYPE;
  v_card operation_cards%ROWTYPE;
  v_today_start TIMESTAMPTZ;
  v_assignee UUID;
  v_due_at TIMESTAMPTZ;
  v_task_id UUID;
  v_checklist_id UUID;
  v_subtask RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_template FROM operation_task_templates WHERE id = p_template_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_task_template: template % not found or archived', p_template_id;
  END IF;

  SELECT * INTO v_card FROM operation_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_task_template: card % not found', p_card_id;
  END IF;

  IF v_template.board_id IS NOT NULL AND v_template.board_id <> v_card.board_id THEN
    RAISE EXCEPTION 'apply_task_template: template belongs to a different board than the card';
  END IF;

  IF p_prevent_duplicate AND EXISTS (
    SELECT 1 FROM operation_tasks WHERE card_id = p_card_id AND source_template_id = p_template_id
  ) THEN
    RAISE EXCEPTION 'apply_task_template: this template was already applied to this card';
  END IF;

  v_today_start := date_trunc('day', NOW() AT TIME ZONE p_timezone) AT TIME ZONE p_timezone;

  v_assignee := CASE v_template.default_assignee_mode
    WHEN 'specific_user' THEN v_template.default_assignee_user_id
    WHEN 'card_assignee' THEN v_card.assigned_to_user_id
    ELSE NULL
  END;

  v_due_at := CASE WHEN v_template.default_due_offset_days IS NOT NULL
    THEN v_today_start + (v_template.default_due_offset_days || ' days')::interval
           + INTERVAL '1 day' - INTERVAL '1 second' -- end of that day, local time
    ELSE NULL
  END;

  INSERT INTO operation_tasks (
    card_id, account_id, title, description, priority, section, assigned_to_user_id, due_at, source_template_id
  ) VALUES (
    p_card_id, v_card.account_id, v_template.name, v_template.description, v_template.default_priority,
    v_template.default_section, v_assignee, v_due_at, p_template_id
  ) RETURNING id INTO v_task_id;

  FOR v_subtask IN
    SELECT * FROM operation_task_template_subtasks WHERE template_id = p_template_id ORDER BY position
  LOOP
    INSERT INTO operation_tasks (
      card_id, account_id, parent_task_id, title, description, priority, due_at, source_template_id
    ) VALUES (
      p_card_id, v_card.account_id, v_task_id, v_subtask.title, v_subtask.description, v_subtask.default_priority,
      CASE WHEN v_subtask.default_due_offset_days IS NOT NULL
        THEN v_today_start + (v_subtask.default_due_offset_days || ' days')::interval
               + INTERVAL '1 day' - INTERVAL '1 second'
        ELSE NULL
      END,
      p_template_id
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM operation_task_template_checklist_items WHERE template_id = p_template_id) THEN
    INSERT INTO operation_checklists (task_id, title)
    VALUES (v_task_id, 'Checklist')
    RETURNING id INTO v_checklist_id;

    FOR v_item IN
      SELECT * FROM operation_task_template_checklist_items WHERE template_id = p_template_id ORDER BY position
    LOOP
      INSERT INTO operation_checklist_items (checklist_id, item_text)
      VALUES (v_checklist_id, v_item.item_text);
    END LOOP;
  END IF;

  RETURN v_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_task_template(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
