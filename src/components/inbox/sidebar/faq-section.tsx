"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { CircleHelp, RefreshCw } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { FaqEntry } from "@/types";

interface FaqSectionProps {
  /** Tag ids for the active contact — shared from TagsSection so this
   *  doesn't re-fetch contact_tags itself. */
  tagIds: string[];
}

export function FaqSection({ tagIds }: FaqSectionProps) {
  const t = useTranslations("Inbox.sidebar.faq");
  const [entries, setEntries] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFaqs = useCallback(async () => {
    if (tagIds.length === 0) {
      setEntries([]);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("faq_entries")
      .select("*, faq_entry_tags!inner(tag_id)")
      .in("faq_entry_tags.tag_id", tagIds);
    setLoading(false);

    const seen = new Set<string>();
    const deduped: FaqEntry[] = [];
    for (const row of (data as (FaqEntry & { faq_entry_tags?: unknown })[]) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const entry: FaqEntry & { faq_entry_tags?: unknown } = { ...row };
      delete entry.faq_entry_tags;
      deduped.push(entry);
    }
    setEntries(deduped);
  }, [tagIds]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFaqs();
  }, [fetchFaqs]);

  return (
    <Accordion defaultValue={["faq"]}>
      <AccordionItem value="faq" className="border-none">
        <div className="flex items-center gap-1 px-1">
          <AccordionTrigger className="flex-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <CircleHelp className="h-3 w-3" />
              {t("title")}
              {entries.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] normal-case">{entries.length}</span>
              )}
            </span>
          </AccordionTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetchFaqs();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={t("refresh")}
          >
            <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </button>
        </div>
        <AccordionContent>
          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">{t("empty")}</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs font-medium text-foreground">{entry.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.answer}</p>
                </div>
              ))
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
