import type { BoardColumnSortMode, Conversation } from "@/types";

export interface ReminderLookupEntry {
  nextManualDueAt: string | null;
  nextAutomatedDueAt: string | null;
}

/** Raw sort key for a conversation under a given mode — null means
 *  "nothing to compare", always sorted last regardless of direction. */
function sortKeyFor(
  conv: Conversation,
  sortBy: BoardColumnSortMode,
  reminderLookup: Map<string, ReminderLookupEntry>,
): string | number | null {
  switch (sortBy) {
    case "last_message_at":
      return conv.last_message_at ?? null;
    case "last_outbound_message_at":
      return conv.last_outbound_message_at ?? null;
    case "last_inbound_message_at":
      return conv.last_inbound_message_at ?? null;
    case "next_reminder_manual":
      return reminderLookup.get(conv.id)?.nextManualDueAt ?? null;
    case "next_reminder_automated":
      return reminderLookup.get(conv.id)?.nextAutomatedDueAt ?? null;
    case "next_reminder_any": {
      const entry = reminderLookup.get(conv.id);
      if (!entry) return null;
      const { nextManualDueAt, nextAutomatedDueAt } = entry;
      if (nextManualDueAt && nextAutomatedDueAt) {
        return nextManualDueAt < nextAutomatedDueAt ? nextManualDueAt : nextAutomatedDueAt;
      }
      return nextManualDueAt ?? nextAutomatedDueAt ?? null;
    }
    case "manual":
      return conv.kanban_position ?? null;
    default:
      return null;
  }
}

/**
 * Comparator for Array.prototype.sort, per Kanban column. Nulls always
 * sort last regardless of direction ("no reminder set"/"never manually
 * ordered" reads as furthest away either way). `manual` ignores
 * `direction` entirely — kanban_position is an explicit, user-dragged
 * order, not a value with a meaningful "reverse" reading; the column
 * header's direction toggle is disabled for this mode in the UI.
 */
export function compareByBoardColumnSort(
  sortBy: BoardColumnSortMode,
  direction: "asc" | "desc",
  reminderLookup: Map<string, ReminderLookupEntry>,
) {
  return (a: Conversation, b: Conversation): number => {
    const ka = sortKeyFor(a, sortBy, reminderLookup);
    const kb = sortKeyFor(b, sortBy, reminderLookup);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (sortBy === "manual") return (ka as number) - (kb as number);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
    return direction === "asc" ? cmp : -cmp;
  };
}
