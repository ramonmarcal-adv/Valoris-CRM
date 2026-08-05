"use client";

import { buildMonthGrid, dayKey, type CalendarEvent } from "@/lib/operations/calendar";
import { CalendarEventPill } from "./calendar-event-pill";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MAX_VISIBLE_EVENTS = 3;

interface CalendarMonthGridProps {
  monthAnchor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthGrid({ monthAnchor, eventsByDay, onSelectEvent }: CalendarMonthGridProps) {
  const t = useTranslations("Operations.calendar.weekdays");
  const days = buildMonthGrid(monthAnchor);
  const currentMonth = monthAnchor.getMonth();
  const today = dayKey(new Date());

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 gap-px bg-border">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="bg-card px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground">
            {t(key)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((day) => {
          const key = dayKey(day);
          const events = eventsByDay.get(key) ?? [];
          const isCurrentMonth = day.getMonth() === currentMonth;
          return (
            <div
              key={key}
              className={cn("min-h-24 bg-card p-1", !isCurrentMonth && "opacity-40", key === today && "ring-1 ring-inset ring-primary")}
            >
              <span className="text-xs text-muted-foreground">{day.getDate()}</span>
              <div className="mt-1 space-y-0.5">
                {events.slice(0, MAX_VISIBLE_EVENTS).map((event) => (
                  <CalendarEventPill key={event.id} event={event} onClick={() => onSelectEvent(event)} />
                ))}
                {events.length > MAX_VISIBLE_EVENTS && (
                  <span className="block px-1 text-[10px] text-muted-foreground">
                    +{events.length - MAX_VISIBLE_EVENTS}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
