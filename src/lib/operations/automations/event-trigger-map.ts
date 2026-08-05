import type { OperationAutomationTriggerType, OperationCardActivityEventType } from "@/types";

/**
 * Maps an operation_card_activity event to the set of automation
 * trigger_types it could POSSIBLY match — the caller (engine.ts) still
 * has to narrow further using each candidate's own trigger_config
 * (e.g. which stage_id an 'entered_stage' automation cares about) and,
 * for the "aggregate" candidates below, a DB lookup that this pure
 * function deliberately doesn't do:
 *
 * - 'task_completed' payload doesn't carry parent_task_id, so
 *   'subtask_completed' is always returned alongside it — the engine
 *   disambiguates by checking the task's own parent_task_id.
 * - 'all_tasks_completed' / 'all_items_completed' both require
 *   checking whether every SIBLING is now done, not just this one —
 *   returned as candidates here, confirmed by the engine.
 *
 * Not every operation_card_activity event_type corresponds to a PRD
 * 16.3 trigger (e.g. comment_added, relation_added/removed,
 * attachment_added/removed, task_reopened, task_assignee_changed,
 * task_deleted, unarchived) — those map to an empty array on purpose.
 */
export function mapActivityEventToTriggerCandidates(
  eventType: OperationCardActivityEventType,
  payload: Record<string, unknown>,
): OperationAutomationTriggerType[] {
  switch (eventType) {
    case "card_created":
      return ["card_created"];
    case "stage_changed": {
      const candidates: OperationAutomationTriggerType[] = ["card_moved"];
      if (payload.to_stage_id) candidates.push("entered_stage");
      if (payload.from_stage_id) candidates.push("left_stage");
      return candidates;
    }
    case "assignee_changed":
      return ["assignee_changed"];
    case "priority_changed":
      return ["priority_changed"];
    case "field_changed":
      return ["field_changed"];
    case "tag_added":
      return ["tag_added"];
    case "tag_removed":
      return ["tag_removed"];
    case "archived":
      return ["card_archived"];
    case "task_created":
      return ["task_created"];
    case "task_completed":
      return ["task_completed", "subtask_completed", "all_tasks_completed"];
    case "checklist_added":
      return ["checklist_added"];
    case "checklist_item_toggled":
      return payload.is_done === true ? ["checklist_completed", "all_items_completed"] : [];
    default:
      return [];
  }
}
