"use client";

import type { OperationCard, Profile } from "@/types";
import { PriorityBadge } from "./priority-badge";

interface CardTileProps {
  card: OperationCard;
  assignee?: Profile | null;
  onOpen: (card: OperationCard) => void;
  isOverlay?: boolean;
}

function initials(name?: string | null) {
  const source = (name ?? "?").trim();
  return source ? source.charAt(0).toUpperCase() : "?";
}

export function CardTile({ card, assignee, onOpen, isOverlay }: CardTileProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // The DnD PointerSensor requires 5px movement before it counts
        // as a drag, so a plain tap still reaches onClick.
        if (isOverlay) return;
        e.stopPropagation();
        onOpen(card);
      }}
      className={`group w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 px-3 py-3 text-left shadow-sm transition-all ${
        isOverlay ? "shadow-xl" : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 break-words text-sm font-semibold leading-snug text-foreground">
          {card.title}
        </h4>
        {assignee && (
          <span
            title={assignee.full_name ?? undefined}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assignee.full_name)}
          </span>
        )}
      </div>
      <div className="mt-2">
        <PriorityBadge priority={card.priority} />
      </div>
    </button>
  );
}
