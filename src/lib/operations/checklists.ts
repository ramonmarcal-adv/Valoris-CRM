import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationChecklistItem } from "@/types";

/**
 * Checklist progress is never persisted (unlike a card's task
 * progress) — nothing aggregates it across many cards at once, so
 * it's always computed client-side from already-loaded items.
 * Returns null for an empty checklist (nothing to show a % for).
 */
export function computeChecklistProgress(items: OperationChecklistItem[]): number | null {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.is_done).length;
  return Math.round((done / items.length) * 100);
}

export async function toggleChecklistItem(supabase: SupabaseClient, itemId: string, isDone: boolean) {
  return supabase.from("operation_checklist_items").update({ is_done: isDone }).eq("id", itemId);
}

export async function reorderChecklistItem(supabase: SupabaseClient, itemId: string, newPosition: number) {
  return supabase.from("operation_checklist_items").update({ position: newPosition }).eq("id", itemId);
}
