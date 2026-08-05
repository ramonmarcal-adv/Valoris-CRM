-- ============================================================
-- 064_operation_card_comments_attachments.sql
--
-- Internal comments and file attachments on a Card (PRD 4.3/4.4).
-- Both are net-new — no generic "comment"/"attachment" table exists
-- anywhere in the schema today; contact_notes (001/039) is the
-- closest precedent for comments, `messages.media_url` the closest
-- for attachments (but 1:1 with a message, not a reusable pattern).
--
-- operation_card_comments.user_id is ON DELETE SET NULL, diverging
-- deliberately from contact_notes.user_id (ON DELETE CASCADE) — a
-- card comment is part of the Card's history/audit trail and
-- shouldn't disappear just because its author later leaves the team.
--
-- The card-attachments bucket is public, matching the existing
-- avatars/flow-media/chat-media/branding buckets (confirmed decision
-- — consistency over adding a first-of-its-kind private+signed-URL
-- pattern to the repo).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_card_comments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id       UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  comment_text  TEXT NOT NULL,
  is_internal   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_card_comments_card_created
  ON operation_card_comments(card_id, created_at DESC);

ALTER TABLE operation_card_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_comments_select ON operation_card_comments;
DROP POLICY IF EXISTS operation_card_comments_insert ON operation_card_comments;
DROP POLICY IF EXISTS operation_card_comments_update ON operation_card_comments;
DROP POLICY IF EXISTS operation_card_comments_delete ON operation_card_comments;
CREATE POLICY operation_card_comments_select ON operation_card_comments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_card_comments_insert ON operation_card_comments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY operation_card_comments_update ON operation_card_comments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY operation_card_comments_delete ON operation_card_comments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- OPERATION_CARD_ATTACHMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_attachments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id               UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uploaded_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_bucket        TEXT NOT NULL DEFAULT 'card-attachments',
  storage_path          TEXT NOT NULL,
  file_name             TEXT NOT NULL,
  mime_type             TEXT,
  size_bytes            BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_card_attachments_card_created
  ON operation_card_attachments(card_id, created_at DESC);

ALTER TABLE operation_card_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_attachments_select ON operation_card_attachments;
DROP POLICY IF EXISTS operation_card_attachments_insert ON operation_card_attachments;
DROP POLICY IF EXISTS operation_card_attachments_delete ON operation_card_attachments;
CREATE POLICY operation_card_attachments_select ON operation_card_attachments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_card_attachments_insert ON operation_card_attachments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY operation_card_attachments_delete ON operation_card_attachments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- card-attachments Storage bucket
--
-- Same account-<account_id>/<timestamp>-<basename>.<ext> path
-- convention as avatars/flow-media/chat-media/branding — reuses
-- src/lib/storage/upload-media.ts (buildMediaPath, uploadAccountMedia)
-- verbatim, just passing this bucket name. Public read (confirmed
-- decision), agent+ write via the is_account_member(..., 'agent')
-- substring check, same shape as migration 055's admin-gated
-- branding-bucket policies.
--
-- 25 MB cap — business documents (edital, matrícula, laudo) run
-- larger than chat media; broad document/image MIME allow-list, no
-- audio/video (not an expected attachment kind here).
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'card-attachments',
  'card-attachments',
  TRUE,
  26214400, -- 25 MB
  ARRAY[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Card attachments are publicly readable" ON storage.objects;
CREATE POLICY "Card attachments are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'card-attachments');

DROP POLICY IF EXISTS "Members can upload card attachments" ON storage.objects;
CREATE POLICY "Members can upload card attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'card-attachments'
    AND is_account_member(
      substring((storage.foldername(name))[1] from 9)::uuid, -- strip 'account-' prefix
      'agent'
    )
  );

DROP POLICY IF EXISTS "Members can delete card attachments" ON storage.objects;
CREATE POLICY "Members can delete card attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'card-attachments'
    AND is_account_member(
      substring((storage.foldername(name))[1] from 9)::uuid,
      'agent'
    )
  );
