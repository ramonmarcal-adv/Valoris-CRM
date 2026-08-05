"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INDICATOR_AGG_TYPES, indicatorRequiresField, indicatorRequiresStageFilter, isFieldEligibleForAgg } from "@/lib/operations/board-indicators";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationBoardIndicator, OperationBoardIndicatorAggType, OperationBoardStage, OperationCardFieldDef } from "@/types";

interface BoardIndicatorSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
  onIndicatorsChanged: () => void;
}

export function BoardIndicatorSettings({ open, onOpenChange, boardId, stages, fieldDefs, onIndicatorsChanged }: BoardIndicatorSettingsProps) {
  const t = useTranslations("Operations.indicatorSettings");
  const tAgg = useTranslations("Operations.aggType");
  const supabase = createClient();

  const [indicators, setIndicators] = useState<OperationBoardIndicator[]>([]);
  const [name, setName] = useState("");
  const [aggType, setAggType] = useState<OperationBoardIndicatorAggType>("count");
  const [fieldDefId, setFieldDefId] = useState("");
  const [filterStageId, setFilterStageId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("operation_board_indicators").select("*").is("archived_at", null).order("position");
    setIndicators((data ?? []) as OperationBoardIndicator[]);
  };

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const eligibleFields = fieldDefs.filter((fd) => isFieldEligibleForAgg(fd.field_type, aggType));

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (indicatorRequiresField(aggType) && !fieldDefId) return;
    if (indicatorRequiresStageFilter(aggType) && !filterStageId) return;
    setSaving(true);
    const { error } = await supabase.from("operation_board_indicators").insert({
      board_id: boardId,
      name: trimmed,
      agg_type: aggType,
      field_def_id: indicatorRequiresField(aggType) ? fieldDefId : null,
      filter_stage_id: filterStageId || null,
      position: indicators.length,
    });
    setSaving(false);
    if (error) {
      toast.error(t("toastFailedAdd"));
      return;
    }
    setName("");
    setFieldDefId("");
    setFilterStageId("");
    load();
    onIndicatorsChanged();
  }

  async function handleRemove(indicatorId: string) {
    const { error } = await supabase.from("operation_board_indicators").update({ archived_at: new Date().toISOString() }).eq("id", indicatorId);
    if (error) {
      toast.error(t("toastFailedRemove"));
      return;
    }
    load();
    onIndicatorsChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {indicators.length === 0 && <p className="text-sm text-muted-foreground">{t("noIndicators")}</p>}
          {indicators.map((ind) => (
            <div key={ind.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{ind.name}</p>
                <p className="text-[11px] text-muted-foreground">{tAgg(ind.agg_type)}</p>
              </div>
              <Button variant="ghost" size="icon-xs" onClick={() => handleRemove(ind.id)} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-muted text-foreground" />
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("aggType")}</Label>
            <Select
              value={aggType}
              onValueChange={(v) => {
                setAggType((v as OperationBoardIndicatorAggType) ?? "count");
                setFieldDefId("");
              }}
            >
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICATOR_AGG_TYPES.map((agg) => (
                  <SelectItem key={agg} value={agg}>
                    {tAgg(agg)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {indicatorRequiresField(aggType) && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("field")}</Label>
              <Select value={fieldDefId} onValueChange={(v) => setFieldDefId(v ?? "")}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue placeholder={t("fieldPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleFields.map((fd) => (
                    <SelectItem key={fd.id} value={fd.id}>
                      {fd.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label className="text-muted-foreground">
              {t("filterStage")}
              {indicatorRequiresStageFilter(aggType) ? " *" : ` (${t("optional")})`}
            </Label>
            <Select value={filterStageId || "none"} onValueChange={(v) => setFilterStageId(v === "none" ? "" : (v ?? ""))}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!indicatorRequiresStageFilter(aggType) && <SelectItem value="none">{t("allStages")}</SelectItem>}
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleAdd}
            disabled={
              saving ||
              !name.trim() ||
              (indicatorRequiresField(aggType) && !fieldDefId) ||
              (indicatorRequiresStageFilter(aggType) && !filterStageId)
            }
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("addIndicator")}
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
