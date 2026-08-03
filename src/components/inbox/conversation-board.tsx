"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Conversation, Profile } from "@/types";
import { ConversationCard } from "./conversation-card";

export interface ConversationBoardColumn {
  id: string;
  title: string;
  color?: string;
}

interface ConversationBoardProps {
  columns: ConversationBoardColumn[];
  /** Pre-bucketed AND pre-sorted (by kanban_position) conversations, one
   *  entry per column id. The board is agnostic of *why* a conversation
   *  lands in a column — the caller decides. */
  conversationsByColumn: Map<string, Conversation[]>;
  onSelect: (conversation: Conversation) => void;
  onMove: (conversationId: string, fromColumnId: string, toColumnId: string) => void;
  /** Same-column drag reorder — `newPosition` is the fractional
   *  kanban_position already computed from the drop's new neighbors. */
  onReorder: (conversationId: string, newPosition: number) => void;
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeConversation = activeConversationId
    ? allConversations.get(activeConversationId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveConversationId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveConversationId(null);
    const { active, over } = event;
    if (!over) return;
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
    // nothing to reorder against).
    if (overIsColumn) return;
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
      <div className="board-scroll flex h-full snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            conversations={conversationsByColumn.get(column.id) ?? []}
            onSelect={onSelect}
            emptyColumnHint={emptyColumnHint}
            profiles={profiles}
            onConversationChanged={onConversationChanged}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>

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

function BoardColumn({
  column,
  conversations,
  onSelect,
  emptyColumnHint,
  profiles,
  onConversationChanged,
  selectedIds,
  onToggleSelect,
}: {
  column: ConversationBoardColumn;
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  emptyColumnHint: string;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (conversationId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: column.color ?? "#94a3b8" }}
      />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {column.title}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {conversations.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {conversations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {emptyColumnHint}
          </div>
        ) : (
          <SortableContext
            items={conversations.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
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
              />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}

function DraggableConversationCard({
  conversation,
  onSelect,
  profiles,
  onConversationChanged,
  selected,
  onToggleSelect,
}: {
  conversation: Conversation;
  onSelect: (conversation: Conversation) => void;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: conversation.id,
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
