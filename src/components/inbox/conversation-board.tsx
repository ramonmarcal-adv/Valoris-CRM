"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Conversation, Profile, BoardColumnSortMode } from "@/types";
import { ConversationCard } from "./conversation-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GripVertical, ArrowUp, ArrowDown, ChevronDown } from "lucide-react";

export interface ConversationBoardColumn {
  id: string;
  title: string;
  color?: string;
  sortBy: BoardColumnSortMode;
  sortDirection: "asc" | "desc";
}

const SORT_MODES: BoardColumnSortMode[] = [
  "last_message_at",
  "last_outbound_message_at",
  "last_inbound_message_at",
  "next_reminder_any",
  "next_reminder_manual",
  "next_reminder_automated",
  "manual",
];

interface ConversationBoardProps {
  columns: ConversationBoardColumn[];
  /** Pre-bucketed AND pre-sorted (per column's sort_by/sort_direction)
   *  conversations, one entry per column id. The board is agnostic of
   *  *why* a conversation lands in a column — the caller decides. */
  conversationsByColumn: Map<string, Conversation[]>;
  onSelect: (conversation: Conversation) => void;
  onMove: (conversationId: string, fromColumnId: string, toColumnId: string) => void;
  /** Same-column drag reorder — `newPosition` is the fractional
   *  kanban_position already computed from the drop's new neighbors.
   *  Only reachable when the column's sortBy is "manual". */
  onReorder: (conversationId: string, newPosition: number) => void;
  /** Column header drag-to-reorder. */
  onColumnReorder: (orderedColumnIds: string[]) => void;
  onColumnSortChange: (
    columnId: string,
    sortBy: BoardColumnSortMode,
    sortDirection: "asc" | "desc",
  ) => void;
  emptyColumnHint: string;
  /** Account members for each card's right-click "Atribuir agente" submenu. */
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  /** Bulk-select mode — omit both to hide checkboxes entirely. */
  selectedIds?: Set<string>;
  onToggleSelect?: (conversationId: string) => void;
}

/** Fractional position for an item inserted at `index` in `orderedIds`
 *  (the column's new order, moved item already included) — the
 *  midpoint of its new neighbors, or ±1000 past whichever end it lands
 *  at. Trello-style gap positioning: only the ONE moved row needs a
 *  write, never a renumber of the whole column. */
function computeReorderPosition(
  orderedList: Conversation[],
  index: number,
): number {
  const before = orderedList[index - 1]?.kanban_position ?? null;
  const after = orderedList[index + 1]?.kanban_position ?? null;
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + 1000;
  if (after != null) return after - 1000;
  return 1000;
}

