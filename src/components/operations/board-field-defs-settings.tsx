"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OperationBoardStage, OperationCardFieldDef, OperationCardFieldType } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const FIELD_TYPES: OperationCardFieldType[] = [
  "short_text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "checkbox",
  "single_select",
  "multi_select",
  "phone",
  "email",
  "url",
  "user",
  "contact",
  "related_card",
];

const CHOICE_TYPES: OperationCardFieldType[] = ["single_select", "multi_select"];

interface BoardFieldDefsSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
  onFieldDefsChanged: () => void;
}

export function BoardFieldDefsSettings({
  open,
  onOpenChange,
  boardId,
  stages,
  fieldDefs,
  onFieldDefsChanged,
}: BoardFieldDefsSettingsProps) {
  const t = useTranslations("Operations.fieldDefsSettings");
  const tFieldType = useTranslations("Operations.fieldType");
  const supabase = createClient();

  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<OperationCardFieldType>("short_text");
  const [stageId, setStageId] = useState<string>("all");
  const [isRequired, setIsRequired] = useState(false);
  const [choicesText, setChoicesText] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName("");
    setFieldType("short_text");
    setStageId("all");
    setIsRequired(false);
    setChoicesText("");
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sortedDefs = [...fieldDefs].sort((a, b) => a.position - b.position);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    const field_options = CHOICE_TYPES.includes(fieldType)
      ? { choices: choicesText.split(",").map((c) => c.trim()).filter(Boolean) }
      : {};
    const { error } = await supabase.from("operation_card_field_defs").insert({
      board_id: boardId,
      stage_id: stageId === "all" ? null : stageId,
      name: trimmed,
      field_type: fieldType,
      field_options,
      is_required: isRequired,
      position: sortedDefs.length,
    });
    setSaving(false);
    if (error) {
      toast.error(t("toastFailedAdd"));
      return;
    }
    setName("");
    setChoicesText("");
    setIsRequired(false);
    onFieldDefsChanged();
    toast.success(t("toastAdded"));
  }

  async function handleRemove(def: OperationCardFieldDef) {
    const { error } = await supabase
      .from("operation_card_field_defs")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", def.id);
    if (error) {
      toast.error(t("toastFailedRemove"));
      return;
    }
    onFieldDefsChanged();
    toast.success(t("toastRemoved"));
  }

  async function handleMove(def: OperationCardFieldDef, direction: -1 | 1) {
    const index = sortedDefs.findIndex((d) => d.id === def.id);
    const swapWith = sortedDefs[index + direction];
    if (!swapWith) return;
    const { error } = await supabase.from("operation_card_field_defs").upsert(
      [
        { id: def.id, position: swapWith.position },
        { id: swapWith.id, position: def.position },
      ],
      { onConflict: "id" },
    );
    if (error) {
      toast.error(t("toastFailedReorder"));
      return;
    }
    onFieldDefsChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("manageFields")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {sortedDefs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noFieldsYet")}</p>
          )}
          {sortedDefs.map((def, index) => (
            <div key={def.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => handleMove(def, -1)}
                  disabled={index === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(def, 1)}
                  disabled={index === sortedDefs.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {def.name}
                  {def.is_required && <span className="ml-1 text-red-400">*</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {tFieldType(def.field_type)}
                  {def.stage_id && ` · ${stages.find((s) => s.id === def.stage_id)?.name ?? ""}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleRemove(def)}
                className="text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("fieldName")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("fieldNamePlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("fieldType")}</Label>
            <Select value={fieldType} onValueChange={(v) => setFieldType((v as OperationCardFieldType) ?? "short_text")}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((ft) => (
                  <SelectItem key={ft} value={ft}>
                    {tFieldType(ft)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {CHOICE_TYPES.includes(fieldType) && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("choices")}</Label>
              <Input
                value={choicesText}
                onChange={(e) => setChoicesText(e.target.value)}
                placeholder={t("choicesPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("visibleOnStage")}</Label>
            <Select value={stageId} onValueChange={(v) => setStageId(v ?? "all")}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStages")}</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={isRequired} onCheckedChange={(v) => setIsRequired(v === true)} />
            {t("required")}
          </label>
          <Button
            onClick={handleAdd}
            disabled={saving || !name.trim()}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("addField")}
          </Button>
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button onClick={() => onOpenChange(false)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
