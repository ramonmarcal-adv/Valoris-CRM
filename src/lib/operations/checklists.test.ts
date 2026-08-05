import { describe, expect, it } from "vitest";
import { computeChecklistProgress } from "./checklists";
import type { OperationChecklistItem } from "@/types";

function makeItem(overrides: Partial<OperationChecklistItem>): OperationChecklistItem {
  return {
    id: "item-1",
    checklist_id: "chk-1",
    item_text: "Item",
    is_done: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeChecklistProgress", () => {
  it("returns null for an empty checklist", () => {
    expect(computeChecklistProgress([])).toBeNull();
  });

  it("returns 100 when every item is done", () => {
    expect(computeChecklistProgress([makeItem({ is_done: true }), makeItem({ id: "2", is_done: true })])).toBe(100);
  });

  it("returns a partial percentage", () => {
    const items = [makeItem({ id: "1", is_done: true }), makeItem({ id: "2" }), makeItem({ id: "3" })];
    expect(computeChecklistProgress(items)).toBe(33);
  });
});
