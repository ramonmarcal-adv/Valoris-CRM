import type { SupabaseClient } from "@supabase/supabase-js";

/** Persists a task's checkbox/status change. Thin write — caller owns optimistic UI + error handling. */
export async function setTaskStatus(
  supabase: SupabaseClient,
  taskId: string,
  status: "todo" | "in_progress" | "done" | "cancelled",
  completedByUserId?: string | null,
) {
  const patch: Record<string, unknown> = { status };
  if (status === "done") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by_user_id = completedByUserId ?? null;
  } else {
    patch.completed_at = null;
    patch.completed_by_user_id = null;
  }
  return supabase.from("operation_tasks").update(patch).eq("id", taskId);
}

/** Reorders a task within its (card_id, parent_task_id) partition — mirrors move-card.ts. */
export async function reorderTask(supabase: SupabaseClient, taskId: string, newPosition: number) {
  return supabase.from("operation_tasks").update({ position: newPosition }).eq("id", taskId);
}

/** Reparents a task under a different parent (or promotes it to top-level with parent=null). */
export async function reparentTask(supabase: SupabaseClient, taskId: string, newParentId: string | null, newPosition: number) {
  return supabase.from("operation_tasks").update({ parent_task_id: newParentId, position: newPosition }).eq("id", taskId);
}
