-- ============================================================
-- 068_operation_checklists.sql
--
-- Checklists (PRD 13) — simpler than Task: no responsible/deadline/
-- individual tracking, just text + done/not-done + an optional note.
-- Two possible scopes (PRD 12.1's task-level "checklist interno
-- opcional" and PRD 13's card-level "Checklists Operacionais"),
-- modeled as ONE table with card_id XOR task_id rather than two
-- parallel tables.
--
-- Deliberately NO account_id column, unlike operation_tasks (067).
-- operation_tasks has exactly one possible parent (card_id), so
-- denormalizing account_id there is as safe as operation_cards doing
-- it. operation_checklists has TWO possible parents — if account_id
-- were denormalized here, a buggy or malicious client could submit
-- an account_id where it's agent+ together with a card_id/task_id
-- from a DIFFERENT account, and a naive RLS policy checking only the
-- local column would miss the cross-tenant mismatch. Instead this
-- follows the established "child table with no account_id of its
-- own" pattern (pipeline_stages, operation_board_stages) — RLS
-- reaches account_id via a two-branch EXISTS (one per possible
-- parent), joined with OR.
--
-- Checklist progress is NOT persisted (no progress_percent-style
-- column) — unlike a card's task progress, nothing aggregates
-- checklist completion across many cards at once (no Dashboard
-- indicator reads it), so it's computed client-side from already-
-- loaded items. Persisting it would be pure write overhead with no
-- read-side benefit.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_checklists (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id     UUID REFERENCES operation_cards(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES operation_tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Checklist',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((card_id IS NOT NULL AND task_id IS NULL) OR (card_id IS NULL AND task_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_operation_checklists_card ON operation_checklists(card_id);
CREATE INDEX IF NOT EXISTS idx_operation_checklists_task ON operation_checklists(task_id);

ALTER TABLE operation_checklists ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_checklists;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_checklists_select ON operation_checklists;
DROP POLICY IF EXISTS operation_checklists_modify ON operation_checklists;
CREATE POLICY operation_checklists_select ON operation_checklists FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_checklists.card_id AND is_account_member(c.account_id))
  OR EXISTS (SELECT 1 FROM operation_tasks t WHERE t.id = operation_checklists.task_id AND is_account_member(t.account_id))
);
CREATE POLICY operation_checklists_modify ON operation_checklists FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_checklists.card_id AND is_account_member(c.account_id, 'agent'))
  OR EXISTS (SELECT 1 FROM operation_tasks t WHERE t.id = operation_checklists.task_id AND is_account_member(t.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_checklists.card_id AND is_account_member(c.account_id, 'agent'))
  OR EXISTS (SELECT 1 FROM operation_tasks t WHERE t.id = operation_checklists.task_id AND is_account_member(t.account_id, 'agent'))
);

-- ============================================================
-- OPERATION_CHECKLIST_ITEMS
--
-- position is fractional (a checklist can hold dozens of items,
-- unlike operation_checklists itself which holds a handful per
-- card/task and stays INTEGER-renumbered).
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_checklist_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id  UUID NOT NULL REFERENCES operation_checklists(id) ON DELETE CASCADE,
  item_text     TEXT NOT NULL,
  is_done       BOOLEAN NOT NULL DEFAULT FALSE,
  note          TEXT,
  position      DOUBLE PRECISION NOT NULL DEFAULT 1000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_checklist_items_checklist_position
  ON operation_checklist_items(checklist_id, position);

ALTER TABLE operation_checklist_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_checklist_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_checklist_items_select ON operation_checklist_items;
DROP POLICY IF EXISTS operation_checklist_items_modify ON operation_checklist_items;
CREATE POLICY operation_checklist_items_select ON operation_checklist_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM operation_checklists chk
    LEFT JOIN operation_cards c ON c.id = chk.card_id
    LEFT JOIN operation_tasks t ON t.id = chk.task_id
    WHERE chk.id = operation_checklist_items.checklist_id
      AND (is_account_member(c.account_id) OR is_account_member(t.account_id))
  )
);
CREATE POLICY operation_checklist_items_modify ON operation_checklist_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM operation_checklists chk
    LEFT JOIN operation_cards c ON c.id = chk.card_id
    LEFT JOIN operation_tasks t ON t.id = chk.task_id
    WHERE chk.id = operation_checklist_items.checklist_id
      AND (is_account_member(c.account_id, 'agent') OR is_account_member(t.account_id, 'agent'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM operation_checklists chk
    LEFT JOIN operation_cards c ON c.id = chk.card_id
    LEFT JOIN operation_tasks t ON t.id = chk.task_id
    WHERE chk.id = operation_checklist_items.checklist_id
      AND (is_account_member(c.account_id, 'agent') OR is_account_member(t.account_id, 'agent'))
  )
);
