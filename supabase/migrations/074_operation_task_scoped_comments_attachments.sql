-- ============================================================
-- 074_operation_task_scoped_comments_attachments.sql
--
-- Lets a Task have its own comments/attachments (PRD 12.1) by
-- reusing operation_card_comments/operation_card_attachments (064)
-- rather than adding dedicated task_comments/task_attachments tables.
-- A NULL task_id is a Card-general comment/attachment (today's
-- behavior, unchanged); a non-NULL task_id scopes it to that task.
-- Reuses the same RLS/activity-trigger/bucket infrastructure — the
-- existing policies compare account_id, not task_id, so they stay
-- correct unmodified.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE operation_card_comments
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES operation_tasks(id) ON DELETE CASCADE;
ALTER TABLE operation_card_attachments
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES operation_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_operation_card_comments_task
  ON operation_card_comments(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operation_card_attachments_task
  ON operation_card_attachments(task_id) WHERE task_id IS NOT NULL;
