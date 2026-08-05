"use client";

import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/operations/calendar";

/** Visually differentiates a Card-originated event from a Task-originated one, per PRD 9. */
export function CalendarEventPill({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={event.title}
      className={cn(
        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium transition-colors",
        event.kind === "card"
          ? "bg-primary/15 text-primary hover:bg-primary/25"
          : "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25",
      )}
    >
      {event.title}
    </button>
  );
}
