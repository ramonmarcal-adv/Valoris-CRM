-- ============================================================
-- 049_evolution_group_support.sql
--
-- Group-message ingestion groundwork, on top of 048's provider split.
--
-- 1) messages.sender_id: declared since 001_initial_schema.sql as a
--    bare, FK-less UUID and never read or written anywhere in this
--    codebase (confirmed by grep before writing this migration) — a
--    fully dead column. Repurposed here as "which contact, within a
--    group conversation, actually sent this message." Meaningless for
--    1:1 conversations (the sender is already implied by
--    conversation.contact_id + sender_type='customer'); stays NULL
--    there. Also NULL when an inbound group participant's JID
--    couldn't be resolved to a contact (e.g. a Baileys @lid identity
--    — see parseEvolutionMessageContent in the evolution-webhook
--    route, which deliberately doesn't attempt @lid resolution in v1).
--
-- 2) contacts gets a way to represent a WHATSAPP GROUP AS ITS OWN
--    CONTACT ROW ("group-as-synthetic-contact"), so
--    conversations.contact_id (NOT NULL FK, UNIQUE(account_id,
--    contact_id) since 036_conversation_contact_dedup.sql) keeps
--    working completely unmodified for group conversations — a group
--    "is" its contact row the same way any 1:1 thread is. The
--    alternative (a dedicated group_participants join table) was
--    considered and rejected for v1: it's a materially larger change
--    (new table, new membership/role UI, new RLS) for marginal gain
--    over a boolean flag, given per-message sender attribution below
--    already needs its own column regardless of which direction is
--    chosen for group identity itself.
--
--    Flagged directly on `contacts` (not inferred via a join through
--    conversations.is_group) because contacts is queried
--    independently of any conversation in several places that don't
--    join through conversations today: the Contacts page/list, tag
--    bulk actions, the broadcast recipient picker, CSV export, and
--    findExistingContact() dedupe. Every one of those needs a
--    trivial `WHERE NOT is_group_placeholder` rather than learning to
--    join through conversations.
--
--    contacts.phone stays NOT NULL — a group placeholder row still
--    needs *some* value there; group_jid ('{numericId}@g.us') is
--    stored as the phone value too so no phone-reading code path
--    crashes on NULL. Harmless collision-wise: a group JID's numeric
--    prefix is 18+ digits, categorically longer than any real E.164
--    number. Every phone-SEND code path (send-message.ts,
--    broadcast-core.ts, etc.) MUST check is_group_placeholder first
--    and use group_jid as the actual send target instead of treating
--    phone as dialable — this is the footgun this migration's comment
--    exists to flag for whoever wires up each call site.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN messages.sender_id IS
  'Only meaningful when the parent conversation has is_group = true: '
  'the contacts row for the individual participant who sent this '
  'message inside the group. NULL for 1:1 conversations (sender is '
  'implied by conversation.contact_id) and NULL when the inbound '
  'participant JID could not be resolved to a contact (e.g. a Baileys '
  '@lid identity in v1 — see evolution-webhook parseEvolutionMessageContent).';

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id) WHERE sender_id IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_group_placeholder BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_jid TEXT;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_group_jid_requires_flag;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_group_jid_requires_flag CHECK (
    (is_group_placeholder AND group_jid IS NOT NULL) OR
    (NOT is_group_placeholder AND group_jid IS NULL)
  );

-- Group dedup keys on the JID (never on phone_normalized — a group
-- JID's digits are NOT a phone number and must never be matched
-- against the 022_contact_phone_dedup.sql unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_group_jid
  ON contacts(account_id, group_jid) WHERE group_jid IS NOT NULL;

-- No RLS changes — contacts_select/_insert/_update/_delete
-- (017_account_sharing.sql) are account-scoped, not column-restricted.
