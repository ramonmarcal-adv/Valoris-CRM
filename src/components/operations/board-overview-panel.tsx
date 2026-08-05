"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getBoardOverviewStats } from "@/lib/operations/board-overview";
import { computeBoardIndicator } from "@/lib/operations/board-indicators";
import { BoardIndicatorSettings } from "./board-indicator-settings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  OperationBoardIndicator,
  OperationBoardIndicatorAggType,
  OperationBoardOverviewStats,
  OperationBoardStage,
  OperationCardFieldDef,
} from "@/types";

interface BoardOverviewPanelProps {
  boardId: string;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
  canManage: boolean;
}

function formatIndicatorValue(value: number | null, aggType: OperationBoardIndicatorAggType): string {
  if (value === null) return "—";
  if (aggType === "percentage") return `${value}%`;
  if (aggType === "count") return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

export function BoardOverviewPanel({ boardId, stages, fieldDefs, canManage }: BoardOverviewPanelProps) {
  const t = useTranslations("Operations.overview");
  const supabase = createClient();

  const [stats, setStats] = useState<OperationBoardOverviewStats | null>(null);
  const [indicators, setIndicators] = useState<OperationBoardIndicator[]>([]);
  const [indicatorValues, setIndicatorValues] = useState<Map<string, number | null>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [overviewStats, { data: indicatorRows }] = await Promise.all([
      getBoardOverviewStats(supabase, boardId),
      supabase.from("operation_board_indicators").select("*").eq("board_id", boardId).is("archived_at", null).order("position"),
    ]);
    setStats(overviewStats);
    const indicatorList = (indicatorRows ?? []) as OperationBoardIndicator[];
    setIndicators(indicatorList);

    const values = new Map<string, number | null>();
    await Promise.all(
      indicatorList.map(async (ind) => {
        values.set(ind.id, await computeBoardIndicator(supabase, ind.id));
      }),
    );
    setIndicatorValues(values);
    setLoading(false);
  }, [supabase, boardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Settings className="mr-1 h-3.5 w-3.5" />
            {t("manageIndicators")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile label={t("activeCards")} value={stats?.active_cards ?? 0} />
        <StatTile label={t("completedCards")} value={stats?.completed_cards ?? 0} />
        <StatTile label={t("avgProgress")} value={stats?.avg_progress != null ? `${Math.round(stats.avg_progress)}%` : "—"} />
        <StatTile label={t("tasksPending")} value={stats?.tasks_pending ?? 0} />
        <StatTile label={t("tasksOverdue")} value={stats?.tasks_overdue ?? 0} tone={stats && stats.tasks_overdue > 0 ? "danger" : undefined} />
        <StatTile label={t("tasksDueToday")} value={stats?.tasks_due_today ?? 0} />
        <StatTile label={t("tasksDueThisWeek")} value={stats?.tasks_due_this_week ?? 0} />
      </div>

      {indicators.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {indicators.map((ind) => (
            <StatTile key={ind.id} label={ind.name} value={formatIndicatorValue(indicatorValues.get(ind.id) ?? null, ind.agg_type)} />
          ))}
        </div>
      )}

      <BoardIndicatorSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        boardId={boardId}
        stages={stages}
        fieldDefs={fieldDefs}
        onIndicatorsChanged={load}
      />
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "danger" ? "text-red-400" : "text-foreground")}>{value}</p>
    </div>
  );
}
