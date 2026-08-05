/**
 * Fractional/gap-based drag-reorder positioning (Trello-style): a
 * reorder only ever needs to rewrite the ONE row being moved, instead
 * of renumbering an entire column on every drag. Originally written
 * for `conversations.kanban_position` (migration 056) and extracted
 * here so `operation_cards.position` (Operações Kanban) can reuse the
 * exact same algorithm instead of duplicating it.
 *
 * Takes the ordered list of neighboring positions (not full entities)
 * so it stays independent of any particular row shape — callers map
 * their own entity array to positions before calling this.
 */
export function computeReorderPosition(
  orderedPositions: (number | null | undefined)[],
  index: number,
): number {
  const before = orderedPositions[index - 1] ?? null;
  const after = orderedPositions[index + 1] ?? null;
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1000;
  if (after != null) return after - 1000;
  return 1000;
}
