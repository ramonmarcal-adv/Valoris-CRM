-- ============================================================
-- 065_operation_card_activity.sql
--
-- Append-only activity timeline for a Card (PRD 4.4) — molded
-- directly on flow_run_events (migration 010): only-SELECT RLS for
-- the client, every row written by a SECURITY DEFINER trigger, never
-- by direct client INSERT.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_card_activity (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id        UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN (
                   'card_created', 'stage_changed', 'assignee_changed', 'priority_changed',
                   'field_changed', 'comment_added', 'relation_added', 'relation_removed',
                   'attachment_added', 'attachment_removed', 'archived', 'unarchived'
                 )),
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_card_activity_card_created
  ON operation_card_activity(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_card_activity_card_type
  ON operation_card_activity(card_id, event_type);

ALTER TABLE operation_card_activity ENABLE ROW LEVEL SECURITY;

-- Read-only for clients — viewer+ (broad read, same tier as
-- flow_run_events). No INSERT/UPDATE/DELETE policy: only the
-- SECURITY DEFINER triggers below (and the service role) can write.
DROP POLICY IF EXISTS operation_card_activity_select ON operation_card_activity;
CREATE POLICY operation_card_activity_select ON operation_card_activity FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- operation_cards -> card_created / stage_changed / assignee_changed
-- / priority_changed / archived / unarchived.
--
-- A single UPDATE can legitimately produce more than one activity
-- row (e.g. moving stage and reassigning at once) — that's expected,
-- not a bug.
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
    VALUES (NEW.id, NEW.account_id, NEW.created_by, 'card_created',
      jsonb_build_object('title', NEW.title, 'stage_id', NEW.stage_id));
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (NEW.id, NEW.account_id, 'stage_changed',
      jsonb_build_object('from_stage_id', OLD.stage_id, 'to_stage_id', NEW.stage_id));
  END IF;

  IF NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (NEW.id, NEW.account_id, 'assignee_changed',
      jsonb_build_object('from_user_id', OLD.assigned_to_user_id, 'to_user_id', NEW.assigned_to_user_id));
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (NEW.id, NEW.account_id, 'priority_changed',
      jsonb_build_object('from_priority', OLD.priority, 'to_priority', NEW.priority));
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (NEW.id, NEW.account_id, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END, '{}'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_activity_insert ON operation_cards;
CREATE TRIGGER trg_log_operation_card_activity_insert
  AFTER INSERT ON operation_cards
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_activity();

DROP TRIGGER IF EXISTS trg_log_operation_card_activity_update ON operation_cards;
CREATE TRIGGER trg_log_operation_card_activity_update
  AFTER UPDATE ON operation_cards
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_activity();

-- ============================================================
-- operation_card_comments -> comment_added
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_comment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
  VALUES (NEW.card_id, NEW.account_id, NEW.user_id, 'comment_added',
    jsonb_build_object('comment_id', NEW.id, 'is_internal', NEW.is_internal));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_comment_activity ON operation_card_comments;
CREATE TRIGGER trg_log_operation_card_comment_activity
  AFTER INSERT ON operation_card_comments
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_comment_activity();

-- ============================================================
-- operation_card_attachments -> attachment_added / attachment_removed
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_attachment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
    VALUES (NEW.card_id, NEW.account_id, NEW.uploaded_by_user_id, 'attachment_added',
      jsonb_build_object('attachment_id', NEW.id, 'file_name', NEW.file_name));
    RETURN NEW;
  ELSE
    INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
    VALUES (OLD.card_id, OLD.account_id, 'attachment_removed',
      jsonb_build_object('attachment_id', OLD.id, 'file_name', OLD.file_name));
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_attachment_activity ON operation_card_attachments;
CREATE TRIGGER trg_log_operation_card_attachment_activity
  AFTER INSERT OR DELETE ON operation_card_attachments
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_attachment_activity();

-- ============================================================
-- operation_card_relations -> relation_added / relation_removed
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_relation_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row operation_card_relations;
  v_account_id UUID;
  v_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW;
    v_event_type := 'relation_added';
  ELSE
    v_row := OLD;
    v_event_type := 'relation_removed';
  END IF;

  SELECT account_id INTO v_account_id FROM operation_cards WHERE id = v_row.from_card_id;

  INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
  VALUES (v_row.from_card_id, v_account_id, v_row.created_by, v_event_type,
    jsonb_build_object('to_card_id', v_row.to_card_id, 'relation_type', v_row.relation_type));
  INSERT INTO operation_card_activity (card_id, account_id, actor_user_id, event_type, payload)
  VALUES (v_row.to_card_id, v_account_id, v_row.created_by, v_event_type,
    jsonb_build_object('from_card_id', v_row.from_card_id, 'relation_type', v_row.relation_type));

  RETURN v_row;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_relation_activity ON operation_card_relations;
CREATE TRIGGER trg_log_operation_card_relation_activity
  AFTER INSERT OR DELETE ON operation_card_relations
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_relation_activity();

-- ============================================================
-- operation_card_field_values -> field_changed
--
-- Fires on explicit save (INSERT/UPDATE of a value row), not on
-- every keystroke — the UI is expected to write on submit/blur, not
-- onChange. If a future field editor ends up saving on every
-- keystroke, revisit before relying on this trigger's volume.
-- ============================================================
CREATE OR REPLACE FUNCTION log_operation_card_field_value_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT account_id INTO v_account_id FROM operation_cards WHERE id = NEW.card_id;

  INSERT INTO operation_card_activity (card_id, account_id, event_type, payload)
  VALUES (NEW.card_id, v_account_id, 'field_changed',
    jsonb_build_object('field_def_id', NEW.field_def_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_operation_card_field_value_activity ON operation_card_field_values;
CREATE TRIGGER trg_log_operation_card_field_value_activity
  AFTER INSERT OR UPDATE ON operation_card_field_values
  FOR EACH ROW EXECUTE FUNCTION log_operation_card_field_value_activity();

-- ============================================================
-- REALTIME — Kanban needs live updates when another agent moves a
-- card. Same idempotent ADD TABLE pattern used 6x already in this
-- schema (e.g. 059_contacts_realtime.sql).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'operation_cards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE operation_cards;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'operation_card_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE operation_card_activity;
  END IF;
END $$;
