-- ============================================================
-- 082_operation_forms.sql
--
-- Release D — native forms (PRD 17). A form belongs to a Board and,
-- on submission, creates a Card in it (+ optionally a Contact).
-- Structural definition (the form + its questions) is admin+ RLS,
-- same tier as operation_card_field_defs/operation_task_templates —
-- submitting is a different concern entirely (084/085 RPCs +
-- migration 083's own agent+ tier for the authenticated fill path).
--
-- No `form_type` column — deliberately simplified after discussion:
-- every form supports BOTH an always-available authenticated
-- "fill from the dashboard" path (086's internal submit route) and a
-- public URL gated purely by `is_published` (084's anon RPC checks
-- this flag, nothing else). There's no access-tier distinction to
-- encode in schema.
--
-- field_type on operation_form_questions is a 12-value SUBSET of
-- operation_card_field_defs' 15 (062) — excludes user/contact/
-- related_card, which reference internal-only entities an anonymous
-- visitor can't meaningfully pick from.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_forms (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id               UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id                 UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  target_stage_id          UUID REFERENCES operation_board_stages(id) ON DELETE SET NULL, -- NULL = resolve is_initial at submit time
  name                     TEXT NOT NULL,
  description              TEXT,
  slug                     TEXT NOT NULL,
  is_published             BOOLEAN NOT NULL DEFAULT FALSE,
  title_template           TEXT NOT NULL DEFAULT '',
  description_template     TEXT,
  thank_you_message        TEXT NOT NULL DEFAULT 'Obrigado! Recebemos sua resposta.',
  consent_required         BOOLEAN NOT NULL DEFAULT FALSE,
  consent_text             TEXT,
  update_existing_contact  BOOLEAN NOT NULL DEFAULT FALSE,
  dedupe_use_email         BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at              TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consent_required = FALSE OR consent_text IS NOT NULL)
);

-- Slug is the public URL key — unique while "live" (not archived), a
-- partial index (mirrors 060's one-is_initial-per-board index) so an
-- archived form's slug can be reused later without a hard DB conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_forms_slug
  ON operation_forms(slug) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_operation_forms_board ON operation_forms(board_id);
CREATE INDEX IF NOT EXISTS idx_operation_forms_account ON operation_forms(account_id);

ALTER TABLE operation_forms ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_forms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_forms_select ON operation_forms;
DROP POLICY IF EXISTS operation_forms_modify ON operation_forms;
CREATE POLICY operation_forms_select ON operation_forms FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_forms_modify ON operation_forms FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- OPERATION_FORM_QUESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_form_questions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_id            UUID NOT NULL REFERENCES operation_forms(id) ON DELETE CASCADE,
  field_key          TEXT NOT NULL, -- stable slug used as {{field_key}} in title/description templates
  label              TEXT NOT NULL,
  help_text          TEXT,
  field_type         TEXT NOT NULL CHECK (field_type IN (
                        'short_text', 'long_text', 'number', 'currency', 'phone', 'email',
                        'date', 'datetime', 'single_select', 'multi_select', 'checkbox', 'url'
                      )),
  field_options      JSONB NOT NULL DEFAULT '{}'::jsonb, -- { choices: [...] } for single/multi_select, mirrors operation_card_field_defs
  is_required        BOOLEAN NOT NULL DEFAULT FALSE,
  position           INTEGER NOT NULL DEFAULT 0,
  maps_to            TEXT NOT NULL DEFAULT 'answer_only' CHECK (maps_to IN (
                        'contact_phone', 'contact_name', 'contact_email', 'contact_company',
                        'card_field', 'answer_only'
                      )),
  card_field_def_id  UUID REFERENCES operation_card_field_defs(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((maps_to = 'card_field') = (card_field_def_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_form_questions_key
  ON operation_form_questions(form_id, field_key);
-- At most one question per form mapped to each scalar Contact field.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_form_questions_contact_mapping
  ON operation_form_questions(form_id, maps_to)
  WHERE maps_to IN ('contact_phone', 'contact_name', 'contact_email', 'contact_company');
-- At most one question per form mapped to the same Card field.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_form_questions_card_field
  ON operation_form_questions(form_id, card_field_def_id) WHERE maps_to = 'card_field';
CREATE INDEX IF NOT EXISTS idx_operation_form_questions_form_position
  ON operation_form_questions(form_id, position);

ALTER TABLE operation_form_questions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_form_questions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_form_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_form_questions_select ON operation_form_questions;
DROP POLICY IF EXISTS operation_form_questions_modify ON operation_form_questions;
CREATE POLICY operation_form_questions_select ON operation_form_questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_forms f WHERE f.id = operation_form_questions.form_id AND is_account_member(f.account_id))
);
CREATE POLICY operation_form_questions_modify ON operation_form_questions FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_forms f WHERE f.id = operation_form_questions.form_id AND is_account_member(f.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_forms f WHERE f.id = operation_form_questions.form_id AND is_account_member(f.account_id, 'admin'))
);
