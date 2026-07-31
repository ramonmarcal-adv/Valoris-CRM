"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import { Clock, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ScheduledMessage } from "@/types";

/**
 * Account-wide "Mensagens agendadas" panel (Área D.3) — triggered from the
 * conversation-list toolbar (not scoped to one open conversation, matching
 * the reference screenshot where the clock icon sits next to the search
 * bar). Lists every pending scheduled_messages row for the account with a
 * cancel action; actually dispatching them at their scheduled time happens
 * server-side (Área D.4's cron route), not here.
 */
export function ScheduledMessagesPanel() {
  const t = useTranslations("Inbox.scheduledMessages");
  const dateLocale = useDateFnsLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchScheduled = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("scheduled_messages")
      .select("*, conversation:conversations(id, contact:contacts(name, phone))")
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true });
    setLoading(false);
    setMessages((data as ScheduledMessage[]) ?? []);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchScheduled();
    }
  }, [open, fetchScheduled]);

  const handleCancel = useCallback(
    async (id: string) => {
      const snapshot = messages;
      setMessages((prev) => prev.filter((m) => m.id !== id));
      const supabase = createClient();
      const { error } = await supabase
        .from("scheduled_messages")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) {
        toast.error(t("cancelFailed"));
        setMessages(snapshot);
      }
    },
    [messages, t],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={t("title")}
        className={cn(
          "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
          messages.length > 0 ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Clock className="h-4 w-4" />
        {messages.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {messages.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">{t("title")}</p>
        </div>
        <div className="scrollbar-thin max-h-80 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="space-y-1.5">
              {messages.map((m) => {
                const displayName = m.conversation?.contact?.name || m.conversation?.contact?.phone || t("unknownContact");
                return (
                  <div key={m.id} className="group flex items-start justify-between gap-2 rounded-lg bg-muted px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{displayName}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{m.content_text}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {format(new Date(m.scheduled_at), "MMM d, yyyy HH:mm", { locale: dateLocale })}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCancel(m.id)}
                      title={t("cancel")}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
