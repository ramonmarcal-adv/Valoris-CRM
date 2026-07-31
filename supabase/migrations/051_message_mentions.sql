-- ============================================================
-- 051_message_mentions.sql
--
-- WhatsApp group messages can @mention participants; the wire text
-- carries a raw `@<digits>` placeholder (the participant's JID/lid, not
-- necessarily their dialable phone number) with no name attached. This
-- column stores the resolved {jid, phone, name} for each mention in a
-- message so the UI can render "@João" instead of the raw digits —
-- resolution happens once at ingest time (evolution-ingest.ts), reusing
-- the same @lid → contact resolver already used for group sender
-- attribution (migration 049).
--
-- NULL/absent for every non-group message and for group messages with
-- no mentions — not backfilled for historical rows (the raw wire
-- payload needed to resolve old mentions isn't retained).
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions JSONB;

COMMENT ON COLUMN messages.mentions IS
  'Resolved group @mentions for this message: [{"jid": "...", "phone": "...", "name": "..."}]. NULL when none.';
