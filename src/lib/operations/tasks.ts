import type { OperationTask, OperationTaskStatus } from "@/types";

/**
 * Client-side mirror of the `enforce_task_depth()` DB trigger
 * (migration 067) — lets the UI reject an invalid nest/reparent
 * instantly instead of waiting on a round-trip error. The trigger is
 * still the source of truth; this exists for UX only.
 */
export function validateTaskParent(
  tasks: OperationTask[],
  taskId: string | null,
  cardId: string,
  newParentId: string | null,
): string | null {
  if (newParentId === null) return null;
  if (newParentId === taskId) {
    return "Uma tarefa não pode ser sua própria tarefa-mãe.";
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parent = byId.get(newParentId);
  if (!parent) {
    return "Tarefa-mãe não encontrada.";
  }
  if (parent.card_id !== cardId) {
    return "A subtarefa precisa pertencer ao mesmo card da tarefa-mãe.";
  }
  if (parent.parent_task_id) {
    return "O limite é de 1 nível de subtarefa — a tarefa escolhida já é uma subtarefa.";
  }
  if (taskId && tasks.some((t) => t.parent_task_id === taskId)) {
    return "Esta tarefa já tem subtarefas — não é possível aninhá-la em outra.";
  }

  return null;
}

/** Groups tasks into top-level tasks with their direct subtasks, for a card's task list UI. */
export function buildTaskTree(tasks: OperationTask[]) {
  const topLevel = tasks.filter((t) => t.parent_task_id === null).sort((a, b) => a.position - b.position);
  const childrenByParent = new Map<string, OperationTask[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const siblings = childrenByParent.get(task.parent_task_id) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parent_task_id, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.position - b.position);
  }
  return topLevel.map((task) => ({
    task,
    subtasks: childrenByParent.get(task.id) ?? [],
  }));
}

/**
 * Pure mirror of the `recompute_card_task_progress()` DB trigger
 * (067) — same formula, used for optimistic UI and to unit-test the
 * rule without a database. Only counts first-level tasks; 'cancelled'
 * tasks are excluded from both the numerator and denominator. Null
 * (not 0) when there are no first-level tasks at all.
 */
export function computeCardTaskProgress(tasks: OperationTask[]): number | null {
  const topLevel = tasks.filter((t) => t.parent_task_id === null && t.status !== "cancelled");
  if (topLevel.length === 0) return null;
  const done = topLevel.filter((t) => t.status === "done").length;
  return Math.round((done / topLevel.length) * 100);
}

/**
 * Pure mirror of the `auto_complete_parent_task()` DB trigger (067).
 * Requires at least one 'done' sibling — guards against auto-
 * completing a parent whose subtasks were all 'cancelled'.
 */
export function shouldAutoCompleteParent(siblings: OperationTask[], autoCompleteEnabled: boolean): boolean {
  if (!autoCompleteEnabled) return false;
  const incomplete = siblings.filter((s) => s.status !== "done" && s.status !== "cancelled");
  const done = siblings.filter((s) => s.status === "done");
  return incomplete.length === 0 && done.length > 0;
}

export const TASK_STATUSES: OperationTaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
