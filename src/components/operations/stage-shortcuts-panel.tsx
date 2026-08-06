"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  STAGE_SHORTCUT_ACTION_TYPES,
  getStageShortcuts,
  removeStageShortcut,
  upsertStageShortcut,
} from "@/lib/operations/automations/stage-shortcuts";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type {
  OperationAutomationStepType,
  OperationChecklistTemplate,
  OperationTaskTemplate,
  Profile,
} from "@/types";

interface StageShortcutsPanelProps {
  accountId: string;
  boardId: string;
  stageId: string;
  stageName: string;
}

const PRIORITIES = ["low", "normal", "high", "urgent"];

export function StageShortcutsPanel({ accountId, boardId, stageId, stageName }: StageShortcutsPanelProps) {
  const t = useTranslations("Operations.stageSettings.shortcuts");
  const tPriority = useTranslations("Operations.priority");
  const supabase = createClient();

  const [shortcuts, setShortcuts] = useState<Map<OperationAutomationStepType, Record<string, unknown>>>(new Map());
  const [checklistTemplates, setChecklistTemplates] = useState<OperationChecklistTemplate[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<OperationTaskTemplate[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [rows, { data: checklistTpl }, { data: taskTpl }, { data: profileRows }] = await Promise.all([
        getStageShortcuts(supabase, boardId, stageId),
        supabase.from("operation_checklist_templates").select("*").is("archived_at", null).or(`board_id.is.null,board_id.eq.${boardId}`),
        supabase.from("operation_task_templates").select("*").is("archived_at", null).or(`board_id.is.null,board_id.eq.${boardId}`),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      setShortcuts(new Map(rows.map((r) => [r.actionType, r.stepConfig])));
      setChecklistTemplates((checklistTpl ?? []) as OperationChecklistTemplate[]);
      setTaskTemplates((taskTpl ?? []) as OperationTaskTemplate[]);
      setProfiles((profileRows ?? []) as Profile[]);
      setLoading(false);
    })();
  }, [supabase, boardId, stageId]);

  async function handleToggle(actionType: OperationAutomationStepType, enabled: boolean) {
    if (!enabled) {
      const { error } = await removeStageShortcut(supabase, boardId, stageId, actionType);
      if (error) {
        toast.error(t("toastFailed"));
        return;
      }
      setShortcuts((prev) => {
        const next = new Map(prev);
        next.delete(actionType);
        return next;
      });
      return;
    }
    // Enabling with no value picked yet — store an empty config; the
    // select's own onChange (below) fills it in once the user picks one.
    setShortcuts((prev) => new Map(prev).set(actionType, {}));
  }

  async function handleValueChange(actionType: OperationAutomationStepType, stepConfig: Record<string, unknown>) {
    setShortcuts((prev) => new Map(prev).set(actionType, stepConfig));
    const { error } = await upsertStageShortcut(supabase, { accountId, boardId, stageId, stageName, actionType, stepConfig });
    if (error) toast.error(t("toastFailed"));
  }

  if (loading) return <div className="h-8 animate-pulse rounded bg-muted/50" />;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{t("onEnter")}</p>
      {STAGE_SHORTCUT_ACTION_TYPES.map((actionType) => {
        const enabled = shortcuts.has(actionType);
        const config = shortcuts.get(actionType) ?? {};
        return (
          <div key={actionType} className="flex items-center gap-2">
            <Checkbox checked={enabled} onCheckedChange={(v) => handleToggle(actionType, v === true)} />
            <span className="w-36 shrink-0 text-xs text-foreground">{t(`action.${actionType}`)}</span>
            {enabled && (
              <>
                {actionType === "apply_checklist_template" && (
                  <Select value={(config.template_id as string) ?? ""} onValueChange={(v) => v && handleValueChange(actionType, { template_id: v })}>
                    <SelectTrigger className="h-7 flex-1 bg-muted text-xs">
                      <SelectValue placeholder={t("selectTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {checklistTemplates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {actionType === "apply_task_template" && (
                  <Select value={(config.template_id as string) ?? ""} onValueChange={(v) => v && handleValueChange(actionType, { template_id: v })}>
                    <SelectTrigger className="h-7 flex-1 bg-muted text-xs">
                      <SelectValue placeholder={t("selectTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {taskTemplates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {actionType === "assign_card" && (
                  <Select value={(config.user_id as string) ?? ""} onValueChange={(v) => v && handleValueChange(actionType, { user_id: v })}>
                    <SelectTrigger className="h-7 flex-1 bg-muted text-xs">
                      <SelectValue placeholder={t("selectUser")} />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.user_id}>{p.full_name ?? p.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {actionType === "change_priority" && (
                  <Select value={(config.priority as string) ?? ""} onValueChange={(v) => v && handleValueChange(actionType, { priority: v })}>
                    <SelectTrigger className="h-7 flex-1 bg-muted text-xs">
                      <SelectValue placeholder={t("selectPriority")} />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{tPriority(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
