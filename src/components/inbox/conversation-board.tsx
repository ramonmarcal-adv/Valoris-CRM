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
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Conversation, Profile } from "@/types";
import { ConversationCard } from "./conversation-card";

export interface ConversationBoardColumn {
  id: string;
  title: string;
  color?: string;
}

interface ConversationBoardProps {
  columns: ConversationBoardColumn[];
  /** Pre-bucketed conversations, one entry per column id. The board is
   *  agnostic of *why* a conversation lands in a column — the caller
   *  decides (status value, or resolved pipeline stage). */
  conversationsByColumn: Map<string, Conversation[]>;
  onSelect: (conversation: Conversation) => void;
  onMove: (conversationId: string, fromColumnId: string, toColumnId: string) => void;
  /** Returns a hint string when a card can't be dragged in the current
   *  grouping mode (e.g. no linked deal while grouped by pipeline stage);
   *  undefined means the card is draggable. */
  getDisabledHint?: (conversation: Conversation) => string | undefined;
  emptyColumnHint: string;
  /** Account members for each card's right-click "Atribuir agente" submenu. */
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
}

export function ConversationBoard({
  columns,
  conversationsByColumn,
  onSelect,
  onMove,
  getDisabledHint,
  emptyColumnHint,
  profiles,
  onConversationChanged,
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
    const targetColumnId = String(over.id);

    const fromColumnId = columnIdByConversationId.get(conversationId);
    if (!fromColumnId || fromColumnId === targetColumnId) return;
    if (!columns.some((c) => c.id === targetColumnId)) return;

    onMove(conversationId, fromColumnId, targetColumnId);
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
            getDisabledHint={getDisabledHint}
            emptyColumnHint={emptyColumnHint}
            profiles={profiles}
            onConversationChanged={onConversationChanged}
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
  getDisabledHint,
  emptyColumnHint,
  profiles,
  onConversationChanged,
}: {
  column: ConversationBoardColumn;
  conversations: Conversation[];
  onSelect: (conversation: Conversation) => void;
  getDisabledHint?: (conversation: Conversation) => string | undefined;
  emptyColumnHint: string;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
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
          conversations.map((conv) => (
            <DraggableConversationCard
              key={conv.id}
              conversation={conv}
              onSelect={onSelect}
              disabledHint={getDisabledHint?.(conv)}
              profiles={profiles}
              onConversationChanged={onConversationChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableConversationCard({
  conversation,
  onSelect,
  disabledHint,
  profiles,
  onConversationChanged,
}: {
  conversation: Conversation;
  onSelect: (conversation: Conversation) => void;
  disabledHint?: string;
  profiles: Profile[];
  onConversationChanged: (conversationId: string, patch: Partial<Conversation>) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: conversation.id,
    disabled: !!disabledHint,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <ConversationCard
        conversation={conversation}
        onSelect={onSelect}
        disabledHint={disabledHint}
        profiles={profiles}
        onConversationChanged={onConversationChanged}
      />
    </div>
  );
}
