-- ============================================================
-- 062_operation_card_custom_fields.sql
--
-- Custom fields for Operações boards (PRD 5). This is a NEW,
-- board-scoped definition/value pair — deliberately NOT a reuse of
-- the existing contact-only `custom_fields`/`contact_custom_values`
-- (migration 001), which belongs to a different domain and has no
-- CHECK on field_type to inherit anyway.
--
-- operation_card_field_defs.stage_id (nullable) covers both "field
-- visible on every stage" (NULL) and "field specific to one stage"
-- (set) per PRD 5.3/5.4 — is_required is read together with stage_id,
-- so a field can also be "required only on this stage". This does
-- NOT cover "always visible, but only required from stage X onward";
-- that would need a separate required_in_stage_id column, deferred
-- as a non-destructive ADD COLUMN if it turns out to be needed.
--
-- RLS on operation_card_field_defs is admin+ (not agent+ like the
-- rest of Operações) — defining a board's schema is treated as
-- structural, same tier as the existing `custom_fields` table.
-- operation_card_field_values (actual data entry) stays agent+.
--
-- Values use typed columns instead of a single JSON/TEXT value
-- (PRD 29.5 explicitly rules out dumping everything into one JSON
-- blob) so filtering/indexing/reporting stays possible.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_card_field_defs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id      UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  stage_id      UUID REFERENCES operation_board_stages(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  field_type    TEXT NOT NULL CHECK (field_type IN (
                  'short_text', 'long_text', 'number', 'currency', 'date', 'datetime',
                  'checkbox', 'single_select', 'multi_select', 'phone', 'email', 'url',
                  'user', 'contact', 'related_card'
                )),
  field_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,
  position      INTEGER NOT NULL DEFAULT 0,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_card_field_defs_board_stage
  ON operation_card_field_defs(board_id, stage_id);

ALTER TABLE operation_card_field_defs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_card_field_defs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_card_field_defs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_card_field_defs_select ON operation_card_field_defs;
DROP POLICY IF EXISTS operation_card_field_defs_modify ON operation_card_field_defs;
CREATE POLICY operation_card_field_defs_select ON operation_card_field_defs FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_card_field_defs.board_id AND is_account_member(b.account_id))
);
CREATE POLICY operation_card_field_defs_modify ON operation_card_field_defs FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_card_field_defs.board_id AND is_account_member(b.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_boards b WHERE b.id = operation_card_field_defs.board_id AND is_account_member(b.account_id, 'admin'))
);

-- ============================================================
-- OPERATION_CARD_FIELD_VALUES
--
-- value_uuid is polymorphic (points at auth.users, contacts, or
-- operation_cards depending on field_def.field_type) so it can't
-- carry a declarative FK — validated instead by the trigger below.
-- Known gap accepted for Release A: if the referenced row is deleted
-- later, value_uuid can go stale (no ON DELETE action fires across a
-- non-FK column). Same exposure `field_options JSONB` already has.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_field_values (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id             UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  field_def_id        UUID NOT NULL REFERENCES operation_card_field_defs(id) ON DELETE CASCADE,
  value_text          TEXT,          -- short_text, single_select (option key), phone, email, url
  long_text           TEXT,          -- long_text
  value_number        NUMERIC,       -- number, currency
  value_date          TIMESTAMPTZ,   -- date, datetime
  value_boolean       BOOLEAN,       -- checkbox
  value_uuid          UUID,          -- user (auth.users.id) / contact (contacts.id) / related_card (operation_cards.id)
  value_multi_select  TEXT[],        -- multi_select
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(card_id, field_def_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_card_field_values_card ON operation_card_field_values(card_id);
CREATE INDEX IF NOT EXISTS idx_operation_card_field_values_def_text ON operation_card_field_values(field_def_id, value_text);
CREATE INDEX IF NOT EXISTS idx_operation_card_field_values_def_number ON operation_card_field_values(field_def_id, value_number);
CREATE INDEX IF NOT EXISTS idx_operation_card_field_values_def_date ON operation_card_field_values(field_def_id, value_date);
CREATE INDEX IF NOT EXISTS idx_operation_card_field_values_def_uuid ON operation_card_field_values(field_def_id, value_uuid);

ALTER TABLE operation_card_field_values ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_card_field_values;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_card_field_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_card_field_values_select ON operation_card_field_values;
DROP POLICY IF EXISTS operation_card_field_values_modify ON operation_card_field_values;
CREATE POLICY operation_card_field_values_select ON operation_card_field_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_field_values.card_id AND is_account_member(c.account_id))
);
CREATE POLICY operation_card_field_values_modify ON operation_card_field_values FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_field_values.card_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_field_values.card_id AND is_account_member(c.account_id, 'agent'))
);

-- ============================================================
-- Validates value_uuid against the right table for the field's type,
-- since it can't carry a declarative FK. SECURITY DEFINER so the
-- check can read auth.users regardless of the caller's own grants.
-- ============================================================
CREATE OR REPLACE FUNCTION validate_card_field_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field_type TEXT;
BEGIN
  IF NEW.value_uuid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT field_type INTO v_field_type FROM operation_card_field_defs WHERE id = NEW.field_def_id;

  IF v_field_type = 'user' AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.value_uuid) THEN
    RAISE EXCEPTION 'operation_card_field_values: value_uuid % is not a valid user', NEW.value_uuid;
  ELSIF v_field_type = 'contact' AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = NEW.value_uuid) THEN
    RAISE EXCEPTION 'operation_card_field_values: value_uuid % is not a valid contact', NEW.value_uuid;
  ELSIF v_field_type = 'related_card' AND NOT EXISTS (SELECT 1 FROM operation_cards WHERE id = NEW.value_uuid) THEN
    RAISE EXCEPTION 'operation_card_field_values: value_uuid % is not a valid card', NEW.value_uuid;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_card_field_value ON operation_card_field_values;
CREATE TRIGGER trg_validate_card_field_value
  BEFORE INSERT OR UPDATE ON operation_card_field_values
  FOR EACH ROW EXECUTE FUNCTION validate_card_field_value();
