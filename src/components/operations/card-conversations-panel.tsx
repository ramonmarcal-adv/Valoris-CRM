"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Conversation, OperationCardConversation } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function CardConversationsPanel({ cardId }: { cardId: string }) {
  const t = useTranslations("Operations.cardDetail.conversations");
  const supabase = createClient();

  const [links, setLinks] = useState<OperationCardConversation[]>([]);
  const [conversationsById, setConversationsById] = useState<Map<string, Conversation>>(new Map());
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");

  const load = useCallback(async () => {
    const [{ data: linkRows }, { data: conversations }] = await Promise.all([
      supabase.from("operation_card_conversations").select("*").eq("card_id", cardId),
      supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false })
        .limit(200),
    ]);
    setLinks((linkRows ?? []) as OperationCardConversation[]);
    const conversationList = (conversations ?? []) as Conversation[];
    setAllConversations(conversationList);
    setConversationsById(new Map(conversationList.map((c) => [c.id, c])));
  }, [supabase, cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    if (!selectedConversationId) return;
    const { error } = await supabase
      .from("operation_card_conversations")
      .insert({ card_id: cardId, conversation_id: selectedConversationId });
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    setSelectedConversationId("");
    load();
  }

  async function handleRemove(link: OperationCardConversation) {
    const { error } = await supabase.from("operation_card_conversations").delete().eq("id", link.id);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  function conversationLabel(conversation?: Conversation) {
    return conversation?.contact?.name || conversation?.contact?.phone || t("unknownConversation");
  }

  const linkedConversationIds = new Set(links.map((l) => l.conversation_id));

  return (
    <div className="space-y-2">
      {links.length === 0 && <p className="text-xs text-muted-foreground">{t("noConversations")}</p>}
      {links.map((link) => {
        const conversation = conversationsById.get(link.conversation_id);
        return (
          <div
            key={link.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs"
          >
            <Link
              href={`/inbox?c=${link.conversation_id}`}
              className="flex min-w-0 items-center gap-1.5 text-foreground hover:underline"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{conversationLabel(conversation)}</span>
            </Link>
            <button type="button" onClick={() => handleRemove(link)} className="shrink-0 text-muted-foreground hover:text-red-400">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-1.5">
        <Select value={selectedConversationId} onValueChange={(v) => setSelectedConversationId(v ?? "")}>
          <SelectTrigger className="h-8 flex-1 bg-muted text-xs">
            <SelectValue placeholder={t("selectConversation")} />
          </SelectTrigger>
          <SelectContent>
            {allConversations
              .filter((c) => !linkedConversationIds.has(c.id))
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {conversationLabel(c)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!selectedConversationId}
          className="h-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
