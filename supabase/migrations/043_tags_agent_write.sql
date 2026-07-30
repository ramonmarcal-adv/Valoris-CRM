-- ============================================================
-- 043_tags_agent_write.sql
--
-- `tags` was settings-class (admin-only writes) per 017_account_
-- sharing.sql. This CRM's whole complaint driving this migration
-- batch is that ordinary agents can't create or manage tags at all
-- — and tag creation now needs to work inline from the Inbox
-- conversation panel, which agents (not just admins) use day to
-- day. Relax INSERT/UPDATE/DELETE from 'admin' to 'agent'; SELECT
-- was already viewer+ and is unchanged.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
DROP POLICY IF EXISTS tags_insert ON tags;
DROP POLICY IF EXISTS tags_update ON tags;
DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_insert ON tags FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tags_update ON tags FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY tags_delete ON tags FOR DELETE USING (is_account_member(account_id, 'agent'));
