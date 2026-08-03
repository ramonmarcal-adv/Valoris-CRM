-- ============================================================
-- 057_conversation_board_columns.sql
--
-- Decouples the Inbox Kanban from `pipelines`/`deals`. Conversations
-- are bucketed by a plain FK (`conversations.board_column_id`) into a
-- new, freely editable/reorderable set of columns per account — no
-- runtime coupling to pipeline stages or deals. `/pipelines` and its
-- own board are completely untouched.
--
-- board_column_id is deliberately left NULLABLE forever (not backed
-- by a NOT NULL constraint after backfill) — this session already hit
-- an incident where a migration required a column the app code didn't
-- write yet, breaking inserts in the gap between `db push` and the
-- Vercel deploy finishing. The bucketing code in page.tsx already
-- falls back to the default-for-leads column when board_column_id is
-- null, so NOT NULL would add no real safety, only deploy-order risk.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_board_columns (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  color                 TEXT NOT NULL DEFAULT '#3b82f6',
  position              INTEGER NOT NULL DEFAULT 0,
  sort_by               TEXT NOT NULL DEFAULT 'last_message_at' CHECK (sort_by IN (
                           'last_message_at',
                           'last_outbound_message_at',
                           'last_inbound_message_at',
                           'next_reminder_any',
                           'next_reminder_manual',
                           'next_reminder_automated',
                           'manual'
                         )),
  sort_direction        TEXT NOT NULL DEFAULT 'desc' CHECK (sort_direction IN ('asc', 'desc')),
  is_default_for_leads  BOOLEAN NOT NULL DEFAULT false,
  is_default_for_groups BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_board_columns_account
  ON conversation_board_columns(account_id, position);

-- Exactly-one-default-per-account-per-flag invariant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_columns_one_default_leads
  ON conversation_board_columns(account_id) WHERE is_default_for_leads;
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_columns_one_default_groups
  ON conversation_board_columns(account_id) WHERE is_default_for_groups;

ALTER TABLE conversation_board_columns ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON conversation_board_columns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversation_board_columns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- agent+ (not admin+ like pipeline_stages) — framed by the account
-- owner as an everyday working tool ("liberdade da visão de kanban"),
-- not account configuration. Structural safety (delete-blocked while
-- non-empty or flagged default) is enforced in app code, same as
-- pipeline_stages' delete-blocked-by-deals check.
DROP POLICY IF EXISTS conversation_board_columns_select ON conversation_board_columns;
DROP POLICY IF EXISTS conversation_board_columns_modify ON conversation_board_columns;
CREATE POLICY conversation_board_columns_select ON conversation_board_columns FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY conversation_board_columns_modify ON conversation_board_columns FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- SEED FOR NEW ACCOUNTS
--
-- The backfill below only covers accounts that exist at migration
-- time. Any account created afterward needs the same default pair
-- seeded immediately, or its first inbound conversation would have no
-- column to fall back to as cleanly (the app-code fallback still
-- covers it, but there'd be no board to look at until one is made).
-- ============================================================
CREATE OR REPLACE FUNCTION seed_default_conversation_board_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO conversation_board_columns (account_id, name, color, position, is_default_for_leads)
  VALUES (NEW.id, 'Novos Leads', '#3b82f6', 0, true);
  INSERT INTO conversation_board_columns (account_id, name, color, position, is_default_for_groups)
  VALUES (NEW.id, 'Grupos', '#94a3b8', 1, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_account_created_seed_board_columns ON accounts;
CREATE TRIGGER on_account_created_seed_board_columns
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION seed_default_conversation_board_columns();

-- ============================================================
-- conversations.board_column_id
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS board_column_id UUID
    REFERENCES conversation_board_columns(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_conversations_board_column
  ON conversations(board_column_id, kanban_position);

-- ============================================================
-- BACKFILL — preserve today's on-screen layout
--
-- Reuses each pipeline_stages.id AS the new board column's id.
-- conversation_board_columns is a brand-new, empty table, so there's
-- no collision risk — and it means deals.stage_id already IS a valid
-- conversation_board_columns.id once the stage-derived columns exist,
-- with no separate mapping table needed. conversation_board_columns
-- has no FK to pipeline_stages, so columns are fully independent
-- (renameable/reorderable/deletable) from this point on.
-- ============================================================
DO $$
DECLARE
  acct RECORD;
  v_pipeline_id UUID;
  v_groups_column_id UUID;
  v_next_position INTEGER;
BEGIN
  FOR acct IN SELECT id FROM accounts LOOP
    -- Idempotency guard — safe to re-run this migration.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM conversation_board_columns WHERE account_id = acct.id
    );

    -- "Default pipeline" = oldest-created, same convention already
    -- used by pipelines/page.tsx, inbox/page.tsx and the (now-removed)
    -- ensure-default-deal.ts helper.
    SELECT id INTO v_pipeline_id
    FROM pipelines WHERE account_id = acct.id
    ORDER BY created_at ASC LIMIT 1;

    IF v_pipeline_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = v_pipeline_id) THEN
      INSERT INTO conversation_board_columns
        (id, account_id, name, color, position, is_default_for_leads)
      SELECT
        ps.id, acct.id, ps.name, ps.color, ps.position,
        (ps.position = (SELECT MIN(position) FROM pipeline_stages WHERE pipeline_id = v_pipeline_id))
      FROM pipeline_stages ps
      WHERE ps.pipeline_id = v_pipeline_id;

      SELECT COALESCE(MAX(position), -1) + 1 INTO v_next_position
      FROM conversation_board_columns WHERE account_id = acct.id;
    ELSE
      -- No pipeline at all, or a pipeline with zero stages — fallback pair.
      INSERT INTO conversation_board_columns (account_id, name, color, position, is_default_for_leads)
      VALUES (acct.id, 'Novos Leads', '#3b82f6', 0, true);
      v_next_position := 1;
    END IF;

    INSERT INTO conversation_board_columns (account_id, name, color, position, is_default_for_groups)
    VALUES (acct.id, 'Grupos', '#94a3b8', v_next_position, true)
    RETURNING id INTO v_groups_column_id;

    -- (a) 1:1 conversation with a deal in the default pipeline -> that
    --     stage's column (id reuse means deals.stage_id already IS a
    --     valid conversation_board_columns.id).
    UPDATE conversations c
    SET board_column_id = d.stage_id
    FROM deals d
    WHERE d.conversation_id = c.id
      AND v_pipeline_id IS NOT NULL
      AND d.pipeline_id = v_pipeline_id
      AND c.account_id = acct.id
      AND c.board_column_id IS NULL;

    -- (b) Groups with no deal-based mapping above -> Grupos.
    UPDATE conversations c
    SET board_column_id = v_groups_column_id
    WHERE c.account_id = acct.id
      AND c.board_column_id IS NULL
      AND c.is_group = true;

    -- (c) Everything else (1:1 with no deal in the default pipeline,
    --     or no pipeline existed at all) -> the default-for-leads column.
    UPDATE conversations c
    SET board_column_id = (
      SELECT id FROM conversation_board_columns
      WHERE account_id = acct.id AND is_default_for_leads LIMIT 1
    )
    WHERE c.account_id = acct.id
      AND c.board_column_id IS NULL;
  END LOOP;
END $$;

-- ============================================================
-- conversations.last_inbound_message_at / last_outbound_message_at
--
-- Maintained by an AFTER INSERT trigger on messages, not by hand-
-- editing the ~8 existing call sites that already write
-- last_message_at (evolution-ingest, webhook route, flows/automations
-- send, scheduled messages, ...) — a trigger is correctness-guaranteed
-- regardless of how many app code paths insert a message, present or
-- future, where auditing every call site by hand is not.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_message_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_created
  ON messages(conversation_id, sender_type, created_at DESC);

CREATE OR REPLACE FUNCTION set_conversation_message_direction_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET last_inbound_message_at = NEW.created_at
    WHERE id = NEW.conversation_id
      AND (last_inbound_message_at IS NULL OR last_inbound_message_at < NEW.created_at);
  ELSE
    -- 'agent' and 'bot' both count as outbound.
    UPDATE conversations
    SET last_outbound_message_at = NEW.created_at
    WHERE id = NEW.conversation_id
      AND (last_outbound_message_at IS NULL OR last_outbound_message_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_message_direction ON messages;
CREATE TRIGGER trg_conversation_message_direction
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION set_conversation_message_direction_timestamps();

-- One-time backfill from message history.
UPDATE conversations c
SET last_inbound_message_at = m.max_created_at
FROM (
  SELECT conversation_id, MAX(created_at) AS max_created_at
  FROM messages WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id AND c.last_inbound_message_at IS NULL;

UPDATE conversations c
SET last_outbound_message_at = m.max_created_at
FROM (
  SELECT conversation_id, MAX(created_at) AS max_created_at
  FROM messages WHERE sender_type IN ('agent', 'bot')
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id AND c.last_outbound_message_at IS NULL;
