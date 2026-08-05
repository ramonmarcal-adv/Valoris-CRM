-- ============================================================
-- 076_operation_automation_logs.sql
--
-- Execution logs (PRD 16.7) + the delayed-action queue (PRD 16.6),
-- mirroring automation_logs / automation_pending_executions (006)
-- in shape, but scoped to board/card instead of contact.
--
-- operation_automation_pending_executions.card_id is ON DELETE CASCADE
-- (not SET NULL like the existing engine's contact_id) — deliberate:
-- a card is the primary subject of nearly every action here, so a
-- deleted card must cancel its own pending automation steps outright
-- (PRD 16.6's "cancellable when context is lost"), not resume against
-- a card that no longer exists. operation_automation_logs.card_id
-- stays SET NULL — history should survive card deletion, only the
-- not-yet-executed queue needs to disappear with it.
--
-- 'cancelled' is a new pending-execution status not present in the
-- existing engine — added specifically to cover PRD 16.6's other
-- cancellation case: deactivating an automation while it has pending
-- (waiting) executions.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_automation_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID NOT NULL REFERENCES operation_automations(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id        UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  card_id         UUID REFERENCES operation_cards(id) ON DELETE SET NULL,
  trigger_event   TEXT NOT NULL,
  chain_depth     INTEGER NOT NULL DEFAULT 0,
  steps_executed  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_automation_logs_automation_created
  ON operation_automation_logs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_automation_logs_board_created
  ON operation_automation_logs(board_id, created_at DESC);

ALTER TABLE operation_automation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_automation_logs_select ON operation_automation_logs;
CREATE POLICY operation_automation_logs_select ON operation_automation_logs FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy — only the service-role dispatch/
-- resume/sweep routes write here, same convention as automation_logs.

-- ============================================================
-- OPERATION_AUTOMATION_PENDING_EXECUTIONS — the 'wait' queue, drained
-- by resume-cron (080/pg_cron).
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_automation_pending_executions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id        UUID NOT NULL REFERENCES operation_automations(id) ON DELETE CASCADE,
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id             UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  card_id              UUID REFERENCES operation_cards(id) ON DELETE CASCADE,
  log_id               UUID NOT NULL REFERENCES operation_automation_logs(id) ON DELETE CASCADE,
  next_step_position   INTEGER NOT NULL,
  context              JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'running', 'done', 'cancelled', 'failed')),
  run_at               TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_automation_pending_due
  ON operation_automation_pending_executions(run_at) WHERE status = 'pending';

ALTER TABLE operation_automation_pending_executions ENABLE ROW LEVEL SECURITY;
-- RLS enabled, zero client policies — service-role only, mirror of
-- automation_pending_executions (006).

-- ============================================================
-- Deactivating an automation cancels its own pending waits (PRD 16.6).
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_pending_operation_automation_executions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
    UPDATE operation_automation_pending_executions
    SET status = 'cancelled'
    WHERE automation_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_pending_operation_automation_executions ON operation_automations;
CREATE TRIGGER trg_cancel_pending_operation_automation_executions
  AFTER UPDATE OF is_active ON operation_automations
  FOR EACH ROW EXECUTE FUNCTION cancel_pending_operation_automation_executions();
