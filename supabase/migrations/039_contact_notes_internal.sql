-- ============================================================
-- 039_contact_notes_internal.sql — "Notas internas"
--
-- Splits contact_notes into two feeds via a boolean flag rather than
-- a new table: the Inbox sidebar's existing general Notes block
-- keeps reading/writing is_internal = false (default, so existing
-- rows are unaffected); a new "Notas internas" block filters
-- is_internal = true. No RLS change — same table, same policies.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE contact_notes
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
