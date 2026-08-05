import { describe, expect, it } from "vitest";
import { buildMonthGrid, buildWeekGrid, dayKey, groupEventsByDay, type CalendarEvent } from "./calendar";

describe("buildMonthGrid", () => {
  it("returns full weeks covering the month, including neighboring-month days", () => {
    // May 2026 starts on a Friday and ends on a Sunday — the grid
    // should pad out to full Sun-Sat weeks on both ends.
    const grid = buildMonthGrid(new Date("2026-05-15T12:00:00Z"));
    expect(grid.length % 7).toBe(0);
    expect(grid[0].getDay()).toBe(0); // Sunday
    expect(grid[grid.length - 1].getDay()).toBe(6); // Saturday
    // First cell must be on/before May 1, last cell on/after May 31.
    expect(grid[0].getTime()).toBeLessThanOrEqual(new Date("2026-05-01T12:00:00Z").getTime());
    expect(grid[grid.length - 1].getTime()).toBeGreaterThanOrEqual(new Date("2026-05-31T12:00:00Z").getTime());
  });
});

describe("buildWeekGrid", () => {
  it("returns exactly 7 days, Sunday through Saturday", () => {
    const grid = buildWeekGrid(new Date("2026-05-15T12:00:00Z"));
    expect(grid).toHaveLength(7);
    expect(grid[0].getDay()).toBe(0);
    expect(grid[6].getDay()).toBe(6);
  });
});

describe("groupEventsByDay", () => {
  it("groups a card event and a task event on the same day, preserving their kind", () => {
    const events: CalendarEvent[] = [
      { id: "1", date: new Date("2026-05-15T10:00:00"), kind: "card", title: "Leilão", cardId: "c1" },
      { id: "2", date: new Date("2026-05-15T18:00:00"), kind: "task", title: "Follow-up", cardId: "c1", taskId: "t1" },
    ];
    const grouped = groupEventsByDay(events);
    const key = dayKey(new Date("2026-05-15T00:00:00"));
    expect(grouped.get(key)).toHaveLength(2);
    expect(grouped.get(key)?.map((e) => e.kind).sort()).toEqual(["card", "task"]);
  });

  it("keeps events on different days in separate buckets", () => {
    const events: CalendarEvent[] = [
      { id: "1", date: new Date("2026-05-15T10:00:00"), kind: "card", title: "A", cardId: "c1" },
      { id: "2", date: new Date("2026-05-16T10:00:00"), kind: "card", title: "B", cardId: "c2" },
    ];
    const grouped = groupEventsByDay(events);
    expect(grouped.size).toBe(2);
  });
});
