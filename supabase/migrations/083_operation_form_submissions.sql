-- ============================================================
-- 083_operation_form_submissions.sql
--
-- Submission snapshots (PRD 17.8) — append-only, not the primary
-- operational record (that's the Card/Contact the submission feeds).
-- `answers` is a single self-describing JSONB blob per submission
-- (not one row per answer): PRD 17.8 explicitly exempts submissions
-- from the "preserve filter/indexing" discipline of PRD 29.5 by
-- saying important data belongs on the Card/Contact instead — the
-- data that DOES need to be filterable/indexable already lives in
-- typed operation_card_field_values columns. Self-describing shape
-- (`{question_id: {field_key, label, field_type, value}}`, not just
-- `{question_id: value}`) so a snapshot survives a question being
-- edited or archived later — the audit record shouldn't silently
-- reinterpret under a changed label/type.
--
-- account_id is denormalized (same precedent as operation_cards,
-- operation_automation_logs) — a submission's single possible parent
-- (operation_forms) makes this safe.
--
-- No RLS write policy for the public path — submissions from an
-- anonymous visitor go through a service-role client (084/085's RPCs
-- + the public submit route), which bypasses RLS entirely, same
-- established pattern as the WhatsApp webhook / /api/v1 routes.
-- agent+ INSERT here only serves the authenticated "fill from the
-- dashboard" path.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_form_submissions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id                UUID NOT NULL REFERENCES operation_forms(id) ON DELETE CASCADE,
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  answers                JSONB NOT NULL,
  contact_id             UUID REFERENCES contacts(id) ON DELETE SET NULL,
  card_id                UUID REFERENCES operation_cards(id) ON DELETE SET NULL,
  contact_was_created    BOOLEAN NOT NULL DEFAULT FALSE,
  utm_source             TEXT,
  utm_medium             TEXT,
  utm_campaign           TEXT,
  utm_content            TEXT,
  referral_code          TEXT,
  hidden_fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_given          BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- only set on the authenticated internal-fill path
  ip_address             TEXT,
  user_agent             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_form_submissions_form_created
  ON operation_form_submissions(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_form_submissions_account_created
  ON operation_form_submissions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_form_submissions_contact
  ON operation_form_submissions(contact_id);
CREATE INDEX IF NOT EXISTS idx_operation_form_submissions_card
  ON operation_form_submissions(card_id);

ALTER TABLE operation_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_form_submissions_select ON operation_form_submissions;
DROP POLICY IF EXISTS operation_form_submissions_insert ON operation_form_submissions;
DROP POLICY IF EXISTS operation_form_submissions_delete ON operation_form_submissions;
CREATE POLICY operation_form_submissions_select ON operation_form_submissions FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_form_submissions_insert ON operation_form_submissions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
-- Admin-only delete: LGPD/erasure requests. No UPDATE policy at all —
-- immutable once written, same append-only idiom as operation_card_activity.
CREATE POLICY operation_form_submissions_delete ON operation_form_submissions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- operation_cards.source_form_submission_id — traceability FK, not a
-- live binding (same idiom as operation_tasks.source_template_id,
-- migration 069). Deliberately NOT a polymorphic source_type/source_id
-- pair (no precedent for that shape in this schema, and nothing is
-- lost here: the submission row already carries form_id -> board_id).
-- ============================================================
ALTER TABLE operation_cards
  ADD COLUMN IF NOT EXISTS source_form_submission_id UUID
    REFERENCES operation_form_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_operation_cards_source_submission
  ON operation_cards(source_form_submission_id);
