-- ============================================================
-- 067_operation_tasks.sql
--
-- Tasks (PRD 12) — belong to a Card, optionally one level of
-- subtasks (parent_task_id, depth-1 enforced by trigger, same
-- technique as operation_folders' enforce_operation_folder_depth).
--
-- account_id is denormalized (single possible parent — card_id — so
-- this is as safe as operation_cards/operation_card_comments
-- denormalizing it; NOT the same situation as operation_checklists
-- in 068, which has two possible parents and therefore can't safely
-- denormalize account_id without opening a cross-tenant hole).
--
-- position is fractional (DOUBLE PRECISION), partitioned per
-- (card_id, parent_task_id) — same technique as operation_cards.position
-- (migration 061) and conversations.kanban_position before it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_tasks (
  id                                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id                           UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  account_id                        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE diverges deliberately from operation_folders'
  -- parent_folder_id (RESTRICT) — deleting a parent task is expected
  -- to take its subtasks with it, same as deleting a checklist takes
  -- its items. Folders use RESTRICT because folder deletion is rare
  -- and the team wants to force moving/archiving children first;
  -- tasks are a different UX, closer to "delete this todo and its
  -- sub-todos".
  parent_task_id                    UUID REFERENCES operation_tasks(id) ON DELETE CASCADE,
  title                             TEXT NOT NULL,
  description                       TEXT,
  status                            TEXT NOT NULL DEFAULT 'todo'
                                       CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority                          TEXT NOT NULL DEFAULT 'normal'
                                       CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  start_date                        DATE,
  due_at                            TIMESTAMPTZ,
  -- Free-text "group/section" (PRD 12.1) — no precedent anywhere in
  -- the schema for structured task grouping, so this stays a plain
  -- label rather than a dedicated table.
  section                           TEXT,
  assigned_to_user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  auto_complete_when_subtasks_done  BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at                      TIMESTAMPTZ,
  completed_by_user_id              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  position                          DOUBLE PRECISION NOT NULL DEFAULT 1000,
  created_by                        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_tasks_card_parent_position
  ON operation_tasks(card_id, parent_task_id, position);
CREATE INDEX IF NOT EXISTS idx_operation_tasks_account_status_due
  ON operation_tasks(account_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_operation_tasks_due_at
  ON operation_tasks(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operation_tasks_assigned
  ON operation_tasks(assigned_to_user_id);

ALTER TABLE operation_tasks ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Operational data — agent+ writes, same tier as operation_cards.
DROP POLICY IF EXISTS operation_tasks_select ON operation_tasks;
DROP POLICY IF EXISTS operation_tasks_insert ON operation_tasks;
DROP POLICY IF EXISTS operation_tasks_update ON operation_tasks;
DROP POLICY IF EXISTS operation_tasks_delete ON operation_tasks;
CREATE POLICY operation_tasks_select ON operation_tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_tasks_insert ON operation_tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY operation_tasks_update ON operation_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY operation_tasks_delete ON operation_tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- Depth guard — max 1 level of subtask. Same shape as
-- enforce_operation_folder_depth (060), plus one check folders don't
-- need: a subtask must belong to the same card as its parent task.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_task_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_of_parent UUID;
  parent_card_id UUID;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'operation_tasks: a task cannot be its own parent';
  END IF;

  SELECT parent_task_id, card_id INTO parent_of_parent, parent_card_id
  FROM operation_tasks WHERE id = NEW.parent_task_id;

  IF parent_card_id IS NULL THEN
    RAISE EXCEPTION 'operation_tasks: parent_task_id % not found', NEW.parent_task_id;
  END IF;
  IF parent_card_id <> NEW.card_id THEN
    RAISE EXCEPTION 'operation_tasks: a subtask must belong to the same card as its parent task';
  END IF;
  IF parent_of_parent IS NOT NULL THEN
    RAISE EXCEPTION 'operation_tasks: max depth is 1 level of subtask (target parent is already a subtask)';
  END IF;

  IF EXISTS (SELECT 1 FROM operation_tasks WHERE parent_task_id = NEW.id) THEN
    RAISE EXCEPTION 'operation_tasks: cannot nest a task that already has subtasks of its own';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_task_depth ON operation_tasks;
CREATE TRIGGER trg_enforce_task_depth
  BEFORE INSERT OR UPDATE OF parent_task_id, card_id ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_task_depth();

-- ============================================================
-- Card progress (PRD 12.4): operation_cards.progress_percent, kept
-- trigger-maintained (not recalculated on every read) — same pattern
-- as conversations.last_inbound_message_at (057). Only counts
-- first-level tasks (parent_task_id IS NULL); subtasks never count
-- again toward the card's progress. 'cancelled' tasks are excluded
-- from both numerator and denominator — they count neither as
-- pending nor as done. NULL (not 0) when the card has no first-level
-- tasks at all, so AVG() in the Dashboard RPC naturally excludes
-- "no tasks yet" cards from the average instead of dragging it to 0.
--
-- SECURITY DEFINER so this never depends on the caller's own RLS/
-- UPDATE grant on operation_cards at the moment it fires. An
-- exception raised here aborts the whole INSERT/UPDATE/DELETE that
-- triggered it (visible error to the client) — deliberately NOT
-- wrapped in an exception handler, so a bug here fails loud, not
-- silently.
-- ============================================================
CREATE OR REPLACE FUNCTION recompute_card_task_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_total INTEGER;
  v_done INTEGER;
  v_progress NUMERIC;
BEGIN
  v_card_id := COALESCE(NEW.card_id, OLD.card_id);

  SELECT
    COUNT(*) FILTER (WHERE status <> 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'done')
  INTO v_total, v_done
  FROM operation_tasks
  WHERE card_id = v_card_id AND parent_task_id IS NULL;

  v_progress := CASE WHEN v_total = 0 THEN NULL ELSE ROUND(v_done::numeric / v_total * 100) END;

  UPDATE operation_cards SET progress_percent = v_progress WHERE id = v_card_id;

  -- Defensive: if a task's card_id itself changed (not a normal flow,
  -- but not impossible), recompute the old card too.
  IF TG_OP = 'UPDATE' AND OLD.card_id IS DISTINCT FROM NEW.card_id THEN
    SELECT
      COUNT(*) FILTER (WHERE status <> 'cancelled'),
      COUNT(*) FILTER (WHERE status = 'done')
    INTO v_total, v_done
    FROM operation_tasks
    WHERE card_id = OLD.card_id AND parent_task_id IS NULL;
    v_progress := CASE WHEN v_total = 0 THEN NULL ELSE ROUND(v_done::numeric / v_total * 100) END;
    UPDATE operation_cards SET progress_percent = v_progress WHERE id = OLD.card_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_card_task_progress_insert ON operation_tasks;
CREATE TRIGGER trg_recompute_card_task_progress_insert
  AFTER INSERT ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION recompute_card_task_progress();

DROP TRIGGER IF EXISTS trg_recompute_card_task_progress_update ON operation_tasks;
CREATE TRIGGER trg_recompute_card_task_progress_update
  AFTER UPDATE OF status, card_id ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION recompute_card_task_progress();

DROP TRIGGER IF EXISTS trg_recompute_card_task_progress_delete ON operation_tasks;
CREATE TRIGGER trg_recompute_card_task_progress_delete
  AFTER DELETE ON operation_tasks
  FOR EACH ROW EXECUTE FUNCTION recompute_card_task_progress();

-- ============================================================
-- Auto-complete a parent task when its last relevant subtask
-- finishes (PRD 12.5) and the parent opted in
-- (auto_complete_when_subtasks_done). Fires only on a subtask
-- transitioning INTO 'done'. Requires at least one 'done' sibling
-- (guards against auto-completing a parent whose subtasks were all
-- 'cancelled' — no real work was actually finished). Self-limiting
-- against recursion: the UPDATE this issues on the parent re-fires
-- this same trigger, but since a parent by construction always has
-- parent_task_id IS NULL (depth is capped at 1), the second firing
-- returns immediately at the first IF — no infinite loop.
-- ============================================================
CREATE OR REPLACE FUNCTION auto_complete_parent_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_status TEXT;
  v_auto_complete BOOLEAN;
  v_incomplete_siblings INTEGER;
  v_done_siblings INTEGER;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, auto_complete_when_subtasks_done INTO v_parent_status, v_auto_complete
  FROM operation_tasks WHERE id = NEW.parent_task_id;

  IF v_parent_status IS NULL OR v_parent_status = 'done' OR NOT v_auto_complete THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('done', 'cancelled')),
    COUNT(*) FILTER (WHERE status = 'done')
  INTO v_incomplete_siblings, v_done_siblings
  FROM operation_tasks WHERE parent_task_id = NEW.parent_task_id;

  IF v_incomplete_siblings = 0 AND v_done_siblings > 0 THEN
    UPDATE operation_tasks
    SET status = 'done', completed_at = NOW(), completed_by_user_id = NEW.completed_by_user_id
    WHERE id = NEW.parent_task_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_parent_task ON operation_tasks;
CREATE TRIGGER trg_auto_complete_parent_task
  AFTER UPDATE OF status ON operation_tasks
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION auto_complete_parent_task();
