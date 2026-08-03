"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  matchesReminderFilter,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { releaseMyLeads, redistributeQueue } from "@/lib/inbox/bulk-actions";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Profile, Tag } from "@/types";
import { Search, ChevronDown, X, Pin, Inbox as InboxIcon, Shuffle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFnsLocale } from "@/lib/date-locale";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationContextMenu } from "./conversation-context-menu";
import { ScheduledMessagesPanel } from "./scheduled-messages-panel";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /** Account members for the right-click menu's "Atribuir agente" submenu. */
  profiles: Profile[];
  /** Applies an optimistic patch from the context menu (pin/favorite/
   *  mark-unread/archive/assign) to the parent's conversation state. */
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
}

export const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter =
  | ConversationStatus
  | "all"
  | "unread"
  | "favorites"
  | "groups"
  | "reminders"
  | "manualReminders"
  | "automatedReminders";

/** Independent from `InboxFilter` — combines by AND, same as the existing
 *  tag/company filters, so e.g. "Grupos" + "Minhas" can apply together. */
type AssignmentFilter = "all" | "mine" | "unassigned";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  profiles,
  onConversationChanged,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterFavorites"), value: "favorites" },
    { label: t("filterGroups"), value: "groups" },
    { label: t("filterReminders"), value: "reminders" },
    { label: t("filterManualReminders"), value: "manualReminders" },
    { label: t("filterAutomatedReminders"), value: "automatedReminders" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const { user, accountId, canSendMessages, canManageMembers } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [loading, setLoading] = useState(true);
  const [releasingLeads, setReleasingLeads] = useState(false);
  const [redistributing, setRedistributing] = useState(false);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  const refetchConversations = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("is_archived", false)
      .order("is_pinned", { ascending: false })
      .order("last_message_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch conversations:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return;
    }

    onConversationsLoadedRef.current(normalizeConversations(data ?? []));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await refetchConversations();
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken, refetchConversations]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Open reminders per conversation, for the "Lembretes e follow-ups" /
  // "Só lembretes" / "Só follow-ups automáticos" filters — one-shot fetch,
  // client-side filtering (same shape as the tags fetch above). Not
  // realtime-synced: a reminder created by an automation while this tab is
  // open only shows up here after the next mount/resync, same tradeoff the
  // tags fetch already has.
  const [manualReminderConvIds, setManualReminderConvIds] = useState<Set<string>>(new Set());
  const [automatedReminderConvIds, setAutomatedReminderConvIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("contact_reminders")
        .select("conversation_id, source")
        .is("completed_at", null)
        .not("conversation_id", "is", null);
      if (cancelled || !data) return;
      const manual = new Set<string>();
      const automated = new Set<string>();
      for (const row of data as { conversation_id: string; source: string }[]) {
        (row.source === "automated" ? automated : manual).add(row.conversation_id);
      }
      setManualReminderConvIds(manual);
      setAutomatedReminderConvIds(automated);
    })();
    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    // Archived conversations are excluded from the default fetch, but a
    // conversation archived via the context menu while already loaded
    // client-side needs to drop out here too (the parent's `conversations`
    // array isn't re-fetched on every patch).
    let result = conversations.filter((c) => !c.is_archived);

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === "favorites") {
      result = result.filter((c) => c.is_favorite);
    } else if (filter === "groups") {
      result = result.filter((c) => c.is_group);
    } else if (filter === "reminders" || filter === "manualReminders" || filter === "automatedReminders") {
      const reminderFilter = filter === "reminders" ? "any" : filter === "manualReminders" ? "manual" : "automated";
      result = result.filter((c) =>
        matchesReminderFilter(c, reminderFilter, manualReminderConvIds, automatedReminderConvIds),
      );
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Assignment scope — independent of the type filter above, combines
    // by AND (e.g. "Grupos" + "Minhas" can apply together).
    if (assignmentFilter === "mine") {
      result = result.filter((c) => c.assigned_agent_id === user?.id);
    } else if (assignmentFilter === "unassigned") {
      result = result.filter((c) => !c.assigned_agent_id);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
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

    // Pinned conversations float to the top; within each group, most
    // recent activity first. Always re-derived from last_message_at
    // rather than relying on the array's existing order — realtime
    // events patch a conversation's last_message_at in place (see
    // handleMessageEvent/handleConversationEvent in the inbox page),
    // which changes the field but not the array index, so a stale
    // "it was already sorted at fetch time" assumption here silently
    // drifted out of order as messages arrived.
    return [...result].sort((a, b) => {
      const pinDiff = Number(b.is_pinned) - Number(a.is_pinned);
      if (pinDiff !== 0) return pinDiff;
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [
    conversations,
    filter,
    assignmentFilter,
    user?.id,
    search,
    selectedTagIds,
    selectedCompany,
    manualReminderConvIds,
    automatedReminderConvIds,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  const ASSIGNMENT_OPTIONS: { label: string; value: AssignmentFilter }[] = useMemo(
    () => [
      { label: t("assignmentAll"), value: "all" },
      { label: t("assignmentMine"), value: "mine" },
      { label: t("assignmentUnassigned"), value: "unassigned" },
    ],
    [t],
  );
  const activeAssignmentFilter = ASSIGNMENT_OPTIONS.find((o) => o.value === assignmentFilter);
  const unassignedCount = useMemo(
    () => conversations.filter((c) => !c.is_archived && !c.assigned_agent_id).length,
    [conversations],
  );

  const handleReleaseMyLeads = useCallback(async () => {
    if (!accountId || !user?.id || releasingLeads) return;
    setReleasingLeads(true);
    const supabase = createClient();
    const { data, error } = await releaseMyLeads(supabase, accountId, user.id);
    setReleasingLeads(false);
    if (error) {
      toast.error(t("toastReleaseFailed"));
      return;
    }
    toast.success(t("toastReleasedCount", { count: data?.length ?? 0 }));
    await refetchConversations();
  }, [accountId, user, releasingLeads, t, refetchConversations]);

  const handleRedistributeQueue = useCallback(async () => {
    if (redistributing) return;
    setRedistributing(true);
    const supabase = createClient();
    const { data, error } = await redistributeQueue(supabase);
    setRedistributing(false);
    if (error) {
      toast.error(t("toastRedistributeFailed"));
      return;
    }
    toast.success(t("toastRedistributedCount", { count: (data as number) ?? 0 }));
    await refetchConversations();
  }, [redistributing, t, refetchConversations]);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder={t("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>
          <ScheduledMessagesPanel />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assignment scope: Todas/Minhas/Fila + bulk actions
              (Liberar meus leads / Redistribuir fila). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignmentFilter !== "all" ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <InboxIcon className="h-3 w-3" />
              {activeAssignmentFilter?.label ?? t("assignmentAll")}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              {ASSIGNMENT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setAssignmentFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    assignmentFilter === opt.value ? "text-primary" : "text-popover-foreground",
                  )}
                >
                  <span className="flex-1">{opt.label}</span>
                  {opt.value === "unassigned" && (
                    <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                      {unassignedCount}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                disabled={!canSendMessages || releasingLeads}
                onClick={handleReleaseMyLeads}
                className="text-sm text-popover-foreground"
              >
                {t("releaseMyLeads")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canManageMembers || redistributing}
                onClick={handleRedistributeQueue}
                title={!canManageMembers ? t("redistributeQueueAdminOnly") : undefined}
                className="text-sm text-popover-foreground"
              >
                <Shuffle className="h-3 w-3" />
                {t("redistributeQueue")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                profiles={profiles}
                onConversationChanged={onConversationChanged}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  profiles,
  onConversationChanged,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();
  const dateLocale = useDateFnsLocale();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: dateLocale,
      })
    : "";

  return (
    <ConversationContextMenu
      conversation={conversation}
      profiles={profiles}
      onChanged={onConversationChanged}
    >
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
          isActive && "border-l-2 border-primary bg-muted/70"
        )}
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {conversation.is_pinned && (
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {conversation.last_message_text || t("noMessagesYet")}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </ConversationContextMenu>
  );
}
