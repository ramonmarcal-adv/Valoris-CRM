import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client wrapper for the `apply_task_template` RPC (migration 072) —
 * clones a template's task (+ subtasks + its internal checklist)
 * onto a card. Returns the new top-level task's id, or an error
 * message on failure (duplicate application, cross-board mismatch,
 * template/card not found).
 */
export async function applyTaskTemplate(
  supabase: SupabaseClient,
  args: { templateId: string; cardId: string; preventDuplicate?: boolean },
): Promise<{ taskId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("apply_task_template", {
    p_template_id: args.templateId,
    p_card_id: args.cardId,
    p_prevent_duplicate: args.preventDuplicate ?? true,
  });
  if (error) {
    console.error("[task-templates] apply_task_template failed:", error);
    return { taskId: null, error: error.message };
  }
  return { taskId: data as string, error: null };
}
