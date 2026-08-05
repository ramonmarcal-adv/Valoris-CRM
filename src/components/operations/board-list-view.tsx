"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityBadge } from "./priority-badge";
import type { OperationBoardStage, OperationCard, Profile } from "@/types";

type SortKey = "title" | "stage" | "priority" | "assignee";

const PRIORITY_RANK: Record<OperationCard["priority"], number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

interface BoardListViewProps {
  stages: OperationBoardStage[];
  cards: OperationCard[];
  profilesById: Map<string, Profile>;
  onOpenCard: (card: OperationCard) => void;
}

export function BoardListView({ stages, cards, profilesById, onOpenCard }: BoardListViewProps) {
  const t = useTranslations("Operations.listView");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortAsc, setSortAsc] = useState(true);

  const stagesById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const sorted = useMemo(() => {
    const withMeta = cards.map((card) => ({
      card,
      stageName: stagesById.get(card.stage_id)?.name ?? "",
      assigneeName: card.assigned_to_user_id
        ? (profilesById.get(card.assigned_to_user_id)?.full_name ?? "")
        : "",
    }));
    withMeta.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") cmp = a.card.title.localeCompare(b.card.title);
      else if (sortKey === "stage") cmp = a.stageName.localeCompare(b.stageName);
      else if (sortKey === "priority") cmp = PRIORITY_RANK[a.card.priority] - PRIORITY_RANK[b.card.priority];
      else if (sortKey === "assignee") cmp = a.assigneeName.localeCompare(b.assigneeName);
      return sortAsc ? cmp : -cmp;
    });
    return withMeta;
  }, [cards, stagesById, profilesById, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/60">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <SortableHead label={t("title")} active={sortKey === "title"} asc={sortAsc} onClick={() => toggleSort("title")} />
            <SortableHead label={t("stage")} active={sortKey === "stage"} asc={sortAsc} onClick={() => toggleSort("stage")} />
            <SortableHead label={t("priority")} active={sortKey === "priority"} asc={sortAsc} onClick={() => toggleSort("priority")} />
            <SortableHead label={t("assignee")} active={sortKey === "assignee"} asc={sortAsc} onClick={() => toggleSort("assignee")} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 && (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          )}
          {sorted.map(({ card, stageName, assigneeName }) => (
            <TableRow
              key={card.id}
              onClick={() => onOpenCard(card)}
              className="cursor-pointer border-border"
            >
              <TableCell className="whitespace-normal font-medium text-foreground">{card.title}</TableCell>
              <TableCell className="text-muted-foreground">{stageName}</TableCell>
              <TableCell>
                <PriorityBadge priority={card.priority} />
              </TableCell>
              <TableCell className="text-muted-foreground">{assigneeName || t("unassigned")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <TableHead className="text-muted-foreground">
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && <span className="text-[10px]">{asc ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}
