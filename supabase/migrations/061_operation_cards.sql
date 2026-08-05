-- ============================================================
-- 061_operation_cards.sql
--
-- The Card itself — the generic "workspace" entity of Operações
-- (PRD 4.1). Kept lean on purpose (PRD 29.4): only the fields every
-- card needs regardless of board. Board-specific data lives in
-- operation_card_field_defs/values (migration 062).
--
-- account_id is denormalized (derivable via board_id → account_id)
-- for the same reason `deals`/`contacts` carry it directly rather
-- than joining through their parent every time: RLS stays a single
-- column comparison, and "list my account's cards" stays a cheap
-- index scan instead of a join.
--
-- position is fractional (DOUBLE PRECISION), partitioned per
-- (board_id, stage_id) — same technique as conversations.kanban_position
-- (migration 056): a reorder only rewrites the ONE row moved, unlike
-- the integer-renumber used for stages. Cards per stage can run into
-- the hundreds on a real board, where full-renumber-on-every-drag
-- would be the wrong tradeoff.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_cards (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id             UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  stage_id             UUID NOT NULL REFERENCES operation_board_stages(id) ON DELETE RESTRICT,
  title                TEXT NOT NULL,
  description          TEXT,
  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  position             DOUBLE PRECISION NOT NULL DEFAULT 1000,
  assigned_to_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at          TIMESTAMPTZ,
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kanban column fetch: all cards in one stage, in display order.
CREATE INDEX IF NOT EXISTS idx_operation_cards_board_stage_position
  ON operation_cards(board_id, stage_id, position);

-- List/dashboard scans across a whole account, excluding archived by default.
CREATE INDEX IF NOT EXISTS idx_operation_cards_account_archived
  ON operation_cards(account_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_operation_cards_assigned_to
  ON operation_cards(assigned_to_user_id);

ALTER TABLE operation_cards ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_cards;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Operational data — agent+ writes, same tier as deals/contacts.
DROP POLICY IF EXISTS operation_cards_select ON operation_cards;
DROP POLICY IF EXISTS operation_cards_insert ON operation_cards;
DROP POLICY IF EXISTS operation_cards_update ON operation_cards;
DROP POLICY IF EXISTS operation_cards_delete ON operation_cards;
CREATE POLICY operation_cards_select ON operation_cards FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_cards_insert ON operation_cards FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY operation_cards_update ON operation_cards FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY operation_cards_delete ON operation_cards FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- Mandatory reallocation when a Stage is deleted (PRD 7.2).
--
-- SECURITY INVOKER (not DEFINER) — runs with the CALLER's RLS, so no
-- privilege is bypassed: the caller still needs agent+ on the board
-- to move operation_cards and to delete operation_board_stages.
-- Everything happens inside one function call = one implicit
-- transaction, so no other card can land in the old stage between
-- the UPDATE and the DELETE.
--
-- Archiving a stage (archived_at) does NOT go through this function
-- and does NOT require reallocation — it only hides the stage from
-- the active board and blocks new cards from entering it. Only a
-- real DELETE of the stage row requires reallocation.
-- ============================================================
CREATE OR REPLACE FUNCTION reassign_and_delete_board_stage(
  p_old_stage_id UUID,
  p_target_stage_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_board_id UUID;
  v_target_board_id UUID;
  v_target_archived BOOLEAN;
  v_next_position DOUBLE PRECISION;
BEGIN
  IF p_old_stage_id = p_target_stage_id THEN
    RAISE EXCEPTION 'reassign_and_delete_board_stage: target stage must differ from the stage being deleted';
  END IF;

  SELECT board_id INTO v_old_board_id FROM operation_board_stages WHERE id = p_old_stage_id;
  SELECT board_id, archived_at IS NOT NULL INTO v_target_board_id, v_target_archived
  FROM operation_board_stages WHERE id = p_target_stage_id;

  IF v_old_board_id IS NULL THEN
    RAISE EXCEPTION 'reassign_and_delete_board_stage: stage % not found', p_old_stage_id;
  END IF;
  IF v_target_board_id IS NULL THEN
    RAISE EXCEPTION 'reassign_and_delete_board_stage: target stage % not found', p_target_stage_id;
  END IF;
  IF v_old_board_id <> v_target_board_id THEN
    RAISE EXCEPTION 'reassign_and_delete_board_stage: target stage must belong to the same board';
  END IF;
  IF v_target_archived THEN
    RAISE EXCEPTION 'reassign_and_delete_board_stage: target stage is archived';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1000 INTO v_next_position
  FROM operation_cards WHERE stage_id = p_target_stage_id;

  -- Window functions can't appear directly in an UPDATE ... SET
  -- clause, so the new positions are computed in a CTE first and
  -- joined back via UPDATE ... FROM.
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn
    FROM operation_cards
    WHERE stage_id = p_old_stage_id
  )
  UPDATE operation_cards oc
  SET stage_id = p_target_stage_id,
      position = v_next_position + (ranked.rn - 1) * 1000
  FROM ranked
  WHERE oc.id = ranked.id;

  DELETE FROM operation_board_stages WHERE id = p_old_stage_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reassign_and_delete_board_stage(UUID, UUID) TO authenticated;
