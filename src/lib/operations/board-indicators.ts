import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationBoardIndicatorAggType, OperationCardFieldType } from "@/types";

export const INDICATOR_AGG_TYPES: OperationBoardIndicatorAggType[] = ["count", "sum", "avg", "min", "max", "percentage"];

/**
 * Client-side mirror of the `validate_board_indicator()` DB trigger's
 * type check — disables ineligible fields in the UI before the user
 * even tries to save, rather than surfacing a raw DB error.
 */
export function isFieldEligibleForAgg(fieldType: OperationCardFieldType, aggType: OperationBoardIndicatorAggType): boolean {
  if (aggType === "count" || aggType === "percentage") return true;
  return fieldType === "number" || fieldType === "currency";
}

export function indicatorRequiresField(aggType: OperationBoardIndicatorAggType): boolean {
  return aggType === "sum" || aggType === "avg" || aggType === "min" || aggType === "max";
}

export function indicatorRequiresStageFilter(aggType: OperationBoardIndicatorAggType): boolean {
  return aggType === "percentage";
}

/** Client wrapper for the `compute_board_indicator` RPC (072). */
export async function computeBoardIndicator(supabase: SupabaseClient, indicatorId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("compute_board_indicator", { p_indicator_id: indicatorId });
  if (error) {
    console.error("[board-indicators] compute_board_indicator failed:", error);
    return null;
  }
  return data as number | null;
}
