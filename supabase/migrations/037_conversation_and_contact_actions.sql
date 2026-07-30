-- ============================================================
-- 037_conversation_and_contact_actions.sql
--
-- Backing state for the Inbox conversation-list context menu
-- (pin / favorite / archive) and conversation-panel actions
-- (mute, block contact). Also fixes a dangling FK that blocks
-- "Apagar conversa" (delete conversation) whenever a deal is
-- linked to it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- conversations: pin / favorite / archive / mute ------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_muted    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned
  ON conversations(account_id) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_conversations_archived
  ON conversations(account_id) WHERE is_archived;

-- ---- contacts: block ---------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---- deals.conversation_id: RESTRICT -> SET NULL ------------------
-- Declared as `REFERENCES conversations(id)` with no ON DELETE action
-- (001_initial_schema.sql), so Postgres defaults to NO ACTION/RESTRICT.
-- "Apagar conversa" on a conversation with a linked deal currently
-- fails with a FK violation. Same fix shape as 004_contact_delete_set_null.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_conversation_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_conversation_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE SET NULL;
