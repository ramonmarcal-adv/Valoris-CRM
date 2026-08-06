"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import type { OperationBoardStage } from "@/types";
import { deleteStageWithReallocation } from "@/lib/operations/stage-deletion";
import { StageShortcutsPanel } from "./stage-shortcuts-panel";
import { cn } from "@/lib/utils";
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
import { ChevronDown, ChevronRight, Trash2, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
];

interface BoardStageSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  boardId: string;
  stages: OperationBoardStage[];
  onStagesChanged: () => void;
}

export function BoardStageSettings({ open, onOpenChange, accountId, boardId, stages, onStagesChanged }: BoardStageSettingsProps) {
  const t = useTranslations("Operations.stageSettings");
  const supabase = createClient();

  const [localStages, setLocalStages] = useState<OperationBoardStage[]>(stages);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [stagePendingDelete, setStagePendingDelete] = useState<{ id: string; count: number } | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setStagePendingDelete(null);
    setMoveTargetId("");
  }, [open, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);
    const rows = localStages.map((s, i) => ({
      id: s.id,
      board_id: boardId,
      name: s.name,
      color: s.color,
      position: i,
      is_initial: s.is_initial,
    }));
    const { error } = await supabase.from("operation_board_stages").upsert(rows, { onConflict: "id" });
    setSaving(false);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    onOpenChange(false);
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from("operation_board_stages")
      .insert({
        board_id: boardId,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
        is_initial: localStages.length === 0,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    setLocalStages([...localStages, data as OperationBoardStage]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  async function handleRemoveStage(stage: OperationBoardStage) {
    if (localStages.length <= 1) {
      toast.error(t("toastCannotDeleteLastStage"));
      return;
    }
    const { count } = await supabase
      .from("operation_cards")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stage.id);
    if (count && count > 0) {
      setStagePendingDelete({ id: stage.id, count });
      setMoveTargetId(localStages.find((s) => s.id !== stage.id)?.id ?? "");
      return;
    }
    const { error } = await supabase.from("operation_board_stages").delete().eq("id", stage.id);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stage.id));
    onStagesChanged();
    toast.success(t("toastStageDeleted"));
  }

  async function handleReallocateAndDelete() {
    if (!stagePendingDelete || !moveTargetId) return;
    setMoving(true);
    const { error } = await deleteStageWithReallocation(supabase, stagePendingDelete.id, moveTargetId);
    setMoving(false);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stagePendingDelete.id));
    setStagePendingDelete(null);
    onStagesChanged();
    toast.success(t("toastStageDeleted"));
  }

  async function handleSetInitial(stageId: string) {
    setLocalStages((prev) => prev.map((s) => ({ ...s, is_initial: s.id === stageId })));
    await supabase
      .from("operation_board_stages")
      .update({ is_initial: false })
      .eq("board_id", boardId)
      .eq("is_initial", true)
      .neq("id", stageId);
    const { error } = await supabase.from("operation_board_stages").update({ is_initial: true }).eq("id", stageId);
    if (error) toast.error(t("toastFailedSetInitial"));
    onStagesChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("manageStages")}</DialogTitle>
        </DialogHeader>

        {stagePendingDelete ? (
          <div className="py-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-400">
                {t("deleteBlockedTitle", { count: stagePendingDelete.count })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("deleteBlockedDesc")}</p>
            </div>
            <div className="mt-4 grid gap-2">
              <Label className="text-muted-foreground">{t("moveTo")}</Label>
              <Select value={moveTargetId} onValueChange={(v) => setMoveTargetId(v ?? "")}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {localStages
                    .filter((s) => s.id !== stagePendingDelete.id)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setStagePendingDelete(null)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleReallocateAndDelete}
                disabled={!moveTargetId || moving}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {moving ? t("moving") : t("moveAndDelete")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
                  <SortableContext items={localStages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage)}
                          onSetInitial={() => handleSetInitial(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                          accountId={accountId}
                          boardId={boardId}
                          expanded={expandedStageId === stage.id}
                          onToggleExpanded={() => setExpandedStageId((prev) => (prev === stage.id ? null : stage.id))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor: newStageColor === color ? "var(--foreground)" : "transparent",
                      }}
                      aria-label={t("pickColorAriaLabel", { color })}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onRemove,
  onSetInitial,
  colors,
  t,
  accountId,
  boardId,
  expanded,
  onToggleExpanded,
}: {
  stage: OperationBoardStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRemove: () => void;
  onSetInitial: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  accountId: string;
  boardId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border bg-muted p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={t("dragToReorder")}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <ColorSwatch value={stage.color} onChange={onColorChange} colors={colors} t={t} />
        <Input
          value={stage.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border"
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("shortcuts.onEnter")}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Button variant="ghost" size="icon-xs" onClick={onRemove} className="text-muted-foreground hover:text-red-400">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-1.5 pl-6">
        <button
          type="button"
          onClick={onSetInitial}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            stage.is_initial ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-border",
          )}
        >
          {t("setInitial")}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-border pt-2 pl-6">
          <StageShortcutsPanel accountId={accountId} boardId={boardId} stageId={stage.id} stageName={stage.name} />
        </div>
      )}
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={t("changeColor")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex w-36 flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: c === value ? "var(--foreground)" : "transparent" }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
