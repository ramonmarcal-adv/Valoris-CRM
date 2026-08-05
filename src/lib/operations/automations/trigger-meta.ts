import type { OperationAutomationTriggerType } from "@/types";

/**
 * Grouped, ordered trigger_type lists for the builder UI's trigger
 * picker (PRD 16.3's four categories). Labels come from i18n
 * (`Operations.automations.triggerType.*`), not from this file.
 */
export const CARD_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "card_created", "card_moved", "entered_stage", "left_stage", "field_changed",
  "priority_changed", "assignee_changed", "tag_added", "tag_removed", "card_archived",
];

export const TASK_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "task_created", "task_completed", "all_tasks_completed", "subtask_completed",
];

export const CHECKLIST_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "checklist_added", "checklist_completed", "all_items_completed",
];

export const TIME_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "date_reached", "days_before_date", "days_after_date",
  "task_due_today", "task_overdue", "task_overdue_days", "card_stuck_in_stage_days",
];

export const TRIGGER_TYPE_GROUPS = [
  { key: "card", types: CARD_TRIGGER_TYPES },
  { key: "task", types: TASK_TRIGGER_TYPES },
  { key: "checklist", types: CHECKLIST_TRIGGER_TYPES },
  { key: "time", types: TIME_TRIGGER_TYPES },
] as const;

/** Trigger types whose trigger_config needs a stage_id picker. */
export const STAGE_SCOPED_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "entered_stage", "left_stage", "card_stuck_in_stage_days",
];

/** Trigger types whose trigger_config needs a card-field (date/datetime) picker. */
export const FIELD_SCOPED_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "field_changed", "date_reached", "days_before_date", "days_after_date",
];

/** Trigger types whose trigger_config needs a tag picker. */
export const TAG_SCOPED_TRIGGER_TYPES: OperationAutomationTriggerType[] = ["tag_added", "tag_removed"];

/** Trigger types whose trigger_config needs a "days" number input. */
export const DAYS_SCOPED_TRIGGER_TYPES: OperationAutomationTriggerType[] = [
  "days_before_date", "days_after_date", "task_overdue_days", "card_stuck_in_stage_days",
];

/** Time-based trigger types — resolved by time-sweep-cron, not instant dispatch. */
export function isTimeBasedTrigger(type: OperationAutomationTriggerType): boolean {
  return (TIME_TRIGGER_TYPES as string[]).includes(type);
}
