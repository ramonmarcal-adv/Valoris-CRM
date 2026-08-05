"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CalendarDays, KanbanSquare, LayoutDashboard, List } from "lucide-react";
import { useTranslations } from "next-intl";

export type BoardViewTab = "kanban" | "list" | "calendar" | "overview";

interface BoardViewTabsProps {
  boardId: string;
  active: BoardViewTab;
  /** Kanban/List share one page (data-fetching profile close enough to toggle locally); Calendar/Overview are real routes — different query shapes (aggregate RPCs, date ranges), so they get their own page instead of inflating every board visit's initial load. */
  onSelectLocal?: (tab: "kanban" | "list") => void;
}

export function BoardViewTabs({ boardId, active, onSelectLocal }: BoardViewTabsProps) {
  const t = useTranslations("Operations.boardPage");

  const tabs = [
    { key: "kanban" as const, label: t("viewKanban"), icon: KanbanSquare, href: undefined },
    { key: "list" as const, label: t("viewList"), icon: List, href: undefined },
    { key: "calendar" as const, label: t("viewCalendar"), icon: CalendarDays, href: `/operations/boards/${boardId}/calendar` },
    { key: "overview" as const, label: t("viewOverview"), icon: LayoutDashboard, href: `/operations/boards/${boardId}/overview` },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card p-0.5">
      {tabs.map((tab) => {
        const className = cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
          active === tab.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
        );
        if (tab.href) {
          return (
            <Link key={tab.key} href={tab.href} className={className}>
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        }
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              if (tab.key === "kanban" || tab.key === "list") onSelectLocal?.(tab.key);
            }}
            className={className}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
