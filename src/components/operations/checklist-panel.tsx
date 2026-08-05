"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeChecklistProgress, toggleChecklistItem } from "@/lib/operations/checklists";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationChecklist, OperationChecklistItem } from "@/types";

interface ChecklistPanelProps {
  /** Exactly one of cardId/taskId — mirrors the DB's XOR constraint (068). */
  cardId?: string | null;
  taskId?: string | null;
}

export function ChecklistPanel({ cardId, taskId }: ChecklistPanelProps) {
  const t = useTranslations("Operations.cardDetail.checklists");
  const supabase = createClient();

  const [checklists, setChecklists] = useState<OperationChecklist[]>([]);
  const [itemsByChecklist, setItemsByChecklist] = useState<Map<string, OperationChecklistItem[]>>(new Map());
  const [newItemText, setNewItemText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    let query = supabase.from("operation_checklists").select("*");
    query = cardId ? query.eq("card_id", cardId) : query.eq("task_id", taskId as string);
    const { data: checklistRows } = await query.order("position");
    const checklistList = (checklistRows ?? []) as OperationChecklist[];
    setChecklists(checklistList);

    if (checklistList.length === 0) {
      setItemsByChecklist(new Map());
      return;
    }
    const { data: itemRows } = await supabase
      .from("operation_checklist_items")
      .select("*")
      .in("checklist_id", checklistList.map((c) => c.id))
      .order("position");
    const grouped = new Map<string, OperationChecklistItem[]>();
    for (const item of (itemRows ?? []) as OperationChecklistItem[]) {
      const bucket = grouped.get(item.checklist_id) ?? [];
      bucket.push(item);
      grouped.set(item.checklist_id, bucket);
    }
    setItemsByChecklist(grouped);
  }, [supabase, cardId, taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAddChecklist() {
    const { error } = await supabase.from("operation_checklists").insert({
      card_id: cardId ?? null,
      task_id: taskId ?? null,
      title: t("defaultTitle"),
      position: checklists.length,
    });
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  async function handleRemoveChecklist(checklistId: string) {
    const { error } = await supabase.from("operation_checklists").delete().eq("id", checklistId);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  async function handleRenameChecklist(checklistId: string, title: string) {
    await supabase.from("operation_checklists").update({ title }).eq("id", checklistId);
  }

  async function handleToggleItem(item: OperationChecklistItem) {
    const { error } = await toggleChecklistItem(supabase, item.id, !item.is_done);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  async function handleAddItem(checklistId: string) {
    const text = (newItemText[checklistId] ?? "").trim();
    if (!text) return;
    const items = itemsByChecklist.get(checklistId) ?? [];
    const { error } = await supabase.from("operation_checklist_items").insert({
      checklist_id: checklistId,
      item_text: text,
      position: items.length * 1000 + 1000,
    });
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    setNewItemText((prev) => ({ ...prev, [checklistId]: "" }));
    load();
  }

  async function handleRemoveItem(itemId: string) {
    const { error } = await supabase.from("operation_checklist_items").delete().eq("id", itemId);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  return (
    <div className="space-y-4">
      {checklists.length === 0 && <p className="text-xs text-muted-foreground">{t("noChecklists")}</p>}
      {checklists.map((checklist) => {
        const items = itemsByChecklist.get(checklist.id) ?? [];
        const progress = computeChecklistProgress(items);
        return (
          <div key={checklist.id} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Input
                defaultValue={checklist.title}
                onBlur={(e) => handleRenameChecklist(checklist.id, e.target.value.trim() || checklist.title)}
                className="h-7 flex-1 border-transparent bg-transparent text-sm font-medium text-foreground focus:border-border"
              />
              <button
                type="button"
                onClick={() => handleRemoveChecklist(checklist.id)}
                className="shrink-0 text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {progress !== null && (
              <div className="mt-1.5 flex items-center gap-2">
                <Progress value={progress} className="h-1" />
                <span className="shrink-0 text-[10px] text-muted-foreground">{progress}%</span>
              </div>
            )}

            <div className="mt-2 space-y-1">
              {items.map((item) => (
                <div key={item.id} className="group flex items-center gap-2">
                  <Checkbox checked={item.is_done} onCheckedChange={() => handleToggleItem(item)} />
                  <span className={item.is_done ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm text-foreground"}>
                    {item.item_text}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="shrink-0 text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <Input
                value={newItemText[checklist.id] ?? ""}
                onChange={(e) => setNewItemText((prev) => ({ ...prev, [checklist.id]: e.target.value }))}
                placeholder={t("newItemPlaceholder")}
                className="h-7 flex-1 border-border bg-muted text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddItem(checklist.id);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAddItem(checklist.id)}
                disabled={!(newItemText[checklist.id] ?? "").trim()}
                className="h-7 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}

      <Button
        variant="outline"
        size="sm"
        onClick={handleAddChecklist}
        className="border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t("addChecklist")}
      </Button>
    </div>
  );
}
