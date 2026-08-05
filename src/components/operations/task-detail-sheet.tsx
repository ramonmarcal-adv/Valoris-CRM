"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setTaskStatus } from "@/lib/operations/move-task";
import { TASK_STATUSES } from "@/lib/operations/tasks";
import { ChecklistPanel } from "./checklist-panel";
import { CardCommentsPanel } from "./card-comments-panel";
import { CardAttachmentsPanel } from "./card-attachments-panel";
import { PriorityBadge } from "./priority-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import type { OperationCardPriority, OperationTask, OperationTaskStatus, Profile } from "@/types";

const PRIORITIES: OperationCardPriority[] = ["low", "normal", "high", "urgent"];

interface TaskDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
  accountId: string;
  onChanged: () => void;
}

export function TaskDetailSheet({ open, onOpenChange, taskId, accountId, onChanged }: TaskDetailSheetProps) {
  const t = useTranslations("Operations.taskDetail");
  const tPriority = useTranslations("Operations.priority");
  const supabase = createClient();

  const [task, setTask] = useState<OperationTask | null>(null);
  const [subtasks, setSubtasks] = useState<OperationTask[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const load = useCallback(async () => {
    if (!taskId) return;
    const [{ data: taskRow }, { data: subtaskRows }, { data: profileRows }] = await Promise.all([
      supabase.from("operation_tasks").select("*").eq("id", taskId).maybeSingle(),
      supabase.from("operation_tasks").select("*").eq("parent_task_id", taskId).order("position"),
      supabase.from("profiles").select("*").order("full_name"),
    ]);
    const taskData = taskRow as OperationTask | null;
    setTask(taskData);
    setTitle(taskData?.title ?? "");
    setDescription(taskData?.description ?? "");
    setSubtasks((subtaskRows ?? []) as OperationTask[]);
    setProfiles((profileRows ?? []) as Profile[]);
  }, [supabase, taskId]);

  useEffect(() => {
    if (!open || !taskId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [open, taskId, load]);

  async function patchTask(patch: Partial<OperationTask>) {
    if (!task) return;
    setTask({ ...task, ...patch });
    const { error } = await supabase.from("operation_tasks").update(patch).eq("id", task.id);
    if (error) {
      toast.error(t("toastFailedSave"));
      load();
      return;
    }
    onChanged();
  }

  async function handleStatusChange(status: OperationTaskStatus) {
    if (!task) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await setTaskStatus(supabase, task.id, status, user?.id ?? null);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    load();
    onChanged();
  }

  async function handleAddSubtask() {
    if (!task) return;
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    const { error } = await supabase.from("operation_tasks").insert({
      card_id: task.card_id,
      account_id: task.account_id,
      parent_task_id: task.id,
      title: trimmed,
      position: subtasks.length * 1000 + 1000,
    });
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    setNewSubtaskTitle("");
    load();
    onChanged();
  }

  async function handleToggleSubtask(subtask: OperationTask) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const nextStatus: OperationTaskStatus = subtask.status === "done" ? "todo" : "done";
    const { error } = await setTaskStatus(supabase, subtask.id, nextStatus, user?.id ?? null);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    load();
    onChanged();
  }

  async function handleDeleteSubtask(subtaskId: string) {
    const { error } = await supabase.from("operation_tasks").delete().eq("id", subtaskId);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    load();
    onChanged();
  }

  if (!task) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="border-border bg-popover sm:max-w-lg" />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto border-border bg-popover p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="sr-only">{t("title")}</SheetTitle>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && patchTask({ title: title.trim() })}
            className="border-transparent bg-transparent px-0 text-lg font-semibold text-foreground focus:border-border focus:px-3"
          />
        </SheetHeader>

        <div className="flex-1 space-y-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("status")}</Label>
              <Select value={task.status} onValueChange={(v) => v && handleStatusChange(v as OperationTaskStatus)}>
                <SelectTrigger className="h-8 w-36 bg-muted text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`statusValue.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("priority")}</Label>
              <Select value={task.priority} onValueChange={(v) => v && patchTask({ priority: v as OperationCardPriority })}>
                <SelectTrigger className="h-8 w-32 bg-muted text-xs">
                  <SelectValue>
                    <PriorityBadge priority={task.priority} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tPriority(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("assignee")}</Label>
              <Select
                value={task.assigned_to_user_id ?? "none"}
                onValueChange={(v) => patchTask({ assigned_to_user_id: v === "none" ? null : v })}
              >
                <SelectTrigger className="h-8 w-40 bg-muted text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("unassigned")}</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.user_id}>
                      {p.full_name ?? p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("startDate")}</Label>
              <Input
                type="date"
                defaultValue={task.start_date ? task.start_date.slice(0, 10) : ""}
                onBlur={(e) => patchTask({ start_date: e.target.value || null })}
                className="h-8 w-36 border-border bg-muted text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("dueAt")}</Label>
              <Input
                type="datetime-local"
                defaultValue={task.due_at ? task.due_at.slice(0, 16) : ""}
                onBlur={(e) => patchTask({ due_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="h-8 w-48 border-border bg-muted text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("section")}</Label>
              <Input
                defaultValue={task.section ?? ""}
                onBlur={(e) => patchTask({ section: e.target.value.trim() || null })}
                placeholder={t("sectionPlaceholder")}
                className="h-8 w-40 border-border bg-muted text-xs"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== (task.description ?? "") && patchTask({ description: description.trim() || null })}
              rows={3}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div>
            <Label className="mb-2 block text-[11px] text-muted-foreground">{t("subtasks")}</Label>
            <div className="space-y-1.5">
              {subtasks.map((subtask) => (
                <div key={subtask.id} className="group flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                  <Checkbox checked={subtask.status === "done"} onCheckedChange={() => handleToggleSubtask(subtask)} />
                  <span
                    className={
                      subtask.status === "done" ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm text-foreground"
                    }
                  >
                    {subtask.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubtask(subtask.id)}
                    className="shrink-0 text-xs text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
                  >
                    {t("remove")}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder={t("newSubtaskPlaceholder")}
                className="h-8 flex-1 border-border bg-muted text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSubtask();
                }}
              />
            </div>
            {subtasks.length > 0 && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={task.auto_complete_when_subtasks_done}
                  onCheckedChange={(v) => patchTask({ auto_complete_when_subtasks_done: v === true })}
                />
                {t("autoComplete")}
              </label>
            )}
          </div>

          <div>
            <Label className="mb-2 block text-[11px] text-muted-foreground">{t("checklist")}</Label>
            <ChecklistPanel taskId={task.id} />
          </div>

          <div>
            <Label className="mb-2 block text-[11px] text-muted-foreground">{t("attachments")}</Label>
            <CardAttachmentsPanel cardId={task.card_id} accountId={accountId} taskId={task.id} />
          </div>

          <div>
            <Label className="mb-2 block text-[11px] text-muted-foreground">{t("comments")}</Label>
            <CardCommentsPanel cardId={task.card_id} accountId={accountId} taskId={task.id} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
