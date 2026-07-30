-- ============================================================
-- 041_appointments.sql — "Criar agendamento" / "Agendamentos"
-- (Inbox sidebar Gestão section)
--
-- RLS tier mirrors contact_notes / contact_reminders (agent+,
-- team-visible within the account).
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_appointments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ,
  location            TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_appointments_contact
  ON contact_appointments(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_appointments_upcoming
  ON contact_appointments(account_id, starts_at) WHERE status = 'scheduled';

ALTER TABLE contact_appointments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON contact_appointments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS contact_appointments_select ON contact_appointments;
DROP POLICY IF EXISTS contact_appointments_modify ON contact_appointments;
CREATE POLICY contact_appointments_select ON contact_appointments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY contact_appointments_modify ON contact_appointments FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
