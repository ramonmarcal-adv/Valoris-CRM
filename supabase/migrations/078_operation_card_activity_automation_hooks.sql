-- ============================================================
-- 078_operation_card_activity_automation_hooks.sql
--
-- Extends operation_card_activity to double as the automation dispatch
-- source (see 080): three new event_types closing the gaps identified
-- against PRD 16.3 (tag add/remove, checklist added had no trigger
-- yet), plus chain_depth for loop protection.
--
-- chain_depth is stamped by a single generic BEFORE INSERT trigger on
-- operation_card_activity itself, reading a session GUC
-- (app.automation_chain_depth) — NOT by editing each of the six
-- existing/new logging trigger functions individually. Whatever sets
-- that GUC (081's execute_operation_automation_action, via
-- set_config) has it picked up automatically no matter which trigger
-- produced the activity row. Outside of an automation-driven write the
-- GUC is unset and this defaults to 0 (ordinary user actions).
--
-- Same DROP/ADD CONSTRAINT pattern as 071 — the constraint name below
-- was made explicit by 071's own ADD CONSTRAINT (it's no longer an
-- auto-generated name at risk of drifting).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE operation_card_activity
  DROP CONSTRAINT IF EXISTS operation_card_activity_event_type_check;
ALTER TABLE operation_card_activity
  ADD CONSTRAINT operation_card_activity_event_type_check
  CHECK (event_type IN (
    'card_created', 'stage_changed', 'assignee_changed', 'priority_changed',
    'field_changed', 'comment_added', 'relation_added', 'relation_removed',
    'attachment_added', 'attachment_removed', 'archived', 'unarchived',
    'task_created', 'task_completed', 'task_reopened', 'task_assignee_changed',
    'task_deleted', 'checklist_item_toggled',
    'tag_added', 'tag_removed', 'checklist_added'
  ));

ALTER TABLE operation_card_activity
  ADD COLUMN IF NOT EXISTS chain_depth INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_operation_card_activity_chain_depth
  ON operation_card_activity(chain_depth) WHERE chain_depth > 0;

CREATE OR REPLACE FUNCTION stamp_operation_card_activity_chain_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.chain_depth := COALESCE(NULLIF(current_setting('app.automation_chain_depth', true), '')::INTEGER, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_operation_card_activity_chain_depth ON operation_card_activity;
CREATE TRIGGER trg_stamp_operation_card_activity_chain_depth
  BEFORE INSERT ON operation_card_activity
  FOR EACH ROW EXECUTE FUNCTION stamp_operation_card_activity_chain_depth();

-- ============================================================
-- operation_card_tags -> tag_added / tag_removed
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_tag_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row operation_card_tags;
  v_account_id UUID;
  v_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_event_type := 'tag_added';
  ELSE
    v_row := OLD;
    v_event_type := 'tag_removed';
  END IF;

  SELECT account_id INTO v_account_id FROM operation_cards WHERE id = v_row.card_id;

  INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
  VALUES (v_row.card_id, v_account_id, v_event_type, jsonb_build_object('tag_id', v_row.tag_id));

  RETURN v_row;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_tag_activity ON operation_card_tags;
CREATE TRIGGER trg_log_operation_card_tag_activity
  AFTER INSERT OR DELETE ON operation_card_tags
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_tag_activity();

-- ============================================================
-- operation_checklists -> checklist_added
--
-- card_id resolves via a simple IF/ELSE on the XOR card_id/task_id
-- (068), unlike 071's checklist_item trigger which had to COALESCE
-- across a checklist_id lookup — here we already have NEW.card_id/
-- NEW.task_id directly since this fires on operation_checklists
-- itself.
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_checklist_created_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_account_id UUID;
BEGIN
  IF NEW.card_id IS NOT NULL THEN
    v_card_id := NEW.card_id;
    SELECT account_id INTO v_account_id FROM operation_cards WHERE id = v_card_id;
  ELSE
    SELECT c.id, c.account_id INTO v_card_id, v_account_id
    FROM operation_tasks tk JOIN operation_cards c ON c.id = tk.card_id
    WHERE tk.id = NEW.task_id;
  END IF;

  IF v_card_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
  VALUES (v_card_id, v_account_id, NEW.created_by, 'checklist_added',
    jsonb_build_object('checklist_id', NEW.id, 'title', NEW.title, 'task_id', NEW.task_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_checklist_created_activity ON operation_checklists;
CREATE TRIGGER trg_log_operation_checklist_created_activity
  AFTER INSERT ON operation_checklists
  FOR EACH ROW EXECUTE FUNCTION log_operation_checklist_created_activity();
