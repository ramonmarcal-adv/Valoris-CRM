import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persists a deal's stage change. Shared by the Pipelines board and the
 * Inbox conversation Kanban (grouped by pipeline stage) so dragging a deal
 * card in either place goes through the exact same write — callers own
 * their own optimistic UI update and error handling around this call.
 */
export async function moveDealToStage(
  supabase: SupabaseClient,
  dealId: string,
  newStageId: string,
) {
  return supabase.from("deals").update({ stage_id: newStageId }).eq("id", dealId);
}
