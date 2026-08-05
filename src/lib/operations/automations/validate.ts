import type { OperationAutomationCondition, OperationAutomationStepType, OperationAutomationTriggerType } from "@/types";
import { DAYS_SCOPED_TRIGGER_TYPES, FIELD_SCOPED_TRIGGER_TYPES, STAGE_SCOPED_TRIGGER_TYPES, TAG_SCOPED_TRIGGER_TYPES } from "./trigger-meta";

/**
 * Pre-flight config validation, mirroring src/lib/automations/validate.ts's
 * role for the Deal/Conversation engine: catch a broken automation at
 * save/activate time (missing stage_id, missing field_def_id, etc.)
 * instead of letting it silently produce failed execution logs later.
 */
export interface OperationAutomationValidationIssue {
  path: string;
  message: string;
}

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null;
}

export function validateTriggerConfig(
  triggerType: OperationAutomationTriggerType,
  config: Record<string, unknown>,
): OperationAutomationValidationIssue[] {
  const issues: OperationAutomationValidationIssue[] = [];
  if ((STAGE_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && !nonEmpty(config.stage_id)) {
    issues.push({ path: "trigger_config.stage_id", message: "stage is required for this trigger" });
  }
  if ((FIELD_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && !nonEmpty(config.field_def_id)) {
    issues.push({ path: "trigger_config.field_def_id", message: "field is required for this trigger" });
  }
  if ((TAG_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && !nonEmpty(config.tag_id)) {
    issues.push({ path: "trigger_config.tag_id", message: "tag is required for this trigger" });
  }
  if ((DAYS_SCOPED_TRIGGER_TYPES as string[]).includes(triggerType) && typeof config.days !== "number") {
    issues.push({ path: "trigger_config.days", message: "a number of days is required for this trigger" });
  }
  return issues;
}

export function validateCondition(
  condition: OperationAutomationCondition,
  index: number,
): OperationAutomationValidationIssue[] {
  const issues: OperationAutomationValidationIssue[] = [];
  const path = `conditions[${index}]`;
  if (condition.subject === "card_field" && !nonEmpty(condition.field_def_id)) {
    issues.push({ path: `${path}.field_def_id`, message: "field is required for a card_field condition" });
  }
  const needsValue = !["empty", "not_empty"].includes(condition.operator);
  if (needsValue && !nonEmpty(condition.value)) {
    issues.push({ path: `${path}.value`, message: "a comparison value is required for this operator" });
  }
  return issues;
}

interface StepLike {
  step_type: OperationAutomationStepType;
  step_config: Record<string, unknown>;
}

export function validateStep(step: StepLike, index: number): OperationAutomationValidationIssue[] {
  const issues: OperationAutomationValidationIssue[] = [];
  const path = `steps[${index}]`;
  const c = step.step_config ?? {};
  switch (step.step_type) {
    case "move_card":
      if (!nonEmpty(c.stage_id)) issues.push({ path: `${path}.stage_id`, message: "destination stage is required" });
      break;
    case "change_field":
      if (!nonEmpty(c.field_def_id)) issues.push({ path: `${path}.field_def_id`, message: "field is required" });
      break;
    case "change_priority":
      if (!nonEmpty(c.priority)) issues.push({ path: `${path}.priority`, message: "priority is required" });
      break;
    case "assign_card":
      if (!nonEmpty(c.user_id)) issues.push({ path: `${path}.user_id`, message: "user is required" });
      break;
    case "add_card_tag":
    case "remove_card_tag":
      if (!nonEmpty(c.tag_id)) issues.push({ path: `${path}.tag_id`, message: "tag is required" });
      break;
    case "create_task":
      if (!nonEmpty(c.title)) issues.push({ path: `${path}.title`, message: "task title is required" });
      break;
    case "apply_task_template":
    case "apply_checklist_template":
      if (!nonEmpty(c.template_id)) issues.push({ path: `${path}.template_id`, message: "template is required" });
      break;
    case "add_comment":
      if (!nonEmpty(c.text)) issues.push({ path: `${path}.text`, message: "comment text is required" });
      break;
    case "create_card":
      if (!nonEmpty(c.title)) issues.push({ path: `${path}.title`, message: "card title is required" });
      break;
    case "relate_cards":
      // to_card_id is allowed to be absent when a prior create_card step in
      // the same automation supplies it at execution time — nothing to
      // validate statically here.
      break;
    case "wait":
      if (typeof c.minutes !== "number" && typeof c.hours !== "number" && typeof c.days !== "number") {
        issues.push({ path: `${path}.duration`, message: "a wait duration (minutes/hours/days) is required" });
      }
      break;
    default:
      break;
  }
  return issues;
}

export function validateAutomationForActivation(automation: {
  trigger_type: OperationAutomationTriggerType;
  trigger_config: Record<string, unknown>;
  conditions: OperationAutomationCondition[];
  steps: StepLike[];
}): OperationAutomationValidationIssue[] {
  const issues: OperationAutomationValidationIssue[] = [];
  issues.push(...validateTriggerConfig(automation.trigger_type, automation.trigger_config));
  automation.conditions.forEach((condition, i) => issues.push(...validateCondition(condition, i)));
  if (automation.steps.length === 0) {
    issues.push({ path: "steps", message: "at least one action is required" });
  }
  automation.steps.forEach((step, i) => issues.push(...validateStep(step, i)));
  return issues;
}
