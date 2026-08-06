-- ============================================================
-- 085_operation_form_card_rpc.sql
--
-- create_operation_card_with_position — extracted from the
-- `create_card` branch of execute_operation_automation_action
-- (migration 081): position computed as MAX(position)+1000 INSIDE
-- the same INSERT statement (atomic, no race window) — more correct
-- than the two-round-trip version in src/lib/api/v1/cards.ts and
-- unlike src/components/operations/card-form.tsx, which doesn't
-- compute position at all and silently relies on the column default.
--
-- Used by both form-submission paths (public, via the service-role
-- client which already bypasses RLS; internal, via the caller's own
-- RLS-scoped client — SECURITY INVOKER is correct here since it
-- should run under whichever RLS context is already active, same as
-- 072/081's RPCs).
--
-- Idempotent — safe to run multiple times (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION create_operation_card_with_position(
  p_account_id UUID,
  p_board_id UUID,
  p_stage_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO operation_cards (account_id, board_id, stage_id, title, description, position)
  VALUES (
    p_account_id, p_board_id, p_stage_id, p_title, p_description,
    (SELECT COALESCE(MAX(position), 0) + 1000 FROM operation_cards WHERE stage_id = p_stage_id)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_operation_card_with_position(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
