-- ============================================================
-- 050_contact_name_source.sql
--
-- Tracks whether a contact's current `name` came from WhatsApp itself
-- (pushName / profile lookup, auto-updated as fresher data arrives) or
-- was corrected by hand in the contact form (frozen — auto-sync must
-- never overwrite a human's correction). Existing rows default to
-- 'whatsapp' so today's auto-sync behavior is unchanged for anyone who
-- hasn't touched a contact's name yet; the contact-edit form flips a
-- row to 'manual' the moment someone actually renames it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS name_source TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (name_source IN ('whatsapp', 'manual'));
