"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, Profile } from "@/types";
import { Pin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFnsLocale } from "@/lib/date-locale";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationContextMenu } from "./conversation-context-menu";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  /** Already filtered by the parent's shared search/type/assignment/
   *  tag/company/reminder criteria (inbox-filter-bar.tsx, 2026-08-03) —
   *  this component only applies the final pinned-first/recency sort. */
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

  const [loading, setLoading] = useState(true);

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

  const filtered = useMemo(() => {
    // Archived conversations are excluded from the default fetch, but a
    // conversation archived via the context menu while already loaded
    // client-side needs to drop out here too (the parent's `conversations`
    // array isn't re-fetched on every patch). Every other filter
    // criterion is already applied upstream (inbox/page.tsx).
    const result = conversations.filter((c) => !c.is_archived);

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
  }, [conversations]);

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
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
