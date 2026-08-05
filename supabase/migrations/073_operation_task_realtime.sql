-- ============================================================
-- 073_operation_task_realtime.sql
--
-- Enables realtime on operation_tasks and operation_checklist_items
-- so the Calendar, Board Overview, and a card's task list update live
-- when another agent moves/completes something — same idempotent
-- pattern used 7x already in this schema.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'operation_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE operation_tasks;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'operation_checklist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE operation_checklist_items;
  END IF;
END $$;
