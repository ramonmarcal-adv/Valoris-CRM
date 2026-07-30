-- ============================================================
-- 047_scheduled_messages.sql — "Mensagens agendadas"
--
-- Dedicated table rather than reusing `messages.status` (a "not yet
-- sent" row must not appear in the thread, count toward unread_count,
-- or satisfy any of messages' delivery-tick/realtime invariants — its
-- CHECK constraint is also closed over sending/sent/delivered/read/
-- failed, and widening it would ripple into every reader of that
-- column). v1 is text/media only — scheduling a template send would
-- need to revalidate the template's Meta approval status at send
-- time, which is meaningfully more logic; can be added later without
-- a breaking migration.
--
-- RLS mirrors contact_reminders/contact_appointments (agent+, team-
-- visible within the account). The cron sender (Área D.4) uses the
-- service-role client and bypasses RLS entirely, same as every other
-- cron route in this app.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type       TEXT NOT NULL DEFAULT 'text'
                        CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video')),
  content_text       TEXT,
  media_url          TEXT,
  filename           TEXT,
  reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  scheduled_at       TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  error_message      TEXT,
  sent_message_id    UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON scheduled_messages(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_account
  ON scheduled_messages(account_id, status);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON scheduled_messages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_delete ON scheduled_messages;
CREATE POLICY scheduled_messages_select ON scheduled_messages FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY scheduled_messages_insert ON scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY scheduled_messages_update ON scheduled_messages FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY scheduled_messages_delete ON scheduled_messages FOR DELETE
  USING (is_account_member(account_id, 'agent'));
