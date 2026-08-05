"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Contact, OperationCardContact } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function CardContactsPanel({ cardId }: { cardId: string }) {
  const t = useTranslations("Operations.cardDetail.contacts");
  const supabase = createClient();

  const [links, setLinks] = useState<OperationCardContact[]>([]);
  const [contactsById, setContactsById] = useState<Map<string, Contact>>(new Map());
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");

  const load = useCallback(async () => {
    const [{ data: linkRows }, { data: contacts }] = await Promise.all([
      supabase.from("operation_card_contacts").select("*").eq("card_id", cardId),
      supabase.from("contacts").select("*").order("name"),
    ]);
    setLinks((linkRows ?? []) as OperationCardContact[]);
    const contactList = (contacts ?? []) as Contact[];
    setAllContacts(contactList);
    setContactsById(new Map(contactList.map((c) => [c.id, c])));
  }, [supabase, cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    if (!selectedContactId) return;
    const { error } = await supabase.from("operation_card_contacts").insert({ card_id: cardId, contact_id: selectedContactId });
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    setSelectedContactId("");
    load();
  }

  async function handleRemove(link: OperationCardContact) {
    const { error } = await supabase.from("operation_card_contacts").delete().eq("id", link.id);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  const linkedContactIds = new Set(links.map((l) => l.contact_id));

  return (
    <div className="space-y-2">
      {links.length === 0 && <p className="text-xs text-muted-foreground">{t("noContacts")}</p>}
      {links.map((link) => {
        const contact = contactsById.get(link.contact_id);
        return (
          <div key={link.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs">
            <Link href={`/contacts?id=${link.contact_id}`} className="min-w-0 truncate text-foreground hover:underline">
              {contact?.name || contact?.phone || t("unknownContact")}
            </Link>
            <button type="button" onClick={() => handleRemove(link)} className="shrink-0 text-muted-foreground hover:text-red-400">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-1.5">
        <Select value={selectedContactId} onValueChange={(v) => setSelectedContactId(v ?? "")}>
          <SelectTrigger className="h-8 flex-1 bg-muted text-xs">
            <SelectValue placeholder={t("selectContact")} />
          </SelectTrigger>
          <SelectContent>
            {allContacts
              .filter((c) => !linkedContactIds.has(c.id))
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name || c.phone}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleAdd} disabled={!selectedContactId} className="h-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
