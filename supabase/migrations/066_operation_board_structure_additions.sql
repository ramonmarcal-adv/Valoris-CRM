-- ============================================================
-- 066_operation_board_structure_additions.sql
--
-- Release B of "Operações" — additive-only structural columns that
-- the rest of Release B (Tasks, Calendar, Dashboard) depends on:
--
--   operation_board_stages.is_final — marks a stage as terminal
--     ("Aprovado", "Descartado", ...). Deliberately NO uniqueness
--     constraint (unlike is_initial) — a board can have more than
--     one terminal stage. Drives the Dashboard's "cards concluídos"
--     vs "cards ativos" split.
--
--   operation_boards.calendar_field_def_id — the board's chosen
--     date/datetime custom field to plot on the Calendar view (PRD
--     9: "campo de data selecionado do Quadro" — e.g. auction date,
--     follow-up, deadline). Reuses the field_type='date'/'datetime'
--     mechanism already in operation_card_field_defs (062) instead
--     of adding a fixed date column to operation_cards.
--
--   operation_boards.dashboard_hidden — lets a board opt out of
--     showing its Overview/Dashboard panel (PRD 11).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE operation_board_stages
  ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE operation_boards
  ADD COLUMN IF NOT EXISTS calendar_field_def_id UUID
    REFERENCES operation_card_field_defs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dashboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Validates calendar_field_def_id points at a date/datetime field
-- belonging to the SAME board — a declarative CHECK can't reach
-- across tables, so this needs a trigger (same shape as
-- validate_card_field_value in 062).
-- ============================================================
CREATE OR REPLACE FUNCTION validate_board_calendar_field_def()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board_id UUID;
  v_field_type TEXT;
BEGIN
  IF NEW.calendar_field_def_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT board_id, field_type INTO v_board_id, v_field_type
  FROM operation_card_field_defs WHERE id = NEW.calendar_field_def_id;

  IF v_board_id IS NULL THEN
    RAISE EXCEPTION 'operation_boards: calendar_field_def_id % not found', NEW.calendar_field_def_id;
  END IF;
  IF v_board_id <> NEW.id THEN
    RAISE EXCEPTION 'operation_boards: calendar_field_def_id must belong to this board';
  END IF;
  IF v_field_type NOT IN ('date', 'datetime') THEN
    RAISE EXCEPTION 'operation_boards: calendar_field_def_id must reference a date or datetime field';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_board_calendar_field_def ON operation_boards;
CREATE TRIGGER trg_validate_board_calendar_field_def
  BEFORE INSERT OR UPDATE OF calendar_field_def_id ON operation_boards
  FOR EACH ROW EXECUTE FUNCTION validate_board_calendar_field_def();
