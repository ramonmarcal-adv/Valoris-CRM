-- ============================================================
-- 077_operation_stage_time_triggers.sql
--
-- Support for the two time-based triggers that can't come from
-- operation_card_activity (they're about the passage of time, not a
-- write): 'card_stuck_in_stage_days' needs to know how long a card has
-- sat in its current stage, and every time-based trigger needs a way
-- to avoid re-firing on the same card every sweep tick.
--
-- stage_entered_at follows the same "column maintained by trigger, not
-- recomputed on read" precedent as operation_cards.progress_percent
-- (067/072). Backfill approximates existing cards' stage_entered_at as
-- their created_at — the exact moment they entered their CURRENT stage
-- isn't recoverable without expensive backscanning of activity history;
-- accepted, same spirit as Release B's fixed-timezone and rolling-week
-- approximations.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'operation_cards' AND column_name = 'stage_entered_at'
  ) THEN
    ALTER TABLE operation_cards ADD COLUMN stage_entered_at TIMESTAMPTZ;
    UPDATE operation_cards SET stage_entered_at = created_at;
    ALTER TABLE operation_cards ALTER COLUMN stage_entered_at SET NOT NULL;
    ALTER TABLE operation_cards ALTER COLUMN stage_entered_at SET DEFAULT NOW();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION maintain_operation_card_stage_entered_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_operation_card_stage_entered_at ON operation_cards;
CREATE TRIGGER trg_maintain_operation_card_stage_entered_at
  BEFORE UPDATE ON operation_cards
  FOR EACH ROW EXECUTE FUNCTION maintain_operation_card_stage_entered_at();

CREATE INDEX IF NOT EXISTS idx_operation_cards_stage_entered_at
  ON operation_cards(stage_id, stage_entered_at);

-- ============================================================
-- OPERATION_AUTOMATION_FIRES — dedup for time-based triggers, which
-- (unlike activity-triggered ones) get re-evaluated by time-sweep-cron
-- on every tick and must not re-fire for the same (automation, card)
-- pair once already fired for a given key. fired_for_key's shape
-- varies by trigger_type: a matched calendar date for
-- date_reached/days_before_date/days_after_date, "<task_id>:<days>"
-- for task_overdue_days, and stage_entered_at's own timestamp (as
-- text) for card_stuck_in_stage_days — the latter naturally allows
-- re-firing in a FUTURE stage visit, since a new stage entry gets a
-- new stage_entered_at and therefore a new key.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_automation_fires (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id  UUID NOT NULL REFERENCES operation_automations(id) ON DELETE CASCADE,
  card_id        UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  task_id        UUID REFERENCES operation_tasks(id) ON DELETE CASCADE,
  fired_for_key  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (automation_id, card_id, fired_for_key)
);

ALTER TABLE operation_automation_fires ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_automation_fires_select ON operation_automation_fires;
CREATE POLICY operation_automation_fires_select ON operation_automation_fires FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_automations a WHERE a.id = operation_automation_fires.automation_id AND is_account_member(a.account_id))
);
-- No write policy — service-role only (time-sweep-cron route).
