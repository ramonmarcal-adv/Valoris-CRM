"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OperationCardActivity } from "@/types";
import { useTranslations } from "next-intl";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString();
}

export function CardActivityFeed({ cardId }: { cardId: string }) {
  const t = useTranslations("Operations.cardDetail.activity");
  const supabase = createClient();
  const [events, setEvents] = useState<OperationCardActivity[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("operation_card_activity")
        .select("*")
        .eq("card_id", cardId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setEvents((data ?? []) as OperationCardActivity[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, cardId]);

  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noActivity")}</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="flex items-start justify-between gap-2 text-xs">
          <span className="text-foreground">{t(`events.${event.event_type}`)}</span>
          <span className="shrink-0 text-muted-foreground">{formatDateTime(event.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
