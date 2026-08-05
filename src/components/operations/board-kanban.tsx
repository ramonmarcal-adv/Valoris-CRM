"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { computeReorderPosition } from "@/lib/kanban/reorder";
import type { OperationBoardStage, OperationCard, Profile } from "@/types";
import { CardTile } from "./card-tile";

interface BoardKanbanProps {
  stages: OperationBoardStage[];
  cards: OperationCard[];
  profilesById: Map<string, Profile>;
  onOpenCard: (card: OperationCard) => void;
  onAddCard: (stageId: string) => void;
  /** Cross-stage drop or same-stage reorder — newPosition is the fractional position already computed. */
  onCardMoved: (cardId: string, newStageId: string, newPosition: number) => void;
}

export function BoardKanban({ stages, cards, profilesById, onOpenCard, onAddCard, onCardMoved }: BoardKanbanProps) {
  const t = useTranslations("Operations.board");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  const cardsByStage = useMemo(() => {
    const map = new Map<string, OperationCard[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const card of cards) {
      const bucket = map.get(card.stage_id);
      if (bucket) bucket.push(card);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position);
    return map;
  }, [sortedStages, cards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeCard = activeCardId ? cards.find((c) => c.id === activeCardId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveCardId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const overId = String(over.id);
    if (cardId === overId) return;

    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const overIsStage = sortedStages.some((s) => s.id === overId);
    const toStageId = overIsStage ? overId : cards.find((c) => c.id === overId)?.stage_id;
    if (!toStageId) return;

    if (toStageId !== card.stage_id) {
      const target = cardsByStage.get(toStageId) ?? [];
      const newPosition = computeReorderPosition(
        target.map((c) => c.position),
        target.length,
      );
      onCardMoved(cardId, toStageId, newPosition);
      return;
    }

    if (overIsStage) return; // dropped on the stage's own empty background — no-op
    const current = cardsByStage.get(card.stage_id) ?? [];
    const oldIndex = current.findIndex((c) => c.id === cardId);
    const overIndex = current.findIndex((c) => c.id === overId);
    if (oldIndex < 0 || overIndex < 0 || oldIndex === overIndex) return;

    const reordered = arrayMove(current, oldIndex, overIndex);
    const newIndex = reordered.findIndex((c) => c.id === cardId);
    const newPosition = computeReorderPosition(
      reordered.map((c) => c.position),
      newIndex,
    );
    onCardMoved(cardId, card.stage_id, newPosition);
  }

  function handleDragCancel() {
    setActiveCardId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="board-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {sortedStages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            cards={cardsByStage.get(stage.id) ?? []}
            profilesById={profilesById}
            onOpenCard={onOpenCard}
            onAddCard={onAddCard}
            emptyHint={t("dropCardHere")}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeCard ? (
          <div className="w-72 opacity-90">
            <CardTile card={activeCard} onOpen={() => {}} isOverlay />
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

function StageColumn({
  stage,
  cards,
  profilesById,
  onOpenCard,
  onAddCard,
  emptyHint,
}: {
  stage: OperationBoardStage;
  cards: OperationCard[];
  profilesById: Map<string, Profile>;
  onOpenCard: (card: OperationCard) => void;
  onAddCard: (stageId: string) => void;
  emptyHint: string;
}) {
  const t = useTranslations("Operations.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: stage.color }} />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">{stage.name}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {cards.length}
        </span>
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`mt-3 flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all ${
            isOver && cards.length === 0
              ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
              : ""
          }`}
        >
          {cards.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
              {emptyHint}
            </div>
          ) : (
            cards.map((card) => (
              <DraggableCardTile
                key={card.id}
                card={card}
                assignee={card.assigned_to_user_id ? profilesById.get(card.assigned_to_user_id) : null}
                onOpen={onOpenCard}
              />
            ))
          )}
        </div>
      </SortableContext>

      <button
        type="button"
        onClick={() => onAddCard(stage.id)}
        className="mt-3 flex w-full items-center justify-start rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
      >
        + {t("addCard")}
      </button>
    </div>
  );
}

function DraggableCardTile({
  card,
  assignee,
  onOpen,
}: {
  card: OperationCard;
  assignee?: Profile | null;
  onOpen: (card: OperationCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    touchAction: "none" as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <CardTile card={card} assignee={assignee} onOpen={onOpen} />
    </div>
  );
}
