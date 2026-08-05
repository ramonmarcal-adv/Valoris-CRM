import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationBoardStage } from "@/types";

/**
 * Resolves the stage a brand-new card should land in — the one
 * flagged is_initial (partial unique index guarantees at most one per
 * board, migration 060). Falls back to the first stage by position if
 * no stage is flagged yet (e.g. a board whose stages were all created
 * without ever marking one initial).
 */
export async function resolveInitialStageId(
  db: SupabaseClient,
  boardId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("operation_board_stages")
    .select("id")
    .eq("board_id", boardId)
    .eq("is_initial", true)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[board-stages] resolveInitialStageId failed:", error);
    return null;
  }
  if (data?.id) return data.id;

  const { data: fallback, error: fallbackError } = await db
    .from("operation_board_stages")
    .select("id")
    .eq("board_id", boardId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallbackError) {
    console.error("[board-stages] resolveInitialStageId fallback failed:", fallbackError);
    return null;
  }
  return fallback?.id ?? null;
}

/**
 * Full-renumber reorder for a board's stages — same convention as
 * pipeline_stages/conversation_board_columns: cheap because a board
 * has a handful of stages, not hundreds.
 */
export async function reorderStages(
  db: SupabaseClient,
  orderedStageIds: string[],
): Promise<{ error: string | null }> {
  const rows = orderedStageIds.map((id, index) => ({ id, position: index }));
  const { error } = await db.from("operation_board_stages").upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("[board-stages] reorderStages failed:", error);
    return { error: error.message };
  }
  return { error: null };
}

export function sortStages(stages: OperationBoardStage[]): OperationBoardStage[] {
  return [...stages].sort((a, b) => a.position - b.position);
}
