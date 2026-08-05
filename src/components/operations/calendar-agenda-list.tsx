"use client";

import { format } from "date-fns";
import { groupEventsByDay, type CalendarEvent } from "@/lib/operations/calendar";
import { CalendarEventPill } from "./calendar-event-pill";
import { useTranslations } from "next-intl";

interface CalendarAgendaListProps {
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarAgendaList({ events, onSelectEvent }: CalendarAgendaListProps) {
  const t = useTranslations("Operations.calendar");
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  const grouped = groupEventsByDay(sorted);
  const days = [...grouped.keys()].sort();

  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("agendaEmpty")}</p>;
  }

  return (
    <div className="space-y-4">
      {days.map((key) => {
        const dayEvents = grouped.get(key) ?? [];
        return (
          <div key={key}>
            <p className="mb-1.5 text-xs font-semibold text-foreground">{format(dayEvents[0].date, "dd/MM/yyyy")}</p>
            <div className="space-y-1">
              {dayEvents.map((event) => (
                <CalendarEventPill key={event.id} event={event} onClick={() => onSelectEvent(event)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
