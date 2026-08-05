import { describe, expect, it } from "vitest";
import { classifyTaskDueDate } from "./board-overview";

// "now" = 2026-05-18T15:00:00Z = 2026-05-18 12:00 local (UTC-3), so
// local "today" is 2026-05-18. today_start (local midnight) as a UTC
// instant is 2026-05-18T03:00:00Z; tomorrow_start is 2026-05-19T03:00:00Z;
// the 7-day window ends at 2026-05-25T03:00:00Z.
const NOW = new Date("2026-05-18T15:00:00Z");

describe("classifyTaskDueDate", () => {
  it("returns done_or_cancelled regardless of due_at when the task is finished", () => {
    expect(classifyTaskDueDate("2020-01-01T00:00:00Z", "done", NOW)).toBe("done_or_cancelled");
    expect(classifyTaskDueDate(null, "cancelled", NOW)).toBe("done_or_cancelled");
  });

  it("returns none when there's no due date and the task is still open", () => {
    expect(classifyTaskDueDate(null, "todo", NOW)).toBe("none");
  });

  it("classifies yesterday 23:59 local as overdue", () => {
    expect(classifyTaskDueDate("2026-05-18T02:59:00Z", "todo", NOW)).toBe("overdue");
  });

  it("classifies today 00:00 local as due_today, not overdue", () => {
    expect(classifyTaskDueDate("2026-05-18T03:00:00Z", "todo", NOW)).toBe("due_today");
  });

  it("classifies today 23:59 local as due_today, not due_this_week", () => {
    expect(classifyTaskDueDate("2026-05-19T02:59:00Z", "todo", NOW)).toBe("due_today");
  });

  it("classifies tomorrow 00:00 local as due_this_week", () => {
    expect(classifyTaskDueDate("2026-05-19T03:00:00Z", "in_progress", NOW)).toBe("due_this_week");
  });

  it("classifies the day just inside the 7-day window as due_this_week", () => {
    expect(classifyTaskDueDate("2026-05-25T02:59:00Z", "todo", NOW)).toBe("due_this_week");
  });

  it("classifies the day the 7-day window ends as future, not due_this_week", () => {
    expect(classifyTaskDueDate("2026-05-25T03:00:00Z", "todo", NOW)).toBe("future");
  });

  it("classifies a date far in the future as future", () => {
    expect(classifyTaskDueDate("2027-01-01T00:00:00Z", "todo", NOW)).toBe("future");
  });
});
