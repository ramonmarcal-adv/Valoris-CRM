-- ============================================================
-- 044_conversation_groups.sql
--
-- Groundwork for WhatsApp group chats — deliberately API-agnostic
-- (not Meta-Cloud-API-specific). Meta's WhatsApp Cloud API (the
-- current integration, src/lib/whatsapp/) cannot send/receive group
-- messages at all, so no real conversation will have is_group=true
-- until a future, separate integration (e.g. Evolution API) starts
-- ingesting group chats and setting this flag. The "Grupos" filter
-- added alongside this migration will correctly show zero results
-- today and "just work" once that integration lands — no further
-- schema change needed then.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_participant_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_conversations_is_group
  ON conversations(account_id, is_group) WHERE is_group = true;
