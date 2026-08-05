-- ============================================================
-- 071_operation_card_activity_extension.sql
--
-- Extends operation_card_activity's event_type CHECK with task/
-- checklist events, and adds the triggers that log them — same
-- append-only, trigger-only-write shape as 065.
--
-- No dedicated 'template_applied' event — a task created from a
-- template already logs as 'task_created' with source_template_id in
-- the payload, so apply_task_template (072) doesn't need to become
-- SECURITY DEFINER just to write here.
--
-- NOT idempotent in the usual "ADD COLUMN IF NOT EXISTS" sense — a
-- CHECK constraint has no "ADD CONSTRAINT IF NOT EXISTS" form in
-- Postgres, so this uses the DROP-then-ADD pattern instead. The
-- constraint name below was confirmed against the production
-- database (`operation_card_activity_event_type_check`, the name
-- Postgres auto-generated for the unnamed inline CHECK in 065) —
-- if this migration is ever replayed against a database where that
-- name differs, the DROP is a silent no-op and the ADD fails on a
-- duplicate constraint. Verify the name first if that ever happens.
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
    'task_deleted', 'checklist_item_toggled'
  ));

-- ============================================================
-- operation_tasks -> task_created / task_completed / task_reopened /
-- task_assignee_changed / task_deleted
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
    VALUES (NEW.card_id, NEW.account_id, NEW.created_by, 'task_created',
      jsonb_build_object('task_id', NEW.id, 'title', NEW.title, 'parent_task_id', NEW.parent_task_id,
        'source_template_id', NEW.source_template_id));
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (OLD.card_id, OLD.account_id, 'task_deleted',
      jsonb_build_object('task_id', OLD.id, 'title', OLD.title));
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'done' THEN
      INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
      VALUES (NEW.card_id, NEW.account_id, NEW.completed_by_user_id, 'task_completed',
        jsonb_build_object('task_id', NEW.id, 'title', NEW.title));
    ELSIF OLD.status = 'done' THEN
      INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
      VALUES (NEW.card_id, NEW.account_id, 'task_reopened',
        jsonb_build_object('task_id', NEW.id, 'title', NEW.title));
    END IF;
  END IF;

  IF NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (NEW.card_id, NEW.account_id, 'task_assignee_changed',
      jsonb_build_object('task_id', NEW.id, 'from_user_id', OLD.assigned_to_user_id, 'to_user_id', NEW.assigned_to_user_id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_task_activity_insert ON operation_tasks;
CREATE TRIGGER trg_log_operation_task_activity_insert
  AFTER INSERT ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION log_operation_task_activity();

DROP TRIGGER IF EXISTS trg_log_operation_task_activity_update ON operation_tasks;
CREATE TRIGGER trg_log_operation_task_activity_update
  AFTER UPDATE ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION log_operation_task_activity();

DROP TRIGGER IF EXISTS trg_log_operation_task_activity_delete ON operation_tasks;
CREATE TRIGGER trg_log_operation_task_activity_delete
  AFTER DELETE ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION log_operation_task_activity();

-- ============================================================
-- operation_checklist_items -> checklist_item_toggled
--
-- card_id needs resolving across TWO possible hops (checklist->card
-- direct, or checklist->task->card) — every trigger in 065 only ever
-- had one hop, so this is new shape, not a copy-paste of an existing
-- trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_checklist_item_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_account_id UUID;
BEGIN
  SELECT COALESCE(chk.card_id, tk.card_id), COALESCE(c1.account_id, c2.account_id)
  INTO v_card_id, v_account_id
  FROM operation_checklists chk
  LEFT JOIN operation_tasks tk ON tk.id = chk.task_id
  LEFT JOIN operation_cards c1 ON c1.id = chk.card_id
  LEFT JOIN operation_cards c2 ON c2.id = tk.card_id
  WHERE chk.id = NEW.checklist_id;

  IF v_card_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
  VALUES (v_card_id, v_account_id, 'checklist_item_toggled',
    jsonb_build_object('checklist_id', NEW.checklist_id, 'item_id', NEW.id, 'is_done', NEW.is_done));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_checklist_item_activity ON operation_checklist_items;
CREATE TRIGGER trg_log_operation_checklist_item_activity
  AFTER UPDATE OF is_done ON operation_checklist_items
  FOR EACH ROW EXECUTE FUNCTION log_operation_checklist_item_activity();
