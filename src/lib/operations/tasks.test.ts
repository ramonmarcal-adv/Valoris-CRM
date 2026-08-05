import { describe, expect, it } from "vitest";
import { buildTaskTree, computeCardTaskProgress, shouldAutoCompleteParent, validateTaskParent } from "./tasks";
import type { OperationTask } from "@/types";

function makeTask(overrides: Partial<OperationTask>): OperationTask {
  return {
    id: "task-1",
    card_id: "card-1",
    account_id: "acct-1",
    parent_task_id: null,
    title: "Task",
    status: "todo",
    priority: "normal",
    auto_complete_when_subtasks_done: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateTaskParent", () => {
  it("allows a top-level task (no parent)", () => {
    expect(validateTaskParent([], "a", "card-1", null)).toBeNull();
  });

  it("rejects a task becoming its own parent", () => {
    expect(validateTaskParent([], "a", "card-1", "a")).toContain("própria tarefa-mãe");
  });

  it("rejects nesting under a task that belongs to a different card", () => {
    const tasks = [makeTask({ id: "other", card_id: "card-2" })];
    expect(validateTaskParent(tasks, "new", "card-1", "other")).toContain("mesmo card");
  });

  it("rejects nesting under a task that is already a subtask", () => {
    const tasks = [
      makeTask({ id: "top", card_id: "card-1" }),
      makeTask({ id: "sub", card_id: "card-1", parent_task_id: "top" }),
    ];
    expect(validateTaskParent(tasks, "new", "card-1", "sub")).toContain("1 nível de subtarefa");
  });

  it("rejects reparenting a task that already has subtasks", () => {
    const tasks = [
      makeTask({ id: "top-a", card_id: "card-1" }),
      makeTask({ id: "top-b", card_id: "card-1" }),
      makeTask({ id: "child", card_id: "card-1", parent_task_id: "top-a" }),
    ];
    expect(validateTaskParent(tasks, "top-a", "card-1", "top-b")).toContain("já tem subtarefas");
  });

  it("allows nesting a childless task under a top-level task in the same card", () => {
    const tasks = [makeTask({ id: "top", card_id: "card-1" })];
    expect(validateTaskParent(tasks, "new", "card-1", "top")).toBeNull();
  });
});

describe("buildTaskTree", () => {
  it("groups subtasks under their parent, sorted by position", () => {
    const tasks = [
      makeTask({ id: "top", position: 0 }),
      makeTask({ id: "sub-2", parent_task_id: "top", position: 1 }),
      makeTask({ id: "sub-1", parent_task_id: "top", position: 0 }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0].task.id).toBe("top");
    expect(tree[0].subtasks.map((s) => s.id)).toEqual(["sub-1", "sub-2"]);
  });

  it("returns an empty subtasks array for a childless task", () => {
    const tree = buildTaskTree([makeTask({ id: "top" })]);
    expect(tree[0].subtasks).toEqual([]);
  });
});

describe("computeCardTaskProgress", () => {
  it("returns null when there are no top-level tasks", () => {
    expect(computeCardTaskProgress([])).toBeNull();
  });

  it("computes done/total over top-level tasks only", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", status: "todo" }),
      makeTask({ id: "c", status: "todo" }),
    ];
    expect(computeCardTaskProgress(tasks)).toBe(33);
  });

  it("excludes cancelled tasks from both numerator and denominator", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", status: "cancelled" }),
    ];
    expect(computeCardTaskProgress(tasks)).toBe(100);
  });

  it("never counts subtasks toward the card's progress", () => {
    const tasks = [
      makeTask({ id: "top", status: "todo" }),
      makeTask({ id: "sub-1", parent_task_id: "top", status: "done" }),
      makeTask({ id: "sub-2", parent_task_id: "top", status: "done" }),
      makeTask({ id: "sub-3", parent_task_id: "top", status: "done" }),
    ];
    expect(computeCardTaskProgress(tasks)).toBe(0);
  });
});

describe("shouldAutoCompleteParent", () => {
  it("completes when every sibling is done and the flag is on", () => {
    const siblings = [makeTask({ id: "a", status: "done" }), makeTask({ id: "b", status: "done" })];
    expect(shouldAutoCompleteParent(siblings, true)).toBe(true);
  });

  it("does not complete while a sibling is still pending", () => {
    const siblings = [makeTask({ id: "a", status: "done" }), makeTask({ id: "b", status: "todo" })];
    expect(shouldAutoCompleteParent(siblings, true)).toBe(false);
  });

  it("does not complete when all siblings are cancelled (nothing was actually finished)", () => {
    const siblings = [makeTask({ id: "a", status: "cancelled" }), makeTask({ id: "b", status: "cancelled" })];
    expect(shouldAutoCompleteParent(siblings, true)).toBe(false);
  });

  it("never completes when the flag is off, even if everything is done", () => {
    const siblings = [makeTask({ id: "a", status: "done" })];
    expect(shouldAutoCompleteParent(siblings, false)).toBe(false);
  });
});
