"use client";

import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Conversation, Profile } from "@/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Pin, PinOff, Star, Mail, Archive, UserPlus, UserX } from "lucide-react";

interface ConversationContextMenuProps {
  conversation: Conversation;
  /** Account members eligible for "Atribuir agente" — fetched once by the
   *  caller (ConversationList / ConversationBoard) and shared across every
   *  row's menu rather than refetched per item. */
  profiles: Profile[];
  onChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  children: React.ReactNode;
}

/**
 * Right-click menu for a conversation-list row / kanban card: pin,
 * favorite, mark unread, archive, assign agent. Every action is a direct
 * optimistic Supabase update gated by RLS (conversations_update, agent+),
 * mirroring the pattern already used for status/assignment changes
 * elsewhere in the Inbox (see handleConversationStatusMoved in
 * app/(dashboard)/inbox/page.tsx).
 */
export function ConversationContextMenu({
  conversation,
  profiles,
  onChanged,
  children,
}: ConversationContextMenuProps) {
  const t = useTranslations("Inbox.contextMenu");

  async function patch(fields: Partial<Conversation>) {
    const previous: Partial<Conversation> = {};
    for (const key of Object.keys(fields) as (keyof Conversation)[]) {
      previous[key] = conversation[key] as never;
    }

    onChanged(conversation.id, fields);

    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update(fields)
      .eq("id", conversation.id);

    if (error) {
      console.error("Failed to update conversation:", error);
      toast.error(t("toastFailed"));
      onChanged(conversation.id, previous);
    }
  }

  const handleTogglePin = () => patch({ is_pinned: !conversation.is_pinned });
  const handleToggleFavorite = () => patch({ is_favorite: !conversation.is_favorite });
  const handleMarkUnread = () =>
    patch({ unread_count: conversation.unread_count > 0 ? conversation.unread_count : 1 });
  const handleArchive = () => patch({ is_archived: true });
  const handleAssign = (agentId: string | null) => patch({ assigned_agent_id: agentId ?? undefined });

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleTogglePin}>
            {conversation.is_pinned ? <PinOff /> : <Pin />}
            {conversation.is_pinned ? t("unpin") : t("pin")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleToggleFavorite}>
            <Star />
            {conversation.is_favorite ? t("unfavorite") : t("favorite")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleMarkUnread}>
            <Mail />
            {t("markUnread")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleArchive}>
            <Archive />
            {t("archive")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <UserPlus />
              {t("assignAgent")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {profiles.length === 0 ? (
                <ContextMenuItem disabled>{t("noTeammates")}</ContextMenuItem>
              ) : (
                profiles.map((p) => (
                  <ContextMenuItem key={p.user_id} onClick={() => handleAssign(p.user_id)}>
                    {p.full_name || p.email}
                  </ContextMenuItem>
                ))
              )}
              {conversation.assigned_agent_id && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleAssign(null)}>
                    <UserX />
                    {t("unassign")}
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
