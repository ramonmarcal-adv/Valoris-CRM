-- ============================================================
-- 056_conversation_kanban_position.sql
--
-- Manual drag-to-reorder position for a conversation within whatever
-- Kanban column it's currently in (a pipeline stage, "Grupos", or "Sem
-- negócio neste pipeline") — independent of which column that is, so
-- one column doesn't need its own bookkeeping table.
--
-- Fractional/gap-based (DOUBLE PRECISION, not an integer index): a
-- reorder only ever needs to rewrite the ONE row being moved (new
-- position = midpoint of its new neighbors, or ±1000 past whichever
-- end it lands at) instead of renumbering an entire column on every
-- drag — same technique Trello popularized.
--
-- Backfilled from each row's existing `last_message_at` ordering (most
-- recent first, gaps of 1000) so today's implicit sort is preserved
-- until an agent actually drags something.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kanban_position DOUBLE PRECISION;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM conversations
  WHERE kanban_position IS NULL
)
UPDATE conversations c
SET kanban_position = ranked.rn * 1000
FROM ranked
WHERE c.id = ranked.id;
