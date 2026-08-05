import type { OperationAutomationCondition } from "@/types";

/** One custom field's already-resolved value, keyed by field_def_id in the context below. */
export interface OperationAutomationFieldValue {
  text?: string | null;
  number?: number | null;
  date?: string | null;
  boolean?: boolean | null;
  uuid?: string | null;
  multiSelect?: string[] | null;
}

export interface OperationAutomationConditionContext {
  card: { priority: string; stage_id: string; assigned_to_user_id: string | null };
  task?: { priority: string; status: string; assigned_to_user_id: string | null; due_at: string | null } | null;
  /** Keyed by field_def_id. */
  fieldValues: Record<string, OperationAutomationFieldValue>;
  tagIds: string[];
  now?: Date;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function fieldScalar(fv: OperationAutomationFieldValue | undefined): string | number | boolean | null {
  if (!fv) return null;
  if (fv.text != null) return fv.text;
  if (fv.number != null) return fv.number;
  if (fv.date != null) return fv.date;
  if (fv.boolean != null) return fv.boolean;
  if (fv.uuid != null) return fv.uuid;
  return null;
}

function evaluateFieldOperator(
  operator: OperationAutomationCondition["operator"],
  fv: OperationAutomationFieldValue | undefined,
  expected: OperationAutomationCondition["value"],
): boolean {
  switch (operator) {
    case "empty":
      return isEmptyValue(fieldScalar(fv)) && isEmptyValue(fv?.multiSelect);
    case "not_empty":
      return !(isEmptyValue(fieldScalar(fv)) && isEmptyValue(fv?.multiSelect));
    case "equal":
      return String(fieldScalar(fv) ?? "") === String(expected ?? "");
    case "not_equal":
      return String(fieldScalar(fv) ?? "") !== String(expected ?? "");
    case "contains":
      if (fv?.multiSelect) return fv.multiSelect.includes(String(expected ?? ""));
      return typeof fv?.text === "string" && fv.text.toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains":
      return !evaluateFieldOperator("contains", fv, expected);
    case "greater_than":
      return typeof fv?.number === "number" && typeof expected === "number" && fv.number > expected;
    case "less_than":
      return typeof fv?.number === "number" && typeof expected === "number" && fv.number < expected;
    case "date_before":
      return typeof fv?.date === "string" && new Date(fv.date) < new Date(String(expected));
    case "date_after":
      return typeof fv?.date === "string" && new Date(fv.date) > new Date(String(expected));
    default:
      return false;
  }
}

function evaluateEquality(
  operator: OperationAutomationCondition["operator"],
  actual: string | null,
  expected: OperationAutomationCondition["value"],
): boolean {
  if (operator === "equal") return actual !== null && String(actual) === String(expected ?? "");
  if (operator === "not_equal") return String(actual ?? "") !== String(expected ?? "");
  return false;
}

function evaluateAssignee(
  operator: OperationAutomationCondition["operator"],
  actualUserId: string | null,
  expected: OperationAutomationCondition["value"],
): boolean {
  if (operator === "empty") return actualUserId === null;
  if (operator === "not_empty") return actualUserId !== null;
  return evaluateEquality(operator, actualUserId, expected);
}

function evaluateDate(
  operator: OperationAutomationCondition["operator"],
  actualISODate: string | null,
  expected: OperationAutomationCondition["value"],
): boolean {
  if (operator === "empty") return actualISODate === null;
  if (operator === "not_empty") return actualISODate !== null;
  if (actualISODate === null) return false;
  if (operator === "date_before") return new Date(actualISODate) < new Date(String(expected));
  if (operator === "date_after") return new Date(actualISODate) > new Date(String(expected));
  return false;
}

/** Evaluates a single condition against a resolved context. */
export function evaluateCondition(
  condition: OperationAutomationCondition,
  ctx: OperationAutomationConditionContext,
): boolean {
  switch (condition.subject) {
    case "card_field":
      if (!condition.field_def_id) return false;
      return evaluateFieldOperator(condition.operator, ctx.fieldValues[condition.field_def_id], condition.value);
    case "card_priority":
      return evaluateEquality(condition.operator, ctx.card.priority, condition.value);
    case "task_priority":
      return ctx.task ? evaluateEquality(condition.operator, ctx.task.priority, condition.value) : false;
    case "card_stage":
      return evaluateEquality(condition.operator, ctx.card.stage_id, condition.value);
    case "task_status":
      return ctx.task ? evaluateEquality(condition.operator, ctx.task.status, condition.value) : false;
    case "card_assignee":
      return evaluateAssignee(condition.operator, ctx.card.assigned_to_user_id, condition.value);
    case "task_assignee":
      return ctx.task ? evaluateAssignee(condition.operator, ctx.task.assigned_to_user_id, condition.value) : false;
    case "card_tag":
      if (condition.operator === "tag_exists") return ctx.tagIds.includes(String(condition.value ?? ""));
      if (condition.operator === "tag_not_exists") return !ctx.tagIds.includes(String(condition.value ?? ""));
      return false;
    case "task_due_date":
      return ctx.task ? evaluateDate(condition.operator, ctx.task.due_at, condition.value) : false;
    default:
      return false;
  }
}

/** AND-only combination (PRD 16.4/39 — OR and condition groups are out of scope for this release). Empty array = pass. */
export function evaluateConditions(
  conditions: OperationAutomationCondition[],
  ctx: OperationAutomationConditionContext,
): boolean {
  return conditions.every((condition) => evaluateCondition(condition, ctx));
}
