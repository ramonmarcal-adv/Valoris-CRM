-- ============================================================
-- 060_operation_folders_boards_stages.sql
--
-- Release A of "Operações" (LeilãoDesk PRD) — the flexible
-- Folder → Board → Stage → Card module that sits ALONGSIDE the
-- legacy Pipeline/Deal module (pipelines/pipeline_stages/deals),
-- untouched by this migration. This file creates the top three
-- levels of the hierarchy: Folders (max 1 level of subfolder),
-- Boards (a board may live directly under the account, folder_id is
-- nullable — confirmed decision, boards don't require a folder) and
-- Board Stages (per-board phases/columns).
--
-- RLS tier follows the `conversation_board_columns` precedent
-- (migration 057): agent+ writes, not admin+ like the legacy
-- `pipelines`/`pipeline_stages` — Folders/Boards/Stages are treated
-- as an everyday working tool, not account configuration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- OPERATION_FOLDERS
--
-- parent_folder_id is a self-FK. Depth is capped at 1 level of
-- subfolder by the trigger below — a CHECK constraint can't do this
-- (no self-join in a CHECK), so it has to be enforced procedurally.
-- ON DELETE RESTRICT on the self-FK: everything here is soft-deleted
-- via archived_at, so a real DELETE should never silently cascade
-- into child folders — force the operator to move/archive children
-- first.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_folders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  parent_folder_id  UUID REFERENCES operation_folders(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  archived_at       TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_folders_account
  ON operation_folders(account_id, parent_folder_id, position);

ALTER TABLE operation_folders ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_folders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_folders_select ON operation_folders;
DROP POLICY IF EXISTS operation_folders_modify ON operation_folders;
CREATE POLICY operation_folders_select ON operation_folders FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_folders_modify ON operation_folders FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- Depth guard — max 1 level of subfolder.
--
-- Rejects two situations:
--   1. Inserting/reparenting a folder UNDER a folder that already has
--      a non-null parent_folder_id itself (would create a 3rd level).
--   2. Reparenting a folder that already HAS CHILDREN of its own into
--      another folder (would create a 3rd level via the children,
--      even though the folder being moved itself has no parent yet).
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_operation_folder_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_of_parent UUID;
BEGIN
  IF NEW.parent_folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_folder_id = NEW.id THEN
    RAISE EXCEPTION 'operation_folders: a folder cannot be its own parent';
  END IF;

  SELECT parent_folder_id INTO parent_of_parent
  FROM operation_folders WHERE id = NEW.parent_folder_id;

  IF parent_of_parent IS NOT NULL THEN
    RAISE EXCEPTION 'operation_folders: max depth is 1 level of subfolder (target parent is already a subfolder)';
  END IF;

  IF EXISTS (SELECT 1 FROM operation_folders WHERE parent_folder_id = NEW.id) THEN
    RAISE EXCEPTION 'operation_folders: cannot nest a folder that already has subfolders of its own';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_operation_folder_depth ON operation_folders;
CREATE TRIGGER trg_enforce_operation_folder_depth
  BEFORE INSERT OR UPDATE OF parent_folder_id ON operation_folders
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_folder_depth();

-- ============================================================
-- OPERATION_BOARDS
--
-- folder_id is NULLABLE — a board may exist at the account root
-- without being organized into a folder first (confirmed decision,
-- lower friction than forcing Pasta→Quadro on every board).
--
-- card_label_singular / card_label_plural let each board define its
-- own semantic name for its cards (PRD 3.4: "Cliente/Clientes",
-- "Imóvel/Imóveis", ...).
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_boards (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id            UUID REFERENCES operation_folders(id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  card_label_singular  TEXT NOT NULL DEFAULT 'Card',
  card_label_plural    TEXT NOT NULL DEFAULT 'Cards',
  color                TEXT NOT NULL DEFAULT '#3b82f6',
  position             INTEGER NOT NULL DEFAULT 0,
  archived_at          TIMESTAMPTZ,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_boards_account
  ON operation_boards(account_id, folder_id, position);

ALTER TABLE operation_boards ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_boards;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_boards_select ON operation_boards;
DROP POLICY IF EXISTS operation_boards_modify ON operation_boards;
CREATE POLICY operation_boards_select ON operation_boards FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_boards_modify ON operation_boards FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- OPERATION_BOARD_STAGES
--
-- Position is a plain INTEGER, renumbered in full on every reorder
-- save — not the fractional technique used for cards below. Stages
-- per board are few (a handful), same reasoning as pipeline_stages
-- and conversation_board_columns: a full renumber of a short list on
-- an infrequent action is cheap and keeps position values readable
-- in Supabase Studio.
--
-- is_initial marks the stage new cards land in by default. The
-- partial unique index mirrors conversation_board_columns'
-- is_default_for_leads/is_default_for_groups pattern (migration 057).
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_board_stages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id     UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#3b82f6',
  position     INTEGER NOT NULL DEFAULT 0,
  is_initial   BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_board_stages_board
  ON operation_board_stages(board_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_board_stages_one_initial
  ON operation_board_stages(board_id) WHERE is_initial;

ALTER TABLE operation_board_stages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_board_stages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_board_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Child table, no own account_id — reached via the parent board join,
-- same shape as pipeline_stages_select/modify (017).
DROP POLICY IF EXISTS operation_board_stages_select ON operation_board_stages;
DROP POLICY IF EXISTS operation_board_stages_modify ON operation_board_stages;
CREATE POLICY operation_board_stages_select ON operation_board_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_stages.board_id AND is_account_member(b.account_id))
);
CREATE POLICY operation_board_stages_modify ON operation_board_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_stages.board_id AND is_account_member(b.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_stages.board_id AND is_account_member(b.account_id, 'agent'))
);
