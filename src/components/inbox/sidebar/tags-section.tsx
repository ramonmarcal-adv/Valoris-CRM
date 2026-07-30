"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Tag as TagIcon, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { Contact, Tag } from "@/types";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface TagsSectionProps {
  contact: Contact;
  /** Reported after fetch so sibling sections (FAQ) can scope by the same
   *  tag ids without a second round-trip. */
  onTagsLoaded?: (tagIds: string[]) => void;
}

export function TagsSection({ contact, onTagsLoaded }: TagsSectionProps) {
  const t = useTranslations("Inbox.sidebar.tagsSection");
  const { accountId, canSendMessages } = useAuth();

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [toggling, setToggling] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[5]);
  const [saving, setSaving] = useState(false);

  const fetchTags = useCallback(async () => {
    const supabase = createClient();
    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from("tags").select("*").order("name"),
      supabase.from("contact_tags").select("tag_id").eq("contact_id", contact.id),
    ]);
    setAllTags((tagsRes.data as Tag[]) ?? []);
    const ids = (contactTagsRes.data ?? []).map((ct) => ct.tag_id as string);
    setContactTagIds(ids);
    onTagsLoaded?.(ids);
  }, [contact.id, onTagsLoaded]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  const handleToggle = useCallback(
    async (tagId: string) => {
      setToggling(true);
      const isSelected = contactTagIds.includes(tagId);
      try {
        if (isSelected) {
          await deleteContactTag(contact.id, tagId);
          setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        } else {
          await addContactTag(contact.id, tagId);
          setContactTagIds((prev) => [...prev, tagId]);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastUpdateFailed"));
      }
      setToggling(false);
    },
    [contact.id, contactTagIds, t],
  );

  const handleCreate = useCallback(async () => {
    const trimmed = newTagName.trim();
    if (!trimmed || !accountId) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tags")
      .insert({ account_id: accountId, name: trimmed, color: newTagColor })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(t("toastCreateFailed"));
      return;
    }
    const tag = data as Tag;
    setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTagName("");
    setCreating(false);
    // Newly created tags are usually meant to be applied right away.
    await handleToggle(tag.id);
  }, [newTagName, newTagColor, accountId, t, handleToggle]);

  return (
    <Accordion defaultValue={["tags"]}>
      <AccordionItem value="tags" className="border-none">
        <div className="flex items-center gap-1 px-1">
          <AccordionTrigger className="flex-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              <TagIcon className="h-3 w-3" />
              {t("title")}
            </span>
          </AccordionTrigger>
          {canSendMessages && !creating && (
            <button
              onClick={() => setCreating(true)}
              className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              {t("createNewTag")}
            </button>
          )}
        </div>

        <AccordionContent>
          <div className="flex flex-wrap gap-1.5">
            {allTags.length === 0 && !creating ? (
              <p className="px-1 text-xs text-muted-foreground">{t("noTags")}</p>
            ) : (
              allTags.map((tag) => {
                const selected = contactTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleToggle(tag.id)}
                    disabled={toggling}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity",
                      !selected && "opacity-50 hover:opacity-80",
                    )}
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                      boxShadow: selected ? `0 0 0 1px ${tag.color}` : undefined,
                    }}
                  >
                    {selected && <Check className="h-2.5 w-2.5" />}
                    {tag.name}
                  </button>
                );
              })
            )}
          </div>

          {creating && (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/50 p-2">
              <Input
                autoFocus
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t("newTagPlaceholder")}
                className="h-7 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTagColor(c)}
                      className="h-4 w-4 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: newTagColor === c ? "var(--foreground)" : "transparent",
                      }}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setCreating(false)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleCreate}
                    disabled={!newTagName.trim() || saving}
                  >
                    {t("save")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
