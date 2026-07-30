-- ============================================================
-- 042_faq_entries.sql — "Dúvidas & Objeções" (Inbox sidebar)
--
-- faq_entries is knowledge-base-like reference data curated by
-- admins and read by the whole team, same shape/tier as `tags`:
-- admin+ writes, viewer+ reads. faq_entry_tags joins entries to the
-- same `tags` table contacts already use — that's what lets the
-- Inbox panel scope FAQs to "this conversation's tags"
-- (mirrors contact_tags exactly).
--
-- Idempotent — safe to run multiple times.
-- ============================================================
CREATE TABLE IF NOT EXISTS faq_entries (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_entries_account ON faq_entries(account_id);

ALTER TABLE faq_entries ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON faq_entries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON faq_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS faq_entries_select ON faq_entries;
DROP POLICY IF EXISTS faq_entries_insert ON faq_entries;
DROP POLICY IF EXISTS faq_entries_update ON faq_entries;
DROP POLICY IF EXISTS faq_entries_delete ON faq_entries;
CREATE POLICY faq_entries_select ON faq_entries FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY faq_entries_insert ON faq_entries FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY faq_entries_update ON faq_entries FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY faq_entries_delete ON faq_entries FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- faq_entry_tags (many-to-many, mirrors contact_tags) --------
CREATE TABLE IF NOT EXISTS faq_entry_tags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faq_entry_id  UUID NOT NULL REFERENCES faq_entries(id) ON DELETE CASCADE,
  tag_id        UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faq_entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_entry_tags_entry ON faq_entry_tags(faq_entry_id);
CREATE INDEX IF NOT EXISTS idx_faq_entry_tags_tag ON faq_entry_tags(tag_id);

ALTER TABLE faq_entry_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faq_entry_tags_select ON faq_entry_tags;
DROP POLICY IF EXISTS faq_entry_tags_modify ON faq_entry_tags;
CREATE POLICY faq_entry_tags_select ON faq_entry_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM faq_entries f WHERE f.id = faq_entry_tags.faq_entry_id AND is_account_member(f.account_id))
);
CREATE POLICY faq_entry_tags_modify ON faq_entry_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM faq_entries f WHERE f.id = faq_entry_tags.faq_entry_id AND is_account_member(f.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM faq_entries f WHERE f.id = faq_entry_tags.faq_entry_id AND is_account_member(f.account_id, 'admin'))
);
