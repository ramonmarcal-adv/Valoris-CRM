import type { Conversation, Contact, ConversationStatus, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

export type ReminderPresenceFilter = "all" | "any" | "manual" | "automated";

/**
 * Whether a conversation passes the "Lembretes e follow-ups" / "Só
 * lembretes" / "Só follow-ups automáticos" Inbox filters. Client-side
 * over a one-shot `contact_reminders` fetch (same "load once, filter
 * client-side" shape as {@link matchesContactFilters}'s tags) rather than
 * a per-click server round-trip — reminder volume per account is small
 * and agent-paced, so this stays cheap without a new query surface.
 */
export function matchesReminderFilter(
  conversation: Conversation,
  filter: ReminderPresenceFilter,
  manualReminderConvIds: Set<string>,
  automatedReminderConvIds: Set<string>,
): boolean {
  if (filter === "any") {
    return manualReminderConvIds.has(conversation.id) || automatedReminderConvIds.has(conversation.id);
  }
  if (filter === "manual") return manualReminderConvIds.has(conversation.id);
  if (filter === "automated") return automatedReminderConvIds.has(conversation.id);
  return true;
}

// ============================================================
// Shared filter criteria — lifted to inbox/page.tsx (2026-08-03) so
// the same search/type/assignment/tag/company/reminder filters apply
// in both the List and the Kanban board, instead of being List-only.
// ============================================================

export type InboxTypeFilter =
  | ConversationStatus
  | "all"
  | "unread"
  | "favorites"
  | "groups"
  | "reminders"
  | "manualReminders"
  | "automatedReminders";

/** Independent from {@link InboxTypeFilter} — combines by AND, same as
 *  the tag/company filters below. */
export type InboxAssignmentFilter = "all" | "mine" | "unassigned";

export interface InboxFilterCriteria {
  typeFilter: InboxTypeFilter;
  assignmentFilter: InboxAssignmentFilter;
  currentUserId: string | null | undefined;
  search: string;
  tagIds: string[];
  company: string | null;
  manualReminderConvIds: Set<string>;
  automatedReminderConvIds: Set<string>;
}

/**
 * Applies every Inbox filter criterion — type/status, assignment
 * scope, contact tags/company, reminder presence, and free-text
 * search — in one pass. Does NOT sort; List and Kanban each apply
 * their own ordering afterward (pinned-first for List, per-column
 * sort mode for Kanban).
 */
export function applyInboxFilters(
  conversations: Conversation[],
  criteria: InboxFilterCriteria,
): Conversation[] {
  const {
    typeFilter,
    assignmentFilter,
    currentUserId,
    search,
    tagIds,
    company,
    manualReminderConvIds,
    automatedReminderConvIds,
  } = criteria;

  let result = conversations.filter((c) => !c.is_archived);

  if (typeFilter === "unread") {
    result = result.filter((c) => c.unread_count > 0);
  } else if (typeFilter === "favorites") {
    result = result.filter((c) => c.is_favorite);
  } else if (typeFilter === "groups") {
    result = result.filter((c) => c.is_group);
  } else if (
    typeFilter === "reminders" ||
    typeFilter === "manualReminders" ||
    typeFilter === "automatedReminders"
  ) {
    const reminderFilter =
      typeFilter === "reminders" ? "any" : typeFilter === "manualReminders" ? "manual" : "automated";
    result = result.filter((c) =>
      matchesReminderFilter(c, reminderFilter, manualReminderConvIds, automatedReminderConvIds),
    );
  } else if (typeFilter !== "all") {
    result = result.filter((c) => c.status === typeFilter);
  }

  if (assignmentFilter === "mine") {
    result = result.filter((c) => c.assigned_agent_id === currentUserId);
  } else if (assignmentFilter === "unassigned") {
    result = result.filter((c) => !c.assigned_agent_id);
  }

  if (tagIds.length > 0 || company !== null) {
    result = result.filter((c) => matchesContactFilters(c, { tagIds, company }));
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter((c) => {
      const name = c.contact?.name?.toLowerCase() ?? "";
      const phone = c.contact?.phone?.toLowerCase() ?? "";
      const lastMsg = c.last_message_text?.toLowerCase() ?? "";
      return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
    });
  }

  return result;
}
