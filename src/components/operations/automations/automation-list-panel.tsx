"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CARD_TRIGGER_TYPES } from "@/lib/operations/automations/trigger-meta";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationAutomation } from "@/types";

interface AutomationListPanelProps {
  boardId: string;
  accountId: string;
}

export function AutomationListPanel({ boardId, accountId }: AutomationListPanelProps) {
  const t = useTranslations("Operations.automations.list");
  const tTrigger = useTranslations("Operations.automations.triggerType");
  const router = useRouter();
  const supabase = createClient();

  const [automations, setAutomations] = useState<OperationAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("operation_automations")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false });
    setAutomations((data ?? []) as OperationAutomation[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  async function handleToggleActive(automation: OperationAutomation) {
    const { error } = await supabase
      .from("operation_automations")
      .update({ is_active: !automation.is_active })
      .eq("id", automation.id);
    if (error) {
      toast.error(t("toastFailedToggle"));
      return;
    }
    load();
  }

  async function handleDelete(automationId: string) {
    const { error } = await supabase.from("operation_automations").delete().eq("id", automationId);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    load();
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("operation_automations")
      .insert({
        account_id: accountId,
        board_id: boardId,
        name: trimmed,
        trigger_type: CARD_TRIGGER_TYPES[0],
        trigger_config: {},
        conditions: [],
        is_active: false,
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(t("toastFailedCreate"));
      return;
    }
    router.push(`/operations/boards/${boardId}/automations/${data.id}`);
  }

  if (loading) {
    return <div className="h-32 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setNewDialogOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("newAutomation")}
        </Button>
      </div>

      {automations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
          <p className="text-sm text-muted-foreground">{t("noAutomations")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((automation) => (
            <div
              key={automation.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <Switch checked={automation.is_active} onCheckedChange={() => handleToggleActive(automation)} />
              <button
                type="button"
                onClick={() => router.push(`/operations/boards/${boardId}/automations/${automation.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-foreground">{automation.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {tTrigger(automation.trigger_type)}
                  {automation.execution_count > 0 && ` · ${t("executedCount", { count: automation.execution_count })}`}
                </p>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDelete(automation.id)}
                className="text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newAutomation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="border-border bg-muted text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setNewDialogOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {creating ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
