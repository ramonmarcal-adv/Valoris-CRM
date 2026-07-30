-- ============================================================
-- 046_reminder_source.sql
--
-- Distinguishes manually-created reminders from ones an automation
-- created (new "create_reminder" automation step type), so the Inbox
-- can offer separate "Só lembretes" / "Só follow-ups automáticos"
-- filters. No RLS change — existing contact_reminders_select/_modify
-- (agent+ within the account) already cover the new column.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE contact_reminders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'automated'));

CREATE INDEX IF NOT EXISTS idx_contact_reminders_source
  ON contact_reminders(account_id, source) WHERE completed_at IS NULL;
