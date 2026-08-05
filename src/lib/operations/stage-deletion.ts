import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client wrapper for the `reassign_and_delete_board_stage` RPC
 * (migration 061) — moves every card out of `oldStageId` into
 * `targetStageId` and deletes the now-empty stage, all inside one
 * transaction on the DB side. Callers must have the user pick
 * `targetStageId` first (PRD 7.2's mandatory reallocation) rather
 * than calling this with an unconfirmed target.
 */
export async function deleteStageWithReallocation(
  db: SupabaseClient,
  oldStageId: string,
  targetStageId: string,
): Promise<{ error: string | null }> {
  const { error } = await db.rpc("reassign_and_delete_board_stage", {
    p_old_stage_id: oldStageId,
    p_target_stage_id: targetStageId,
  });
  if (error) {
    console.error("[stage-deletion] reassign_and_delete_board_stage failed:", error);
    return { error: error.message };
  }
  return { error: null };
}

/** Archiving never requires reallocation — cards stay put, the stage just leaves the active board. */
export async function archiveStage(db: SupabaseClient, stageId: string) {
  return db
    .from("operation_board_stages")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", stageId);
}
