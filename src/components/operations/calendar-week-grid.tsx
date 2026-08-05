"use client";

import { buildWeekGrid, dayKey, type CalendarEvent } from "@/lib/operations/calendar";
import { CalendarEventPill } from "./calendar-event-pill";
import { cn } from "@/lib/utils";

interface CalendarWeekGridProps {
  weekAnchor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarWeekGrid({ weekAnchor, eventsByDay, onSelectEvent }: CalendarWeekGridProps) {
  const days = buildWeekGrid(weekAnchor);
  const today = dayKey(new Date());

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const key = dayKey(day);
        const events = eventsByDay.get(key) ?? [];
        return (
          <div
            key={key}
            className={cn("min-h-40 rounded-lg border border-border bg-card p-2", key === today && "ring-1 ring-primary")}
          >
            <p className="text-xs font-medium text-foreground">{day.getDate()}</p>
            <div className="mt-1.5 space-y-1">
              {events.map((event) => (
                <CalendarEventPill key={event.id} event={event} onClick={() => onSelectEvent(event)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
