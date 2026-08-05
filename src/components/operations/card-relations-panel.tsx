"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { OperationCard, OperationCardRelation } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface CardRelationsPanelProps {
  cardId: string;
  boardId: string;
}

export function CardRelationsPanel({ cardId, boardId }: CardRelationsPanelProps) {
  const t = useTranslations("Operations.cardDetail.relations");
  const supabase = createClient();

  const [relations, setRelations] = useState<OperationCardRelation[]>([]);
  const [cardsById, setCardsById] = useState<Map<string, OperationCard>>(new Map());
  const [otherCards, setOtherCards] = useState<OperationCard[]>([]);
  const [targetCardId, setTargetCardId] = useState("");
  const [relationType, setRelationType] = useState("related");

  const load = useCallback(async () => {
    const [{ data: outgoing }, { data: incoming }, { data: boardCards }] = await Promise.all([
      supabase.from("operation_card_relations").select("*").eq("from_card_id", cardId),
      supabase.from("operation_card_relations").select("*").eq("to_card_id", cardId),
      supabase.from("operation_cards").select("*").eq("board_id", boardId).is("archived_at", null),
    ]);
    const all = [...(outgoing ?? []), ...(incoming ?? [])] as OperationCardRelation[];
    setRelations(all);
    const cards = (boardCards ?? []) as OperationCard[];
    setCardsById(new Map(cards.map((c) => [c.id, c])));
    setOtherCards(cards.filter((c) => c.id !== cardId));
  }, [supabase, cardId, boardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    if (!targetCardId || !relationType.trim()) return;
    const { error } = await supabase.from("operation_card_relations").insert({
      from_card_id: cardId,
      to_card_id: targetCardId,
      relation_type: relationType.trim(),
    });
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    setTargetCardId("");
    load();
  }

  async function handleRemove(relation: OperationCardRelation) {
    const { error } = await supabase.from("operation_card_relations").delete().eq("id", relation.id);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    load();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {relations.length === 0 && <p className="text-xs text-muted-foreground">{t("noRelations")}</p>}
        {relations.map((relation) => {
          const outgoing = relation.from_card_id === cardId;
          const other = cardsById.get(outgoing ? relation.to_card_id : relation.from_card_id);
          return (
            <div key={relation.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <span className="shrink-0 text-muted-foreground">{relation.relation_type}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                {other ? (
                  <Link href={`/operations/cards/${other.id}`} className="truncate hover:underline">
                    {other.title}
                  </Link>
                ) : (
                  <span className="truncate text-muted-foreground">{t("unknownCard")}</span>
                )}
              </span>
              <button type="button" onClick={() => handleRemove(relation)} className="shrink-0 text-muted-foreground hover:text-red-400">
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          value={relationType}
          onChange={(e) => setRelationType(e.target.value)}
          placeholder={t("relationTypePlaceholder")}
          className="h-8 w-28 shrink-0 border-border bg-muted text-xs"
        />
        <Select value={targetCardId} onValueChange={(v) => setTargetCardId(v ?? "")}>
          <SelectTrigger className="h-8 flex-1 bg-muted text-xs">
            <SelectValue placeholder={t("selectCard")} />
          </SelectTrigger>
          <SelectContent>
            {otherCards.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleAdd} disabled={!targetCardId} className="h-8 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
