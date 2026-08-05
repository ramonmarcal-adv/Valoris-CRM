"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useCan } from "@/hooks/use-can";
import { moveCardToStage, reorderCardWithinStage } from "@/lib/operations/move-card";
import { resolveInitialStageId } from "@/lib/operations/board-stages";
import { BoardKanban } from "@/components/operations/board-kanban";
import { BoardStageSettings } from "@/components/operations/board-stage-settings";
import { BoardFieldDefsSettings } from "@/components/operations/board-field-defs-settings";
import { CardForm } from "@/components/operations/card-form";
import { GatedButton } from "@/components/ui/gated-button";
import type {
  OperationBoard,
  OperationBoardStage,
  OperationCard,
  OperationCardFieldDef,
  Profile,
} from "@/types";
import { ArrowLeft, ListFilter, Plus, Settings, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function OperationBoardPage() {
  const t = useTranslations("Operations.boardPage");
  const params = useParams<{ boardId: string }>();
  const router = useRouter();
  const supabase = createClient();
  const canManage = useCan("send-messages");

  const [board, setBoard] = useState<OperationBoard | null>(null);
  const [stages, setStages] = useState<OperationBoardStage[]>([]);
  const [cards, setCards] = useState<OperationCard[]>([]);
  const [fieldDefs, setFieldDefs] = useState<OperationCardFieldDef[]>([]);
  const [profilesByUserId, setProfilesByUserId] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  const [stageSettingsOpen, setStageSettingsOpen] = useState(false);
  const [fieldDefsOpen, setFieldDefsOpen] = useState(false);
  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [cardFormDefaultStageId, setCardFormDefaultStageId] = useState<string>("");

  const load = useCallback(async () => {
    const [{ data: b }, { data: s }, { data: c }, { data: fd }, { data: profiles }] = await Promise.all([
      supabase.from("operation_boards").select("*").eq("id", params.boardId).maybeSingle(),
      supabase.from("operation_board_stages").select("*").eq("board_id", params.boardId).is("archived_at", null).order("position"),
      supabase.from("operation_cards").select("*").eq("board_id", params.boardId).is("archived_at", null),
      supabase.from("operation_card_field_defs").select("*").eq("board_id", params.boardId).is("archived_at", null).order("position"),
      supabase.from("profiles").select("*"),
    ]);
    setBoard(b as OperationBoard | null);
    setStages((s ?? []) as OperationBoardStage[]);
    setCards((c ?? []) as OperationCard[]);
    setFieldDefs((fd ?? []) as OperationCardFieldDef[]);
    setProfilesByUserId(new Map(((profiles ?? []) as Profile[]).map((p) => [p.user_id, p])));
    setLoading(false);
  }, [supabase, params.boardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCardMoved(cardId: string, newStageId: string, newPosition: number) {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, stage_id: newStageId, position: newPosition } : c)));
    const card = cards.find((c) => c.id === cardId);
    const { error } =
      card && card.stage_id === newStageId
        ? await reorderCardWithinStage(supabase, cardId, newPosition)
        : await moveCardToStage(supabase, cardId, newStageId, newPosition);
    if (error) {
      toast.error(t("toastFailedMoveCard"));
      load();
    }
  }

  async function handleAddCard(stageId?: string) {
    const resolved = stageId ?? (await resolveInitialStageId(supabase, params.boardId)) ?? stages[0]?.id ?? "";
    setCardFormDefaultStageId(resolved);
    setCardFormOpen(true);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
        <p className="text-sm text-muted-foreground">{t("boardNotFound")}</p>
        <Link href="/operations" className="mt-3 text-sm text-primary hover:underline">
          {t("backToOperations")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/operations")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("backToOperations")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: board.color }} />
          <h1 className="text-xl font-semibold text-foreground">{board.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setStageSettingsOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <ListFilter className="mr-1 h-4 w-4" />
            {t("manageStages")}
          </GatedButton>
          <GatedButton
            variant="outline"
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setFieldDefsOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            {t("manageFields")}
          </GatedButton>
          <GatedButton
            canAct={canManage}
            gateReason="createBoards"
            disabled={stages.length === 0}
            onClick={() => handleAddCard()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addCard", { label: board.card_label_singular })}
          </GatedButton>
        </div>
      </div>

      {stages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <Settings className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{t("noStagesYet")}</h3>
          <GatedButton
            canAct={canManage}
            gateReason="createBoards"
            onClick={() => setStageSettingsOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("manageStages")}
          </GatedButton>
        </div>
      ) : (
        <BoardKanban
          stages={stages}
          cards={cards}
          profilesById={profilesByUserId}
          onOpenCard={(card) => router.push(`/operations/cards/${card.id}`)}
          onAddCard={handleAddCard}
          onCardMoved={handleCardMoved}
        />
      )}

      <BoardStageSettings
        open={stageSettingsOpen}
        onOpenChange={setStageSettingsOpen}
        boardId={board.id}
        stages={stages}
        onStagesChanged={load}
      />
      <BoardFieldDefsSettings
        open={fieldDefsOpen}
        onOpenChange={setFieldDefsOpen}
        boardId={board.id}
        stages={stages}
        fieldDefs={fieldDefs}
        onFieldDefsChanged={load}
      />
      <CardForm
        open={cardFormOpen}
        onOpenChange={setCardFormOpen}
        boardId={board.id}
        stages={stages}
        defaultStageId={cardFormDefaultStageId}
        onSaved={(cardId) => router.push(`/operations/cards/${cardId}`)}
      />
    </div>
  );
}
