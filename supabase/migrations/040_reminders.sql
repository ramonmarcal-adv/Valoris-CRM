-- ============================================================
-- 040_reminders.sql — "Lembrete" (Inbox sidebar Gestão section)
--
-- RLS tier mirrors contact_notes (agent+ read/write within the
-- account — a reminder is team-visible, not private to its creator).
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_reminders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  due_at              TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_reminders_contact
  ON contact_reminders(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_reminders_due
  ON contact_reminders(account_id, due_at) WHERE completed_at IS NULL;

ALTER TABLE contact_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_reminders_select ON contact_reminders;
DROP POLICY IF EXISTS contact_reminders_modify ON contact_reminders;
CREATE POLICY contact_reminders_select ON contact_reminders FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_reminders_modify ON contact_reminders FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
