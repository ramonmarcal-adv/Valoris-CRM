"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";
import type { InboxAssignmentFilter, InboxTypeFilter } from "@/lib/inbox/conversations";
import { ChevronDown, X, Inbox as InboxIcon, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface InboxFilterBarProps {
  typeFilter: InboxTypeFilter;
  onTypeFilterChange: (value: InboxTypeFilter) => void;
  assignmentFilter: InboxAssignmentFilter;
  onAssignmentFilterChange: (value: InboxAssignmentFilter) => void;
  tags: Tag[];
  selectedTagIds: string[];
  onToggleTag: (id: string) => void;
  companies: string[];
  selectedCompany: string | null;
  onSelectCompany: (company: string | null) => void;
  onClearContactFilters: () => void;
  unassignedCount: number;
  canSendMessages: boolean;
  canManageMembers: boolean;
  releasingLeads: boolean;
  redistributing: boolean;
  onReleaseMyLeads: () => void;
  onRedistributeQueue: () => void;
}

/**
 * Search + filter toolbar shared between the List and Kanban views
 * (lifted out of conversation-list.tsx, 2026-08-03, so the same
 * filters apply regardless of which view is active — previously
 * List-only, with Kanban seeing every conversation unfiltered).
 * Purely controlled — all state lives in inbox/page.tsx.
 */
export function InboxFilterBar({
  typeFilter,
  onTypeFilterChange,
  assignmentFilter,
  onAssignmentFilterChange,
  tags,
  selectedTagIds,
  onToggleTag,
  companies,
  selectedCompany,
  onSelectCompany,
  onClearContactFilters,
  unassignedCount,
  canSendMessages,
  canManageMembers,
  releasingLeads,
  redistributing,
  onReleaseMyLeads,
  onRedistributeQueue,
}: InboxFilterBarProps) {
  const t = useTranslations("Inbox.conversationList");

  const FILTER_OPTIONS: { label: string; value: InboxTypeFilter }[] = useMemo(
    () => [
      { label: t("filterAll"), value: "all" },
      { label: t("filterUnread"), value: "unread" },
      { label: t("filterFavorites"), value: "favorites" },
      { label: t("filterGroups"), value: "groups" },
      { label: t("filterReminders"), value: "reminders" },
      { label: t("filterManualReminders"), value: "manualReminders" },
      { label: t("filterAutomatedReminders"), value: "automatedReminders" },
      { label: t("filterOpen"), value: "open" },
      { label: t("filterPending"), value: "pending" },
      { label: t("filterClosed"), value: "closed" },
    ],
    [t],
  );
  const ASSIGNMENT_OPTIONS: { label: string; value: InboxAssignmentFilter }[] = useMemo(
    () => [
      { label: t("assignmentAll"), value: "all" },
      { label: t("assignmentMine"), value: "mine" },
      { label: t("assignmentUnassigned"), value: "unassigned" },
    ],
    [t],
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === typeFilter);
  const activeAssignmentFilter = ASSIGNMENT_OPTIONS.find((o) => o.value === assignmentFilter);
  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;
  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const tag of tags) m.set(tag.id, tag);
    return m;
  }, [tags]);

  return (
    <div className="space-y-1.5 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
            {activeFilter?.label ?? t("filterAll")}
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-border bg-popover">
            {FILTER_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => onTypeFilterChange(opt.value)}
                className={cn(
                  "text-sm",
                  typeFilter === opt.value ? "text-primary" : "text-popover-foreground",
                )}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assignment scope: Todas/Minhas/Fila + bulk actions
            (Liberar meus leads / Redistribuir fila). */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center justify-center h-6 gap-1 px-2 text-xs rounded-md hover:bg-muted",
              assignmentFilter !== "all" ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <InboxIcon className="h-3 w-3" />
            {activeAssignmentFilter?.label ?? t("assignmentAll")}
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-border bg-popover">
            {ASSIGNMENT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => onAssignmentFilterChange(opt.value)}
                className={cn(
                  "text-sm",
                  assignmentFilter === opt.value ? "text-primary" : "text-popover-foreground",
                )}
              >
                <span className="flex-1">{opt.label}</span>
                {opt.value === "unassigned" && (
                  <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {unassignedCount}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              disabled={!canSendMessages || releasingLeads}
              onClick={onReleaseMyLeads}
              className="text-sm text-popover-foreground"
            >
              {t("releaseMyLeads")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canManageMembers || redistributing}
              onClick={onRedistributeQueue}
              title={!canManageMembers ? t("redistributeQueueAdminOnly") : undefined}
              className="text-sm text-popover-foreground"
            >
              <Shuffle className="h-3 w-3" />
              {t("redistributeQueue")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {tags.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-6 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                selectedTagIds.length > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("tags")}
              {selectedTagIds.length > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {selectedTagIds.length}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 w-56 border-border bg-popover">
              {tags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag.id}
                  checked={selectedTagIds.includes(tag.id)}
                  onCheckedChange={() => onToggleTag(tag.id)}
                  className="text-sm text-popover-foreground"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {companies.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex max-w-40 items-center justify-center h-6 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                selectedCompany ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="truncate">{selectedCompany ?? t("company")}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 w-56 border-border bg-popover">
              <DropdownMenuItem
                onClick={() => onSelectCompany(null)}
                className={cn("text-sm", selectedCompany === null ? "text-primary" : "text-popover-foreground")}
              >
                {t("allCompanies")}
              </DropdownMenuItem>
              {companies.map((co) => (
                <DropdownMenuItem
                  key={co}
                  onClick={() => onSelectCompany(co)}
                  className={cn("text-sm", selectedCompany === co ? "text-primary" : "text-popover-foreground")}
                >
                  <span className="truncate">{co}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {hasContactFilters && (
        <div className="flex flex-wrap items-center gap-1">
          {selectedTagIds.map((id) => {
            const tag = tagsById.get(id);
            return (
              <button
                key={id}
                onClick={() => onToggleTag(id)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                />
                <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
          {selectedCompany && (
            <button
              onClick={() => onSelectCompany(null)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
            >
              <span className="max-w-24 truncate">{selectedCompany}</span>
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onClearContactFilters}
            className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("clearAll")}
          </button>
        </div>
      )}
    </div>
  );
}
