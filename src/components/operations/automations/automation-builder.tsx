"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DAYS_SCOPED_TRIGGER_TYPES,
  FIELD_SCOPED_TRIGGER_TYPES,
  STAGE_SCOPED_TRIGGER_TYPES,
  TAG_SCOPED_TRIGGER_TYPES,
  TRIGGER_TYPE_GROUPS,
} from "@/lib/operations/automations/trigger-meta";
import { ADDABLE_STEP_TYPES } from "@/lib/operations/automations/step-meta";
import { validateAutomationForActivation } from "@/lib/operations/automations/validate";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type {
  OperationAutomation,
  OperationAutomationCondition,
  OperationAutomationConditionOperator,
  OperationAutomationConditionSubject,
  OperationAutomationStepType,
  OperationAutomationTriggerType,
  OperationBoardStage,
  OperationCardFieldDef,
  OperationChecklistTemplate,
  OperationTaskTemplate,
  Profile,
  Tag,
} from "@/types";

const CONDITION_SUBJECTS: OperationAutomationConditionSubject[] = [
  "card_field", "card_priority", "task_priority", "card_stage", "task_status",
  "card_assignee", "task_assignee", "card_tag", "task_due_date",
];

const OPERATORS_BY_SUBJECT: Record<OperationAutomationConditionSubject, OperationAutomationConditionOperator[]> = {
  card_field: ["equal", "not_equal", "contains", "not_contains", "empty", "not_empty", "greater_than", "less_than", "date_before", "date_after"],
  card_priority: ["equal", "not_equal"],
  task_priority: ["equal", "not_equal"],
  card_stage: ["equal", "not_equal"],
  task_status: ["equal", "not_equal"],
  card_assignee: ["equal", "empty", "not_empty"],
  task_assignee: ["equal", "empty", "not_empty"],
  card_tag: ["tag_exists", "tag_not_exists"],
  task_due_date: ["date_before", "date_after", "empty", "not_empty"],
};

const DATE_FIELD_TYPES = ["date", "datetime"];

interface AutomationBuilderProps {
  automationId: string;
  boardId: string;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
  tags: Tag[];
  profiles: Profile[];
  taskTemplates: OperationTaskTemplate[];
  checklistTemplates: OperationChecklistTemplate[];
}

interface BuilderStep {
  id: string;
  step_type: OperationAutomationStepType;
  step_config: Record<string, unknown>;
}

