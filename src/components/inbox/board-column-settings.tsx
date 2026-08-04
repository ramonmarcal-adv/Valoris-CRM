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
import type { BoardColumn } from "@/types";
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
import { Trash2, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// Deliberately duplicated from pipeline-settings.tsx's STAGE_COLORS
// rather than shared — these are two independent features that
// happen to reuse the same look; a future pipeline-only palette
// change shouldn't leak into the Inbox board.
const BOARD_COLUMN_COLORS = [
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

interface BoardColumnSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  columns: BoardColumn[];
  onColumnsChanged: () => void;
}

export function BoardColumnSettings({
  open,
  onOpenChange,
  accountId,
  columns,
  onColumnsChanged,
}: BoardColumnSettingsProps) {
  const t = useTranslations("Inbox.boardColumnSettings");
  const supabase = createClient();

  const [localColumns, setLocalColumns] = useState<BoardColumn[]>(columns);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnColor, setNewColumnColor] = useState(BOARD_COLUMN_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [columnPendingDelete, setColumnPendingDelete] = useState<
    { id: string; count: number } | null
  >(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);

  // Reset form state when the dialog opens or its prop inputs change —
  // legitimate prop-driven sync, same pattern as pipeline-settings.tsx.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setLocalColumns([...columns].sort((a, b) => a.position - b.position));
    setColumnPendingDelete(null);
    setMoveTargetId("");
  }, [open, columns]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localColumns.findIndex((c) => c.id === active.id);
    const newIndex = localColumns.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalColumns(arrayMove(localColumns, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);
    const rows = localColumns.map((c, i) => ({
      id: c.id,
      account_id: accountId,
      name: c.name,
      color: c.color,
      position: i,
    }));
    const { error } = await supabase
      .from("conversation_board_columns")
      .upsert(rows, { onConflict: "id" });
    setSaving(false);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    onOpenChange(false);
    onColumnsChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddColumn() {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from("conversation_board_columns")
      .insert({
        account_id: accountId,
        name: trimmed,
        color: newColumnColor,
        position: localColumns.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddColumn"));
      return;
    }
    setLocalColumns([...localColumns, data as BoardColumn]);
    setNewColumnName("");
    setNewColumnColor(BOARD_COLUMN_COLORS[(localColumns.length + 1) % BOARD_COLUMN_COLORS.length]);
  }

  async function handleRemoveColumn(column: BoardColumn) {
    if (column.is_default_for_leads || column.is_default_for_groups) {
      toast.error(t("toastCannotDeleteDefaultColumn"));
      return;
    }
    const { count } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("board_column_id", column.id);
    if (count && count > 0) {
      setColumnPendingDelete({ id: column.id, count });
      setMoveTargetId(localColumns.find((c) => c.id !== column.id)?.id ?? "");
      return;
    }
    const { error } = await supabase
      .from("conversation_board_columns")
      .delete()
      .eq("id", column.id);
    if (error) {
      toast.error(t("toastFailedDeleteColumn"));
      return;
    }
    setLocalColumns(localColumns.filter((c) => c.id !== column.id));
    onColumnsChanged();
    toast.success(t("toastColumnDeleted"));
  }

  async function handleMoveAllCardsAndDelete() {
    if (!columnPendingDelete || !moveTargetId) return;
    setMoving(true);
    const { error: moveErr } = await supabase
      .from("conversations")
      .update({ board_column_id: moveTargetId })
      .eq("board_column_id", columnPendingDelete.id);
    if (moveErr) {
      setMoving(false);
      toast.error(t("toastFailedMoveCards"));
      return;
    }
    const { error: delErr } = await supabase
      .from("conversation_board_columns")
      .delete()
      .eq("id", columnPendingDelete.id);
    setMoving(false);
    if (delErr) {
      toast.error(t("toastFailedDeleteColumn"));
      return;
    }
    setLocalColumns(localColumns.filter((c) => c.id !== columnPendingDelete.id));
    setColumnPendingDelete(null);
    onColumnsChanged();
    toast.success(t("toastColumnDeleted"));
  }

  // Default-flag toggles write immediately (not part of the batch
  // "Save changes") — two sequential updates (clear old, set new)
  // rather than one multi-row write, so the partial-unique-index
  // invariant (exactly one default per account) is never violated
  // mid-write. onColumnsChanged() re-syncs from the DB either way,
  // correcting any drift if the second write fails.
  async function handleSetDefaultLeadsColumn(columnId: string) {
    setLocalColumns((prev) =>
      prev.map((c) => ({ ...c, is_default_for_leads: c.id === columnId })),
    );
    await supabase
      .from("conversation_board_columns")
      .update({ is_default_for_leads: false })
      .eq("account_id", accountId)
      .eq("is_default_for_leads", true)
      .neq("id", columnId);
    const { error } = await supabase
      .from("conversation_board_columns")
      .update({ is_default_for_leads: true })
      .eq("id", columnId);
    if (error) toast.error(t("toastFailedSetDefault"));
    onColumnsChanged();
  }

  async function handleSetDefaultGroupsColumn(columnId: string) {
    setLocalColumns((prev) =>
      prev.map((c) => ({ ...c, is_default_for_groups: c.id === columnId })),
    );
    await supabase
      .from("conversation_board_columns")
      .update({ is_default_for_groups: false })
      .eq("account_id", accountId)
      .eq("is_default_for_groups", true)
      .neq("id", columnId);
    const { error } = await supabase
      .from("conversation_board_columns")
      .update({ is_default_for_groups: true })
      .eq("id", columnId);
    if (error) toast.error(t("toastFailedSetDefault"));
    onColumnsChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("manageColumns")}</DialogTitle>
        </DialogHeader>

        {columnPendingDelete ? (
          <div className="py-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-400">
                {t("deleteBlockedTitle", { count: columnPendingDelete.count })}
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
                  {localColumns
                    .filter((c) => c.id !== columnPendingDelete.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setColumnPendingDelete(null)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleMoveAllCardsAndDelete}
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
                <Label className="text-muted-foreground">{t("columns")}</Label>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localColumns.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localColumns.map((column, index) => (
                        <SortableColumnRow
                          key={column.id}
                          column={column}
                          onNameChange={(v) => {
                            const updated = [...localColumns];
                            updated[index] = { ...updated[index], name: v };
                            setLocalColumns(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localColumns];
                            updated[index] = { ...updated[index], color: v };
                            setLocalColumns(updated);
                          }}
                          onRemove={() => handleRemoveColumn(column)}
                          onSetDefaultLeads={() => handleSetDefaultLeadsColumn(column.id)}
                          onSetDefaultGroups={() => handleSetDefaultGroupsColumn(column.id)}
                          colors={BOARD_COLUMN_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new column */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {BOARD_COLUMN_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewColumnColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor: newColumnColor === color ? "var(--foreground)" : "transparent",
                      }}
                      aria-label={t("pickColorAriaLabel", { color })}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder={t("newColumnNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddColumn();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddColumn}
                    disabled={!newColumnName.trim()}
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

function SortableColumnRow({
  column,
  onNameChange,
  onColorChange,
  onRemove,
  onSetDefaultLeads,
  onSetDefaultGroups,
  colors,
  t,
}: {
  column: BoardColumn;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRemove: () => void;
  onSetDefaultLeads: () => void;
  onSetDefaultGroups: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-muted p-2"
    >
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
        <ColorSwatch value={column.color} onChange={onColorChange} colors={colors} t={t} />
        <Input
          value={column.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 pl-6">
        <button
          type="button"
          onClick={onSetDefaultLeads}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            column.is_default_for_leads
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-border",
          )}
        >
          {t("setDefaultLeads")}
        </button>
        <button
          type="button"
          onClick={onSetDefaultGroups}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            column.is_default_for_groups
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-border",
          )}
        >
          {t("setDefaultGroups")}
        </button>
      </div>
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
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor: c === value ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
