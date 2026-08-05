import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persists a card's stage and/or position change. Mirrors
 * src/lib/deals/move-deal.ts's shape (a thin write, caller owns
 * optimistic UI + error handling) — kept as two separate concerns
 * (stage vs. position) since a cross-stage drop always sets both,
 * while a same-stage reorder only touches position.
 */
export async function moveCardToStage(
  supabase: SupabaseClient,
  cardId: string,
  newStageId: string,
  newPosition: number,
) {
  return supabase
    .from("operation_cards")
    .update({ stage_id: newStageId, position: newPosition })
    .eq("id", cardId);
}

export async function reorderCardWithinStage(
  supabase: SupabaseClient,
  cardId: string,
  newPosition: number,
) {
  return supabase.from("operation_cards").update({ position: newPosition }).eq("id", cardId);
}
