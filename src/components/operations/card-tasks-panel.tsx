"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildTaskTree, computeCardTaskProgress } from "@/lib/operations/tasks";
import { setTaskStatus } from "@/lib/operations/move-task";
import { TaskDetailSheet } from "./task-detail-sheet";
import { ApplyTemplateDialog } from "./apply-template-dialog";
import { PriorityBadge } from "./priority-badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, LayoutTemplate, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationTask, Profile } from "@/types";

interface CardTasksPanelProps {
  cardId: string;
  accountId: string;
  boardId: string;
}

export function CardTasksPanel({ cardId, accountId, boardId }: CardTasksPanelProps) {
  const t = useTranslations("Operations.cardDetail.tasks");
  const supabase = createClient();

  const [tasks, setTasks] = useState<OperationTask[]>([]);
  const [profilesByUserId, setProfilesByUserId] = useState<Map<string, Profile>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);

  const load = useCallback(async () => {
    const [{ data: taskRows }, { data: profileRows }] = await Promise.all([
      supabase.from("operation_tasks").select("*").eq("card_id", cardId),
      supabase.from("profiles").select("*"),
    ]);
    setTasks((taskRows ?? []) as OperationTask[]);
    setProfilesByUserId(new Map(((profileRows ?? []) as Profile[]).map((p) => [p.user_id, p])));
  }, [supabase, cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const progress = computeCardTaskProgress(tasks);
  const tree = buildTaskTree(tasks);

  function toggleExpanded(taskId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function handleToggleStatus(task: OperationTask) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const nextStatus = task.status === "done" ? "todo" : "done";
    const { error } = await setTaskStatus(supabase, task.id, nextStatus, user?.id ?? null);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    load();
  }

  async function handleAddTask() {
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    const { error } = await supabase.from("operation_tasks").insert({
      card_id: cardId,
      account_id: accountId,
      title: trimmed,
      position: tasks.filter((t2) => !t2.parent_task_id).length * 1000 + 1000,
    });
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    setNewTaskTitle("");
    load();
  }

  return (
    <div className="space-y-3">
      {progress !== null && (
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5" />
          <span className="shrink-0 text-xs text-muted-foreground">{progress}%</span>
        </div>
      )}

      <div className="space-y-1.5">
        {tree.map(({ task, subtasks }) => {
          const assignee = task.assigned_to_user_id ? profilesByUserId.get(task.assigned_to_user_id) : null;
          const isExpanded = expanded.has(task.id);
          return (
            <div key={task.id}>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                {subtasks.length > 0 ? (
                  <button type="button" onClick={() => toggleExpanded(task.id)} className="shrink-0 text-muted-foreground">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <Checkbox checked={task.status === "done"} onCheckedChange={() => handleToggleStatus(task)} />
                <button
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                  className={
                    task.status === "done"
                      ? "flex-1 truncate text-left text-sm text-muted-foreground line-through"
                      : "flex-1 truncate text-left text-sm text-foreground hover:underline"
                  }
                >
                  {task.title}
                </button>
                {subtasks.length > 0 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
                  </span>
                )}
                <PriorityBadge priority={task.priority} className="shrink-0" />
                {assignee && (
                  <span
                    title={assignee.full_name ?? undefined}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
                  >
                    {(assignee.full_name ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              {isExpanded && (
                <div className="ml-8 mt-1 space-y-1">
                  {subtasks.map((subtask) => (
                    <div key={subtask.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1">
                      <Checkbox checked={subtask.status === "done"} onCheckedChange={() => handleToggleStatus(subtask)} />
                      <button
                        type="button"
                        onClick={() => setSelectedTaskId(subtask.id)}
                        className={
                          subtask.status === "done"
                            ? "flex-1 truncate text-left text-xs text-muted-foreground line-through"
                            : "flex-1 truncate text-left text-xs text-foreground hover:underline"
                        }
                      >
                        {subtask.title}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          placeholder={t("newTaskPlaceholder")}
          className="h-8 flex-1 border-border bg-muted text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddTask();
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAddTask}
          disabled={!newTaskTitle.trim()}
          className="h-8 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setApplyTemplateOpen(true)}
          className="h-8 shrink-0 border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LayoutTemplate className="mr-1 h-3.5 w-3.5" />
          {t("applyTemplate")}
        </Button>
      </div>

      <TaskDetailSheet
        open={selectedTaskId !== null}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
        taskId={selectedTaskId}
        accountId={accountId}
        onChanged={load}
      />
      <ApplyTemplateDialog
        open={applyTemplateOpen}
        onOpenChange={setApplyTemplateOpen}
        boardId={boardId}
        cardId={cardId}
        onApplied={load}
      />
    </div>
  );
}
