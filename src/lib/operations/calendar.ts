import { eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

/**
 * Hand-rolled Month/Week grid — no calendar library dependency,
 * matching this app's existing pattern for graphics (the dashboard's
 * donut/line charts are hand-drawn SVG, not a charting library
 * either). Built entirely on date-fns, already a project dependency.
 */
export function buildMonthGrid(monthAnchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
}

export function buildWeekGrid(weekAnchor: Date): Date[] {
  const start = startOfWeek(weekAnchor, { weekStartsOn: 0 });
  const end = endOfWeek(weekAnchor, { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
}

export type CalendarEventKind = "card" | "task";

export interface CalendarEvent {
  id: string;
  date: Date;
  kind: CalendarEventKind;
  title: string;
  cardId: string;
  taskId?: string;
}

const DAY_KEY_FORMAT = "yyyy-MM-dd";

export function dayKey(date: Date): string {
  return format(date, DAY_KEY_FORMAT);
}

/** Buckets events by calendar day (local) — one lookup key per grid cell. */
export function groupEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.date);
    const bucket = map.get(key) ?? [];
    bucket.push(event);
    map.set(key, bucket);
  }
  return map;
}
