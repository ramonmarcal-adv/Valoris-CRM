-- ============================================================
-- 038_message_favorites.sql — "Mensagens favoritas"
--
-- Account-visible (like contact_notes) rather than per-user-private:
-- any teammate can see which messages the team has starred in a
-- conversation. RLS tier mirrors contact_notes (agent+ read/write).
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS message_favorites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_favorites_conversation
  ON message_favorites(conversation_id);

ALTER TABLE message_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_favorites_select ON message_favorites;
DROP POLICY IF EXISTS message_favorites_modify ON message_favorites;
CREATE POLICY message_favorites_select ON message_favorites FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY message_favorites_modify ON message_favorites FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