export function AutomationBuilder({
  automationId, stages, fieldDefs, tags, profiles, taskTemplates, checklistTemplates,
}: AutomationBuilderProps) {
  const t = useTranslations("Operations.automations.builder");
  const tTrigger = useTranslations("Operations.automations.triggerType");
  const tTriggerGroup = useTranslations("Operations.automations.triggerGroup");
  const tStep = useTranslations("Operations.automations.stepType");
  const tSubject = useTranslations("Operations.automations.conditionSubject");
  const tOperator = useTranslations("Operations.automations.conditionOperator");
  const supabase = createClient();

  const [automation, setAutomation] = useState<OperationAutomation | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [triggerType, setTriggerType] = useState<OperationAutomationTriggerType>("card_created");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [conditions, setConditions] = useState<OperationAutomationCondition[]>([]);
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: a }, { data: stepRows }] = await Promise.all([
      supabase.from("operation_automations").select("*").eq("id", automationId).maybeSingle(),
      supabase.from("operation_automation_steps").select("*").eq("automation_id", automationId).order("position"),
    ]);
    if (!a) return;
    const row = a as OperationAutomation;
    setAutomation(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setIsActive(row.is_active);
    setTriggerType(row.trigger_type);
    setTriggerConfig(row.trigger_config ?? {});
    setConditions(row.conditions ?? []);
    setSteps(
      ((stepRows ?? []) as { id: string; step_type: OperationAutomationStepType; step_config: Record<string, unknown> }[]).map((s) => ({
        id: s.id, step_type: s.step_type, step_config: s.step_config ?? {},
      })),
    );
  }, [supabase, automationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const dateFieldDefs = fieldDefs.filter((fd) => DATE_FIELD_TYPES.includes(fd.field_type));

  function updateTriggerConfig(patch: Record<string, unknown>) {
    setTriggerConfig((prev) => ({ ...prev, ...patch }));
  }

  function updateCondition(index: number, patch: Partial<OperationAutomationCondition>) {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCondition() {
    setConditions((prev) => [...prev, { subject: "card_priority", operator: "equal", value: "" }]);
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, patch: Partial<BuilderStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function updateStepConfig(index: number, patch: Record<string, unknown>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, step_config: { ...s.step_config, ...patch } } : s)));
  }

  function addStep(stepType: OperationAutomationStepType) {
    setSteps((prev) => [...prev, { id: `local-${prev.length}-${Date.now()}`, step_type: stepType, step_config: {} }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave(activate?: boolean) {
    const trimmed = name.trim();
    if (!trimmed || !automation) return;

    const nextIsActive = activate ?? isActive;
    if (nextIsActive) {
      const issues = validateAutomationForActivation({
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        conditions,
        steps,
      });
      if (issues.length > 0) {
        toast.error(t("toastValidationFailed", { message: issues[0].message }));
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase
      .from("operation_automations")
      .update({
        name: trimmed,
        description: description.trim() || null,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        conditions,
        is_active: nextIsActive,
      })
      .eq("id", automation.id);

    if (error) {
      toast.error(t("toastFailedSave"));
      setSaving(false);
      return;
    }

    await supabase.from("operation_automation_steps").delete().eq("automation_id", automation.id);
    if (steps.length > 0) {
      await supabase.from("operation_automation_steps").insert(
        steps.map((s, i) => ({ automation_id: automation.id, step_type: s.step_type, step_config: s.step_config, position: i })),
      );
    }

    setIsActive(nextIsActive);
    setSaving(false);
    toast.success(t("toastSaved"));
    load();
  }

  if (!automation) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-transparent bg-transparent px-0 text-lg font-semibold text-foreground focus:border-border focus:px-3"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            rows={1}
            className="border-transparent bg-transparent px-0 text-sm text-muted-foreground focus:border-border focus:px-3"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("active")}</Label>
          <Switch checked={isActive} onCheckedChange={(v) => handleSave(v)} />
        </div>
      </div>

      {/* Trigger */}
      <div className="space-y-3 rounded-xl border border-l-4 border-border border-l-primary bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("trigger")}</Label>
        <Select value={triggerType} onValueChange={(v) => v && (setTriggerType(v as OperationAutomationTriggerType), setTriggerConfig({}))}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_TYPE_GROUPS.map((group) => (
              <div key={group.key}>
                <p className="px-2 pt-1.5 text-[11px] font-semibold uppercase text-muted-foreground">{tTriggerGroup(group.key)}</p>
                {group.types.map((type) => (
                  <SelectItem key={type} value={type}>
                    {tTrigger(type)}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        {(STAGE_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && (
          <Select value={(triggerConfig.stage_id as string) ?? ""} onValueChange={(v) => updateTriggerConfig({ stage_id: v })}>
            <SelectTrigger className="w-full bg-muted">
              <SelectValue placeholder={t("selectStage")} />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(FIELD_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && (
          <Select value={(triggerConfig.field_def_id as string) ?? ""} onValueChange={(v) => updateTriggerConfig({ field_def_id: v })}>
            <SelectTrigger className="w-full bg-muted">
              <SelectValue placeholder={t("selectField")} />
            </SelectTrigger>
            <SelectContent>
              {(triggerType === "field_changed" ? fieldDefs : dateFieldDefs).map((fd) => (
                <SelectItem key={fd.id} value={fd.id}>
                  {fd.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(TAG_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && (
          <Select value={(triggerConfig.tag_id as string) ?? ""} onValueChange={(v) => updateTriggerConfig({ tag_id: v })}>
            <SelectTrigger className="w-full bg-muted">
              <SelectValue placeholder={t("selectTag")} />
            </SelectTrigger>
            <SelectContent>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(DAYS_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && (
          <Input
            type="number"
            value={(triggerConfig.days as number) ?? ""}
            onChange={(e) => updateTriggerConfig({ days: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t("daysPlaceholder")}
            className="border-border bg-muted text-foreground"
          />
        )}
      </div>

      {/* Conditions */}
      <div className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("conditions")}</Label>
        {conditions.length === 0 && <p className="text-xs text-muted-foreground">{t("noConditions")}</p>}
        {conditions.map((condition, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/30 p-2">
            <Select value={condition.subject} onValueChange={(v) => v && updateCondition(i, { subject: v as OperationAutomationConditionSubject, operator: OPERATORS_BY_SUBJECT[v as OperationAutomationConditionSubject][0] })}>
              <SelectTrigger className="h-8 w-40 bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tSubject(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {condition.subject === "card_field" && (
              <Select value={condition.field_def_id ?? ""} onValueChange={(v) => v && updateCondition(i, { field_def_id: v })}>
                <SelectTrigger className="h-8 w-36 bg-card text-xs">
                  <SelectValue placeholder={t("selectField")} />
                </SelectTrigger>
                <SelectContent>
                  {fieldDefs.map((fd) => (
                    <SelectItem key={fd.id} value={fd.id}>
                      {fd.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={condition.operator} onValueChange={(v) => v && updateCondition(i, { operator: v as OperationAutomationConditionOperator })}>
              <SelectTrigger className="h-8 w-36 bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS_BY_SUBJECT[condition.subject].map((op) => (
                  <SelectItem key={op} value={op}>
                    {tOperator(op)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!["empty", "not_empty"].includes(condition.operator) && (
              condition.subject === "card_stage" ? (
                <Select value={String(condition.value ?? "")} onValueChange={(v) => updateCondition(i, { value: v })}>
                  <SelectTrigger className="h-8 w-36 bg-card text-xs">
                    <SelectValue placeholder={t("selectStage")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : condition.subject === "card_tag" ? (
                <Select value={String(condition.value ?? "")} onValueChange={(v) => updateCondition(i, { value: v })}>
                  <SelectTrigger className="h-8 w-36 bg-card text-xs">
                    <SelectValue placeholder={t("selectTag")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : condition.subject === "card_assignee" || condition.subject === "task_assignee" ? (
                <Select value={String(condition.value ?? "")} onValueChange={(v) => updateCondition(i, { value: v })}>
                  <SelectTrigger className="h-8 w-36 bg-card text-xs">
                    <SelectValue placeholder={t("selectUser")} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.user_id}>
                        {p.full_name ?? p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={String(condition.value ?? "")}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  className="h-8 w-36 border-border bg-card text-xs"
                  placeholder={t("valuePlaceholder")}
                />
              )
            )}

            <button type="button" onClick={() => removeCondition(i)} className="ml-auto text-muted-foreground hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addCondition} className="border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("addCondition")}
        </Button>
      </div>

      {/* Actions */}
      <div className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("actions")}</Label>
        {steps.length === 0 && <p className="text-xs text-muted-foreground">{t("noActions")}</p>}
        {steps.map((step, i) => (
          <div key={step.id} className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 text-xs font-medium text-foreground">{tStep(step.step_type)}</span>
              <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => removeStep(i)} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <StepConfigEditor
              step={step}
              onChange={(patch) => updateStep(i, patch)}
              onConfigChange={(patch) => updateStepConfig(i, patch)}
              stages={stages}
              fieldDefs={fieldDefs}
              tags={tags}
              profiles={profiles}
              taskTemplates={taskTemplates}
              checklistTemplates={checklistTemplates}
              t={t}
            />
          </div>
        ))}

        <Select value="" onValueChange={(v) => v && addStep(v as OperationAutomationStepType)}>
          <SelectTrigger className="w-full border-dashed bg-transparent text-muted-foreground">
            <SelectValue placeholder={t("addAction")} />
          </SelectTrigger>
          <SelectContent>
            {ADDABLE_STEP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {tStep(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => handleSave()} disabled={saving || !name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}

interface StepConfigEditorProps {
  step: BuilderStep;
  onChange: (patch: Partial<BuilderStep>) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
  tags: Tag[];
  profiles: Profile[];
  taskTemplates: OperationTaskTemplate[];
  checklistTemplates: OperationChecklistTemplate[];
  t: ReturnType<typeof useTranslations>;
}

function StepConfigEditor({ step, onConfigChange, stages, fieldDefs, tags, profiles, taskTemplates, checklistTemplates, t }: StepConfigEditorProps) {
  const c = step.step_config;

  switch (step.step_type) {
    case "move_card":
      return (
        <Select value={(c.stage_id as string) ?? ""} onValueChange={(v) => onConfigChange({ stage_id: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectStage")} />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "change_field":
      return (
        <div className="flex gap-1.5">
          <Select value={(c.field_def_id as string) ?? ""} onValueChange={(v) => onConfigChange({ field_def_id: v })}>
            <SelectTrigger className="h-8 w-36 bg-card text-xs">
              <SelectValue placeholder={t("selectField")} />
            </SelectTrigger>
            <SelectContent>
              {fieldDefs.map((fd) => (
                <SelectItem key={fd.id} value={fd.id}>{fd.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={(c.value_text as string) ?? ""}
            onChange={(e) => onConfigChange({ value_text: e.target.value })}
            placeholder={t("valuePlaceholder")}
            className="h-8 flex-1 border-border bg-card text-xs"
          />
        </div>
      );
    case "change_priority":
      return (
        <Select value={(c.priority as string) ?? ""} onValueChange={(v) => onConfigChange({ priority: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectPriority")} />
          </SelectTrigger>
          <SelectContent>
            {["low", "normal", "high", "urgent"].map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "assign_card":
      return (
        <Select value={(c.user_id as string) ?? ""} onValueChange={(v) => onConfigChange({ user_id: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectUser")} />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.user_id}>{p.full_name ?? p.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "add_card_tag":
    case "remove_card_tag":
      return (
        <Select value={(c.tag_id as string) ?? ""} onValueChange={(v) => onConfigChange({ tag_id: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectTag")} />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "create_task":
      return (
        <div className="space-y-1.5">
          <Input value={(c.title as string) ?? ""} onChange={(e) => onConfigChange({ title: e.target.value })} placeholder={t("titlePlaceholder")} className="h-8 border-border bg-card text-xs" />
          <Input
            type="number"
            value={(c.due_offset_days as number) ?? ""}
            onChange={(e) => onConfigChange({ due_offset_days: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t("dueOffsetDaysPlaceholder")}
            className="h-8 border-border bg-card text-xs"
          />
        </div>
      );
    case "apply_task_template":
      return (
        <Select value={(c.template_id as string) ?? ""} onValueChange={(v) => onConfigChange({ template_id: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectTemplate")} />
          </SelectTrigger>
          <SelectContent>
            {taskTemplates.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "apply_checklist_template":
      return (
        <Select value={(c.template_id as string) ?? ""} onValueChange={(v) => onConfigChange({ template_id: v })}>
          <SelectTrigger className="h-8 w-full bg-card text-xs">
            <SelectValue placeholder={t("selectTemplate")} />
          </SelectTrigger>
          <SelectContent>
            {checklistTemplates.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "add_checklist":
      return (
        <Input
          value={(c.title as string) ?? ""}
          onChange={(e) => onConfigChange({ title: e.target.value })}
          placeholder={t("checklistTitlePlaceholder")}
          className="h-8 border-border bg-card text-xs"
        />
      );
    case "add_comment":
      return (
        <Textarea
          value={(c.text as string) ?? ""}
          onChange={(e) => onConfigChange({ text: e.target.value })}
          placeholder={t("commentPlaceholder")}
          rows={2}
          className="border-border bg-card text-xs"
        />
      );
    case "create_card":
      return (
        <div className="space-y-1.5">
          <Input value={(c.title as string) ?? ""} onChange={(e) => onConfigChange({ title: e.target.value })} placeholder={t("titlePlaceholder")} className="h-8 border-border bg-card text-xs" />
          <Select value={(c.stage_id as string) ?? ""} onValueChange={(v) => onConfigChange({ stage_id: v })}>
            <SelectTrigger className="h-8 w-full bg-card text-xs">
              <SelectValue placeholder={t("selectStageOptional")} />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "relate_cards":
      return (
        <Input
          value={(c.relation_type as string) ?? ""}
          onChange={(e) => onConfigChange({ relation_type: e.target.value })}
          placeholder={t("relationTypePlaceholder")}
          className="h-8 border-border bg-card text-xs"
        />
      );
    case "archive_card":
      return <p className="text-[11px] text-muted-foreground">{t("noConfigNeeded")}</p>;
    case "wait":
      return (
        <div className="flex gap-1.5">
          <Input
            type="number"
            value={(c.days as number) ?? ""}
            onChange={(e) => onConfigChange({ days: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t("daysPlaceholder")}
            className="h-8 border-border bg-card text-xs"
          />
          <Input
            type="number"
            value={(c.hours as number) ?? ""}
            onChange={(e) => onConfigChange({ hours: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t("hoursPlaceholder")}
            className="h-8 border-border bg-card text-xs"
          />
        </div>
      );
    default:
      return null;
  }
}
