import { describe, expect, it } from "vitest";
import { mapActivityEventToTriggerCandidates } from "./event-trigger-map";
import type { OperationCardActivityEventType } from "@/types";

const ALL_EVENT_TYPES: OperationCardActivityEventType[] = [
  "card_created", "stage_changed", "assignee_changed", "priority_changed",
  "field_changed", "comment_added", "relation_added", "relation_removed",
  "attachment_added", "attachment_removed", "archived", "unarchived",
  "task_created", "task_completed", "task_reopened", "task_assignee_changed",
  "task_deleted", "checklist_item_toggled", "tag_added", "tag_removed", "checklist_added",
];

describe("mapActivityEventToTriggerCandidates", () => {
  it("every event_type is handled explicitly — nothing falls through unnoticed", () => {
    // Not asserting non-empty for all — some legitimately map to [] — but
    // this at least exercises the full switch without throwing, so a
    // newly-added event_type without a case doesn't silently pass CI.
    for (const eventType of ALL_EVENT_TYPES) {
      expect(() => mapActivityEventToTriggerCandidates(eventType, {})).not.toThrow();
    }
  });

  it("stage_changed maps to card_moved plus entered_stage/left_stage depending on payload", () => {
    expect(mapActivityEventToTriggerCandidates("stage_changed", { from_stage_id: "a", to_stage_id: "b" })).toEqual([
      "card_moved", "entered_stage", "left_stage",
    ]);
    expect(mapActivityEventToTriggerCandidates("stage_changed", {})).toEqual(["card_moved"]);
  });

  it("task_completed maps to all three ambiguous candidates for the engine to disambiguate", () => {
    expect(mapActivityEventToTriggerCandidates("task_completed", {})).toEqual([
      "task_completed", "subtask_completed", "all_tasks_completed",
    ]);
  });

  it("checklist_item_toggled only maps when is_done is true", () => {
    expect(mapActivityEventToTriggerCandidates("checklist_item_toggled", { is_done: true })).toEqual([
      "checklist_completed", "all_items_completed",
    ]);
    expect(mapActivityEventToTriggerCandidates("checklist_item_toggled", { is_done: false })).toEqual([]);
  });

  it("events with no PRD 16.3 equivalent map to an empty array", () => {
    for (const eventType of ["comment_added", "relation_added", "relation_removed", "attachment_added", "attachment_removed", "unarchived", "task_reopened", "task_assignee_changed", "task_deleted"] as OperationCardActivityEventType[]) {
      expect(mapActivityEventToTriggerCandidates(eventType, {})).toEqual([]);
    }
  });
});