export function ConversationBoard({
  columns,
  conversationsByColumn,
  onSelect,
  onMove,
  onReorder,
  onColumnReorder,
  onColumnSortChange,
  emptyColumnHint,
  profiles,
  onConversationChanged,
  selectedIds,
  onToggleSelect,
}: ConversationBoardProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Origin-column lookup for drag-end no-op detection — built from the
  // same pre-bucketed map the columns render from, so the board never
  // needs to know the bucketing rule itself.
  const columnIdByConversationId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [columnId, list] of conversationsByColumn) {
      for (const conv of list) map.set(conv.id, columnId);
    }
    return map;
  }, [conversationsByColumn]);

  const allConversations = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const list of conversationsByColumn.values()) {
      for (const conv of list) map.set(conv.id, conv);
    }
    return map;
  }, [conversationsByColumn]);

  const columnsById = useMemo(() => {
    const map = new Map<string, ConversationBoardColumn>();
    for (const col of columns) map.set(col.id, col);
    return map;
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeConversation = activeConversationId
    ? allConversations.get(activeConversationId) ?? null
    : null;

  // A single DndContext handles both column-reorder and card-move/
  // reorder drags, discriminated by `active.data.current?.type` — two
  // independent nested DndContexts would create ambiguous pointer-
  // capture/collision-detection ownership, which dnd-kit isn't built
  // to layer that way.
  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === "column") return;
    setActiveConversationId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const kind = event.active.data.current?.type;
    setActiveConversationId(null);
    const { active, over } = event;
    if (!over) return;

    if (kind === "column") {
      if (active.id === over.id) return;
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      onColumnReorder(arrayMove(columns, oldIndex, newIndex).map((c) => c.id));
      return;
    }

    const conversationId = String(active.id);
    const overId = String(over.id);
    if (conversationId === overId) return;

    const fromColumnId = columnIdByConversationId.get(conversationId);
    if (!fromColumnId) return;

    // `over.id` is either a column itself (dropped on empty space) or
    // another card (dropped on/near it) — resolve which column either
    // way.
    const overIsColumn = columns.some((c) => c.id === overId);
    const toColumnId = overIsColumn ? overId : columnIdByConversationId.get(overId);
    if (!toColumnId) return;

    if (toColumnId !== fromColumnId) {
      onMove(conversationId, fromColumnId, toColumnId);
      return;
    }

    // Same-column reorder — only meaningful when dropped on another
    // card (dropping on the column's own empty background is a no-op,
    // nothing to reorder against), and only when that column's sort
    // mode is "manual" (cards in a computed-sort column aren't
    // individually draggable — see the `disabled` prop below — so
    // `overId` resolving to a card there shouldn't normally happen,
    // this is a defensive no-op).
    if (overIsColumn) return;
    if (columnsById.get(fromColumnId)?.sortBy !== "manual") return;
    const current = conversationsByColumn.get(fromColumnId) ?? [];
    const oldIndex = current.findIndex((c) => c.id === conversationId);
    const overIndex = current.findIndex((c) => c.id === overId);
    if (oldIndex < 0 || overIndex < 0 || oldIndex === overIndex) return;

    const reordered = arrayMove(current, oldIndex, overIndex);
    const newIndex = reordered.findIndex((c) => c.id === conversationId);
    const newPosition = computeReorderPosition(reordered, newIndex);
    onReorder(conversationId, newPosition);
  }

  function handleDragCancel() {
    setActiveConversationId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
        <div className="board-scroll flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
          {columns.map((column) => (
            <SortableBoardColumn
              key={column.id}
              column={column}
              conversations={conversationsByColumn.get(column.id) ?? []}
              onSelect={onSelect}
              onColumnSortChange={onColumnSortChange}
              emptyColumnHint={emptyColumnHint}
              profiles={profiles}
              onConversationChanged={onConversationChanged}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay
        dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
      >
        {activeConversation ? (
          <div className="w-[85vw] max-w-[320px] opacity-90 lg:w-72">
            <ConversationCard
              conversation={activeConversation}
              onSelect={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .board-scroll {
          scroll-behavior: smooth;
        }
        @media (hover: none), (pointer: coarse) {
          .board-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .board-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .board-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .board-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .board-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .board-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .board-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function ColumnSortDropdown({
  column,
  onColumnSortChange,
}: {
  column: ConversationBoardColumn;
  onColumnSortChange: (
    columnId: string,
    sortBy: BoardColumnSortMode,
    sortDirection: "asc" | "desc",
  ) => void;
}) {
  const tBoard = useTranslations("Inbox.board");
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
          {tBoard(`sortMode.${column.sortBy}`)}
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-border bg-popover">
          {SORT_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onClick={() => onColumnSortChange(column.id, mode, column.sortDirection)}
              className={cn(
                "text-sm",
                column.sortBy === mode ? "text-primary" : "text-popover-foreground",
              )}
            >
              {tBoard(`sortMode.${mode}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {column.sortBy !== "manual" && (
        <button
          type="button"
          onClick={() =>
            onColumnSortChange(column.id, column.sortBy, column.sortDirection === "asc" ? "desc" : "asc")
          }
          title={
            column.sortDirection === "asc"
              ? tBoard("sortDirection.asc")
              : tBoard("sortDirection.desc")
          }
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {column.sortDirection === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

function SortableBoardColumn({
  column,
  conversations,
  onSelect,
  onColumnSortChange,
  emptyColumnHint,
  profiles,
  onConversationChanged,
  selectedIds,
  onToggleSelect,
}: {
  column: ConversationBoardColumn;
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  onColumnSortChange: (
    columnId: string,
    sortBy: BoardColumnSortMode,
    sortDirection: "asc" | "desc",
  ) => void;
  emptyColumnHint: string;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (conversationId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: column.id, data: { type: "column" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none"
    >
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: column.color ?? "#94a3b8" }}
      />
      <div className="flex items-center justify-between gap-1 pt-3">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {column.title}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {conversations.length}
        </span>
      </div>

      <div className="pt-1.5">
        <ColumnSortDropdown column={column} onColumnSortChange={onColumnSortChange} />
      </div>

      <ColumnDropZone
        conversations={conversations}
        emptyColumnHint={emptyColumnHint}
        isOver={isOver}
      >
        {conversations.map((conv) => (
          <DraggableConversationCard
            key={conv.id}
            conversation={conv}
            onSelect={onSelect}
            profiles={profiles}
            onConversationChanged={onConversationChanged}
            selected={selectedIds?.has(conv.id)}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(conv.id) : undefined}
            draggable={column.sortBy === "manual"}
          />
        ))}
      </ColumnDropZone>
    </div>
  );
}

/**
 * Wraps the card list in its own droppable via `useSortable` on a
 * synthetic id would collide with card ids, so this keeps the original
 * `useDroppable` for the *column's own* drop target — separate from
 * the column header's `useSortable` above, which handles column
 * reordering. Both coexist on the same column: the header is
 * draggable (column reorder), this inner area is droppable (card
 * drops), same pattern dnd-kit's own multi-container examples use.
 */
function ColumnDropZone({
  conversations,
  emptyColumnHint,
  isOver,
  children,
}: {
  conversations: Conversation[];
  emptyColumnHint: string;
  isOver: boolean;
  children: React.ReactNode;
}) {
  return (
    <SortableContext
      items={conversations.map((c) => c.id)}
      strategy={verticalListSortingStrategy}
    >
      <div
        className={cn(
          "mt-2 flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all",
          isOver && conversations.length === 0 && "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2",
        )}
      >
        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {emptyColumnHint}
          </div>
        ) : (
          children
        )}
      </div>
    </SortableContext>
  );
}

function DraggableConversationCard({
  conversation,
  onSelect,
  profiles,
  onConversationChanged,
  selected,
  onToggleSelect,
  draggable,
}: {
  conversation: Conversation;
  onSelect: (conversation: Conversation) => void;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** False when the column's sort mode isn't "manual" — the order is
   *  computed, not stored, so picking the card up to reorder it would
   *  have no effect. Still a valid cross-column drop target either way
   *  (droppable stays enabled). */
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: conversation.id,
    data: { type: "card" },
    disabled: { draggable: !draggable, droppable: false },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    touchAction: "none" as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <ConversationCard
        conversation={conversation}
        onSelect={onSelect}
        profiles={profiles}
        onConversationChanged={onConversationChanged}
        selected={selected}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}
