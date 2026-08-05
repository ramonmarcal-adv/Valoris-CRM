-- ============================================================
-- 070_operation_board_indicators.sql
--
-- Configurable Dashboard indicators (PRD 11) — the user-defined
-- complement to the fixed indicators computed by
-- get_board_overview_stats (072). Each row is one indicator:
--
--   count        — number of active cards (optionally filtered to
--                  one stage via filter_stage_id).
--   sum/avg/min/max — aggregates operation_card_field_values.value_number
--                  for a chosen number/currency field (optionally
--                  filtered to one stage). field_def_id required.
--   percentage   — % of active cards sitting in filter_stage_id out
--                  of all active cards on the board. filter_stage_id
--                  required, no field involved (e.g. "what % of
--                  cards are in Aprovado" — the natural funnel-style
--                  reading of "percentual" from the PRD).
--
-- RLS is admin+ (configuring what the Dashboard shows is structural,
-- same tier as operation_card_field_defs/operation_task_templates).
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_board_indicators (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id         UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  agg_type         TEXT NOT NULL CHECK (agg_type IN ('count', 'sum', 'avg', 'min', 'max', 'percentage')),
  field_def_id     UUID REFERENCES operation_card_field_defs(id) ON DELETE CASCADE,
  filter_stage_id  UUID REFERENCES operation_board_stages(id) ON DELETE SET NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  archived_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (agg_type IN ('count', 'percentage') OR field_def_id IS NOT NULL),
  CHECK (agg_type <> 'percentage' OR filter_stage_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_operation_board_indicators_board
  ON operation_board_indicators(board_id, position);

ALTER TABLE operation_board_indicators ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_board_indicators;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_board_indicators
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_board_indicators_select ON operation_board_indicators;
DROP POLICY IF EXISTS operation_board_indicators_modify ON operation_board_indicators;
CREATE POLICY operation_board_indicators_select ON operation_board_indicators FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_indicators.board_id AND is_account_member(b.account_id))
);
CREATE POLICY operation_board_indicators_modify ON operation_board_indicators FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_indicators.board_id AND is_account_member(b.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_board_indicators.board_id AND is_account_member(b.account_id, 'admin'))
);

-- ============================================================
-- Validates field_def_id/filter_stage_id belong to the SAME board,
-- and that a sum/avg/min/max indicator's field is actually numeric —
-- none of this reachable by a declarative CHECK (needs a cross-table
-- lookup). Molded on validate_card_field_value (062).
-- ============================================================
CREATE OR REPLACE FUNCTION validate_board_indicator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field_board_id UUID;
  v_field_type TEXT;
  v_stage_board_id UUID;
BEGIN
  IF NEW.field_def_id IS NOT NULL THEN
    SELECT board_id, field_type INTO v_field_board_id, v_field_type
    FROM operation_card_field_defs WHERE id = NEW.field_def_id;

    IF v_field_board_id IS NULL THEN
      RAISE EXCEPTION 'operation_board_indicators: field_def_id % not found', NEW.field_def_id;
    END IF;
    IF v_field_board_id <> NEW.board_id THEN
      RAISE EXCEPTION 'operation_board_indicators: field_def_id must belong to this board';
    END IF;
    IF NEW.agg_type IN ('sum', 'avg', 'min', 'max') AND v_field_type NOT IN ('number', 'currency') THEN
      RAISE EXCEPTION 'operation_board_indicators: % requires a number or currency field', NEW.agg_type;
    END IF;
  END IF;

  IF NEW.filter_stage_id IS NOT NULL THEN
    SELECT board_id INTO v_stage_board_id FROM operation_board_stages WHERE id = NEW.filter_stage_id;
    IF v_stage_board_id IS NULL THEN
      RAISE EXCEPTION 'operation_board_indicators: filter_stage_id % not found', NEW.filter_stage_id;
    END IF;
    IF v_stage_board_id <> NEW.board_id THEN
      RAISE EXCEPTION 'operation_board_indicators: filter_stage_id must belong to this board';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_board_indicator ON operation_board_indicators;
CREATE TRIGGER trg_validate_board_indicator
  BEFORE INSERT OR UPDATE ON operation_board_indicators
  FOR EACH ROW EXECUTE FUNCTION validate_board_indicator();
