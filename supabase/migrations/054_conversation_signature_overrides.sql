-- ============================================================
-- 054_conversation_signature_overrides.sql
--
-- Per-agent, per-conversation exception to `profiles.signature_enabled`
-- (the global "sign all conversations by default" / "choose per
-- conversation" choice, Settings → Profile). A row existing here is
-- what lets an agent flip signing on/off for one specific conversation
-- WITHOUT touching their global default — the composer's toggle
-- (message-thread.tsx) upserts here instead of only holding local
-- React state, which is what let the choice silently reset after the
-- very first message.
--
-- Personal, not account-shared: `user_id = auth.uid()` is the whole
-- access rule — a teammate's override for a conversation has no
-- bearing on any other agent's signature behavior in that same thread.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_signature_overrides (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signature_enabled BOOLEAN NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_signature_overrides_lookup
  ON conversation_signature_overrides(conversation_id, user_id);

DROP TRIGGER IF EXISTS set_updated_at ON conversation_signature_overrides;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversation_signature_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE conversation_signature_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_signature_overrides_all ON conversation_signature_overrides;
CREATE POLICY conversation_signature_overrides_all ON conversation_signature_overrides FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
