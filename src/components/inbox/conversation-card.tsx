"use client";

import type { Conversation, Profile } from "@/types";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFnsLocale } from "@/lib/date-locale";
import { Pin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ConversationContextMenu } from "./conversation-context-menu";

interface ConversationCardProps {
  conversation: Conversation;
  onSelect: (conversation: Conversation) => void;
  isOverlay?: boolean;
  /** Omitted for the DragOverlay ghost copy, which never needs a menu. */
  profiles?: Profile[];
  onConversationChanged?: (conversationId: string, patch: Partial<Conversation>) => void;
  /** Bulk-select checkbox — omit both to hide it entirely. */
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function ConversationCard({
  conversation,
  onSelect,
  isOverlay,
  profiles,
  onConversationChanged,
  selected,
  onToggleSelect,
}: ConversationCardProps) {
  const t = useTranslations("Inbox.conversationList");
  const dateLocale = useDateFnsLocale();
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initial = displayName.charAt(0).toUpperCase();
  const tags = contact?.tags ?? [];

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: dateLocale,
      })
    : "";

  const card = (
    <button
      type="button"
      onClick={(e) => {
        // Mirrors DealCard: PointerSensor requires 5px movement before a
        // drag registers, so a plain tap still reaches this handler.
        if (isOverlay) return;
        e.stopPropagation();
        onSelect(conversation);
      }}
      className={cn(
        "group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 px-3 py-3 text-left shadow-sm transition-all",
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg",
        selected && "border-primary/60 bg-primary/5",
      )}
    >
      {onToggleSelect && (
        // Own click target, separate from the card's — stopPropagation
        // keeps it from also opening the conversation or starting a drag.
        <div
          className="absolute left-2 top-2 z-10"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={!!selected}
            onCheckedChange={() => onToggleSelect()}
            className="bg-card"
          />
        </div>
      )}
      <div className={cn("flex items-start gap-2", onToggleSelect && "pl-5")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
          {contact?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {conversation.is_pinned && (
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {displayName}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="max-w-16 truncate">{tag.name}</span>
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {conversation.unread_count > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {conversation.unread_count}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{timeAgo}</span>
        </div>
      </div>
    </button>
  );

  if (isOverlay || !profiles || !onConversationChanged) return card;

  return (
    <ConversationContextMenu
      conversation={conversation}
      profiles={profiles}
      onChanged={onConversationChanged}
    >
      {card}
    </ConversationContextMenu>
  );
}
