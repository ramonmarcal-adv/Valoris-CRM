import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateConditions, type OperationAutomationConditionContext } from "./condition-eval";
import type { OperationAutomationCondition } from "@/types";

function makeContext(overrides?: Partial<OperationAutomationConditionContext>): OperationAutomationConditionContext {
  return {
    card: { priority: "normal", stage_id: "stage-1", assigned_to_user_id: null },
    task: null,
    fieldValues: {},
    tagIds: [],
    ...overrides,
  };
}

describe("evaluateCondition — card_priority / card_stage", () => {
  it("matches equal", () => {
    const cond: OperationAutomationCondition = { subject: "card_priority", operator: "equal", value: "high" };
    expect(evaluateCondition(cond, makeContext({ card: { priority: "high", stage_id: "s", assigned_to_user_id: null } }))).toBe(true);
    expect(evaluateCondition(cond, makeContext())).toBe(false);
  });

  it("matches not_equal", () => {
    const cond: OperationAutomationCondition = { subject: "card_stage", operator: "not_equal", value: "stage-2" };
    expect(evaluateCondition(cond, makeContext())).toBe(true);
    expect(evaluateCondition(cond, makeContext({ card: { priority: "normal", stage_id: "stage-2", assigned_to_user_id: null } }))).toBe(false);
  });
});

describe("evaluateCondition — card_assignee / task_assignee", () => {
  it("empty/not_empty", () => {
    const empty: OperationAutomationCondition = { subject: "card_assignee", operator: "empty" };
    const notEmpty: OperationAutomationCondition = { subject: "card_assignee", operator: "not_empty" };
    expect(evaluateCondition(empty, makeContext())).toBe(true);
    expect(evaluateCondition(notEmpty, makeContext())).toBe(false);
    const assigned = makeContext({ card: { priority: "normal", stage_id: "s", assigned_to_user_id: "user-1" } });
    expect(evaluateCondition(empty, assigned)).toBe(false);
    expect(evaluateCondition(notEmpty, assigned)).toBe(true);
  });

  it("task_assignee is false when there is no task in context", () => {
    const cond: OperationAutomationCondition = { subject: "task_assignee", operator: "not_empty" };
    expect(evaluateCondition(cond, makeContext())).toBe(false);
  });
});

describe("evaluateCondition — card_tag", () => {
  it("tag_exists / tag_not_exists", () => {
    const ctx = makeContext({ tagIds: ["tag-a", "tag-b"] });
    expect(evaluateCondition({ subject: "card_tag", operator: "tag_exists", value: "tag-a" }, ctx)).toBe(true);
    expect(evaluateCondition({ subject: "card_tag", operator: "tag_exists", value: "tag-z" }, ctx)).toBe(false);
    expect(evaluateCondition({ subject: "card_tag", operator: "tag_not_exists", value: "tag-z" }, ctx)).toBe(true);
  });
});

describe("evaluateCondition — task_due_date", () => {
  const withDueDate = makeContext({
    task: { priority: "normal", status: "todo", assigned_to_user_id: null, due_at: "2026-06-15T00:00:00Z" },
  });

  it("date_before / date_after", () => {
    expect(evaluateCondition({ subject: "task_due_date", operator: "date_before", value: "2026-07-01" }, withDueDate)).toBe(true);
    expect(evaluateCondition({ subject: "task_due_date", operator: "date_after", value: "2026-07-01" }, withDueDate)).toBe(false);
  });

  it("empty when the task has no due date", () => {
    const noDueDate = makeContext({ task: { priority: "normal", status: "todo", assigned_to_user_id: null, due_at: null } });
    expect(evaluateCondition({ subject: "task_due_date", operator: "empty" }, noDueDate)).toBe(true);
    expect(evaluateCondition({ subject: "task_due_date", operator: "date_before", value: "2026-07-01" }, noDueDate)).toBe(false);
  });
});

describe("evaluateCondition — card_field", () => {
  it("equal / not_equal on a text field", () => {
    const ctx = makeContext({ fieldValues: { "field-1": { text: "Financing" } } });
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "equal", value: "Financing" }, ctx)).toBe(true);
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "not_equal", value: "Cash" }, ctx)).toBe(true);
  });

  it("greater_than / less_than on a number field", () => {
    const ctx = makeContext({ fieldValues: { "field-1": { number: 500000 } } });
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "greater_than", value: 100000 }, ctx)).toBe(true);
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "less_than", value: 100000 }, ctx)).toBe(false);
  });

  it("contains / not_contains on a multi_select field", () => {
    const ctx = makeContext({ fieldValues: { "field-1": { multiSelect: ["cash", "financing"] } } });
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "contains", value: "cash" }, ctx)).toBe(true);
    expect(evaluateCondition({ subject: "card_field", field_def_id: "field-1", operator: "not_contains", value: "fgts" }, ctx)).toBe(true);
  });

  it("empty / not_empty when the field has no value at all", () => {
    const ctx = makeContext();
    expect(evaluateCondition({ subject: "card_field", field_def_id: "missing-field", operator: "empty" }, ctx)).toBe(true);
    expect(evaluateCondition({ subject: "card_field", field_def_id: "missing-field", operator: "not_empty" }, ctx)).toBe(false);
  });
});

describe("evaluateConditions", () => {
  it("is AND-only — all conditions must pass", () => {
    const conditions: OperationAutomationCondition[] = [
      { subject: "card_priority", operator: "equal", value: "high" },
      { subject: "card_tag", operator: "tag_exists", value: "urgent" },
    ];
    const ctx = makeContext({ card: { priority: "high", stage_id: "s", assigned_to_user_id: null }, tagIds: ["urgent"] });
    expect(evaluateConditions(conditions, ctx)).toBe(true);
    expect(evaluateConditions(conditions, { ...ctx, tagIds: [] })).toBe(false);
  });

  it("an empty condition list always passes", () => {
    expect(evaluateConditions([], makeContext())).toBe(true);
  });
});
