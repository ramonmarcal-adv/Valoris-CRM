-- ============================================================
-- 063_operation_card_tags_relations.sql
--
-- Card relationships (PRD 4.5): tags (reusing the existing `tags`
-- table — same tenant, same RLS tier, shared with contacts by
-- design), Card↔Card relations with a free-text semantic type,
-- Card↔Contact and Card↔Conversation links.
--
-- All four are pure join tables, agent+ RLS via a parent-join EXISTS
-- back to operation_cards — same shape as contact_tags (001/017).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- OPERATION_CARD_TAGS — copies the contact_tags join-table shape
-- exactly, reusing the existing `tags` table.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id     UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(card_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_card_tags_card ON operation_card_tags(card_id);
CREATE INDEX IF NOT EXISTS idx_operation_card_tags_tag ON operation_card_tags(tag_id);

ALTER TABLE operation_card_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_tags_select ON operation_card_tags;
DROP POLICY IF EXISTS operation_card_tags_modify ON operation_card_tags;
CREATE POLICY operation_card_tags_select ON operation_card_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_tags.card_id AND is_account_member(c.account_id))
);
CREATE POLICY operation_card_tags_modify ON operation_card_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_tags.card_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_tags.card_id AND is_account_member(c.account_id, 'agent'))
);

-- ============================================================
-- OPERATION_CARD_RELATIONS — Card↔Card, directional.
--
-- relation_type is free text, no enum/CHECK — same philosophy as
-- `tags`, lets the product iterate on labels ("Interessado em",
-- "Cliente de", ...) without a migration. Directional (from/to)
-- rather than symmetric: a relation like "duplicates" has a natural
-- direction; the UI decides how to mirror/label the inverse when
-- rendering from card B's side.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_relations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_card_id   UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  to_card_id     UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL DEFAULT 'related',
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_card_id <> to_card_id),
  UNIQUE(from_card_id, to_card_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_operation_card_relations_from ON operation_card_relations(from_card_id);
CREATE INDEX IF NOT EXISTS idx_operation_card_relations_to ON operation_card_relations(to_card_id);

ALTER TABLE operation_card_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_relations_select ON operation_card_relations;
DROP POLICY IF EXISTS operation_card_relations_modify ON operation_card_relations;
CREATE POLICY operation_card_relations_select ON operation_card_relations FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_relations.from_card_id AND is_account_member(c.account_id))
);
CREATE POLICY operation_card_relations_modify ON operation_card_relations FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_relations.from_card_id AND is_account_member(c.account_id, 'agent'))
  AND EXISTS (SELECT 1 FROM operation_cards c2 WHERE c2.id = operation_card_relations.to_card_id AND is_account_member(c2.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_relations.from_card_id AND is_account_member(c.account_id, 'agent'))
  AND EXISTS (SELECT 1 FROM operation_cards c2 WHERE c2.id = operation_card_relations.to_card_id AND is_account_member(c2.account_id, 'agent'))
);

-- ============================================================
-- OPERATION_CARD_CONTACTS — Card↔Contact, many-to-many.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id         UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relation_label  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(card_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_card_contacts_card ON operation_card_contacts(card_id);
CREATE INDEX IF NOT EXISTS idx_operation_card_contacts_contact ON operation_card_contacts(contact_id);

ALTER TABLE operation_card_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_contacts_select ON operation_card_contacts;
DROP POLICY IF EXISTS operation_card_contacts_modify ON operation_card_contacts;
CREATE POLICY operation_card_contacts_select ON operation_card_contacts FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_contacts.card_id AND is_account_member(c.account_id))
);
CREATE POLICY operation_card_contacts_modify ON operation_card_contacts FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_contacts.card_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_contacts.card_id AND is_account_member(c.account_id, 'agent'))
);

-- ============================================================
-- OPERATION_CARD_CONVERSATIONS — Card↔Conversation, many-to-many
-- (e.g. the same contact has two properties of interest, each its
-- own Card, both pointing at the same conversation).
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_card_conversations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_id          UUID NOT NULL REFERENCES operation_cards(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(card_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_card_conversations_card ON operation_card_conversations(card_id);
CREATE INDEX IF NOT EXISTS idx_operation_card_conversations_conversation ON operation_card_conversations(conversation_id);

ALTER TABLE operation_card_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_card_conversations_select ON operation_card_conversations;
DROP POLICY IF EXISTS operation_card_conversations_modify ON operation_card_conversations;
CREATE POLICY operation_card_conversations_select ON operation_card_conversations FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_conversations.card_id AND is_account_member(c.account_id))
);
CREATE POLICY operation_card_conversations_modify ON operation_card_conversations FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_conversations.card_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_cards c WHERE c.id = operation_card_conversations.card_id AND is_account_member(c.account_id, 'agent'))
);
