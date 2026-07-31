"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { Search, UserRound } from "lucide-react";
import type { Contact } from "@/types";

interface ContactPickerProps {
  /** Called with the selected contact's phone (bare digits, same
   *  convention as everywhere else a phone gets sent to Evolution). */
  onSelect: (contact: Contact) => void;
}

/**
 * Live contact search dropdown — lets a caller pick an existing saved
 * contact instead of typing a raw phone number. Built on `Popover` +
 * `Input` (the project has no `cmdk`/`Command` component); reuses the
 * same `.ilike` name/phone search the Contacts page itself uses.
 * Excludes group-placeholder rows (migration 049) — picking a WhatsApp
 * group as a group "participant" isn't meaningful.
 */
export function ContactPicker({ onSelect }: ContactPickerProps) {
  const t = useTranslations("Inbox.sidebar.groupInfo");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("contacts")
      .select("*")
      .eq("is_group_placeholder", false)
      .order("name", { ascending: true })
      .limit(8);
    if (term.trim()) {
      const like = `%${term.trim()}%`;
      query = query.or(`name.ilike.${like},phone.ilike.${like}`);
    }
    const { data } = await query;
    setResults((data as Contact[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => runSearch(search), 250);
    return () => clearTimeout(handle);
  }, [search, open, runSearch]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        {t("pickSavedContact")}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" sideOffset={6}>
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchContactsPlaceholder")}
          className="h-8 text-xs"
        />
        <div className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
          {loading ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("searching")}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("noContactsFound")}</p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setSearch("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                  {c.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatar_url} alt="" className="h-6 w-6 object-cover" />
                  ) : (
                    <UserRound className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {c.name || c.phone}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {c.phone}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
