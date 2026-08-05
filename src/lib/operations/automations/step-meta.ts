import type { OperationAutomationStepType } from "@/types";

/** Ordered step_type list for the builder UI's "add action" menu. Labels come from i18n (`Operations.automations.stepType.*`). */
export const ADDABLE_STEP_TYPES: OperationAutomationStepType[] = [
  "move_card", "change_field", "change_priority", "assign_card",
  "add_card_tag", "remove_card_tag", "create_task", "apply_task_template",
  "add_checklist", "apply_checklist_template", "add_comment",
  "create_card", "relate_cards", "archive_card", "wait",
];

/** Step types whose step_config needs a stage_id picker. */
export const STAGE_SCOPED_STEP_TYPES: OperationAutomationStepType[] = ["move_card"];

/** Step types whose step_config needs a card-field picker. */
export const FIELD_SCOPED_STEP_TYPES: OperationAutomationStepType[] = ["change_field"];

/** Step types whose step_config needs a tag picker. */
export const TAG_SCOPED_STEP_TYPES: OperationAutomationStepType[] = ["add_card_tag", "remove_card_tag"];

/** Step types whose step_config needs a task-template picker. */
export const TASK_TEMPLATE_SCOPED_STEP_TYPES: OperationAutomationStepType[] = ["apply_task_template"];

/** Step types whose step_config needs a checklist-template picker. */
export const CHECKLIST_TEMPLATE_SCOPED_STEP_TYPES: OperationAutomationStepType[] = ["apply_checklist_template"];
