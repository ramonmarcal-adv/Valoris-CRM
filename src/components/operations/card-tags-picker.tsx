"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tag } from "@/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface CardTagsPickerProps {
  cardId: string;
  readOnly?: boolean;
}

export function CardTagsPicker({ cardId, readOnly }: CardTagsPickerProps) {
  const t = useTranslations("Operations.cardDetail.tags");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState("");

  const load = useCallback(async () => {
    const [{ data: tags }, { data: links }] = await Promise.all([
      supabase.from("tags").select("*").order("name"),
      supabase.from("operation_card_tags").select("tag_id").eq("card_id", cardId),
    ]);
    setAllTags((tags ?? []) as Tag[]);
    setSelectedTagIds(new Set((links ?? []).map((l) => l.tag_id as string)));
  }, [supabase, cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function toggleTag(tagId: string) {
    if (selectedTagIds.has(tagId)) {
      const { error } = await supabase.from("operation_card_tags").delete().eq("card_id", cardId).eq("tag_id", tagId);
      if (error) {
        toast.error(t("toastFailed"));
        return;
      }
    } else {
      const { error } = await supabase.from("operation_card_tags").insert({ card_id: cardId, tag_id: tagId });
      if (error) {
        toast.error(t("toastFailed"));
        return;
      }
    }
    load();
  }

  async function createAndAddTag() {
    const trimmed = newTagName.trim();
    if (!trimmed || !accountId) return;
    const { data, error } = await supabase.from("tags").insert({ account_id: accountId, name: trimmed }).select().single();
    if (error || !data) {
      toast.error(t("toastFailedCreate"));
      return;
    }
    setNewTagName("");
    await supabase.from("operation_card_tags").insert({ card_id: cardId, tag_id: data.id });
    load();
  }

  const selectedTags = allTags.filter((tag) => selectedTagIds.has(tag.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
          {!readOnly && (
            <button type="button" onClick={() => toggleTag(tag.id)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="h-3 w-3" />
            {t("addTag")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto border-border bg-popover">
            {allTags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selectedTagIds.has(tag.id)}
                onCheckedChange={() => toggleTag(tag.id)}
                className="text-sm text-popover-foreground"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            <div className="flex items-center gap-1 border-t border-border p-1.5">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t("newTagPlaceholder")}
                className="h-7 border-border bg-muted text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") createAndAddTag();
                }}
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
