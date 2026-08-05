"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addMonths, addWeeks, format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { groupEventsByDay, type CalendarEvent } from "@/lib/operations/calendar";
import { CalendarMonthGrid } from "./calendar-month-grid";
import { CalendarWeekGrid } from "./calendar-week-grid";
import { CalendarAgendaList } from "./calendar-agenda-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OperationBoard } from "@/types";

type CalendarMode = "month" | "week" | "agenda";

export function BoardCalendar({ board }: { board: OperationBoard }) {
  const t = useTranslations("Operations.calendar");
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const cardEvents: CalendarEvent[] = [];
    if (board.calendar_field_def_id) {
      const { data: valueRows } = await supabase
        .from("operation_card_field_values")
        .select("card_id, value_date, card:operation_cards(id, title, archived_at)")
        .eq("field_def_id", board.calendar_field_def_id)
        .not("value_date", "is", null);
      for (const row of (valueRows ?? []) as unknown as {
        card_id: string;
        value_date: string;
        card: { id: string; title: string; archived_at: string | null } | null;
      }[]) {
        if (!row.card || row.card.archived_at) continue;
        cardEvents.push({ id: `card-${row.card_id}`, date: new Date(row.value_date), kind: "card", title: row.card.title, cardId: row.card_id });
      }
    }

    const { data: taskRows } = await supabase
      .from("operation_tasks")
      .select("id, title, due_at, card_id, card:operation_cards!inner(board_id, archived_at)")
      .eq("card.board_id", board.id)
      .neq("status", "cancelled")
      .not("due_at", "is", null);
    const taskEvents: CalendarEvent[] = ((taskRows ?? []) as unknown as {
      id: string;
      title: string;
      due_at: string;
      card_id: string;
      card: { board_id: string; archived_at: string | null };
    }[])
      .filter((row) => !row.card.archived_at)
      .map((row) => ({ id: `task-${row.id}`, date: new Date(row.due_at), kind: "task" as const, title: row.title, cardId: row.card_id, taskId: row.id }));

    setEvents([...cardEvents, ...taskEvents]);
    setLoading(false);
  }, [supabase, board.id, board.calendar_field_def_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleSelectEvent(event: CalendarEvent) {
    router.push(`/operations/cards/${event.cardId}`);
  }

  function goToday() {
    setAnchor(new Date());
  }
  function goPrev() {
    setAnchor((prev) => (mode === "week" ? addWeeks(prev, -1) : addMonths(prev, -1)));
  }
  function goNext() {
    setAnchor((prev) => (mode === "week" ? addWeeks(prev, 1) : addMonths(prev, 1)));
  }

  const eventsByDay = groupEventsByDay(events);

  if (!board.calendar_field_def_id) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
        <p className="text-sm text-muted-foreground">{t("noFieldConfigured")}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="h-96 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={goPrev} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={goNext} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <Button variant="ghost" size="sm" onClick={goToday} className="h-7 text-muted-foreground hover:text-foreground">
            {t("today")}
          </Button>
          <span className="ml-1 text-sm font-medium text-foreground">{format(anchor, "MMMM yyyy")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {(["month", "week", "agenda"] as CalendarMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {mode === "month" && <CalendarMonthGrid monthAnchor={anchor} eventsByDay={eventsByDay} onSelectEvent={handleSelectEvent} />}
      {mode === "week" && <CalendarWeekGrid weekAnchor={anchor} eventsByDay={eventsByDay} onSelectEvent={handleSelectEvent} />}
      {mode === "agenda" && <CalendarAgendaList events={events} onSelectEvent={handleSelectEvent} />}
    </div>
  );
}
