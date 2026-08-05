import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client wrapper for the `apply_checklist_template` RPC (migration
 * 079) — clones a template's items onto a new checklist attached to
 * either a card or a task (exactly one). Returns the new checklist's
 * id, or an error message on failure.
 */
export async function applyChecklistTemplate(
  supabase: SupabaseClient,
  args: { templateId: string; cardId?: string; taskId?: string },
): Promise<{ checklistId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("apply_checklist_template", {
    p_template_id: args.templateId,
    p_card_id: args.cardId ?? null,
    p_task_id: args.taskId ?? null,
  });
  if (error) {
    console.error("[checklist-templates] apply_checklist_template failed:", error);
    return { checklistId: null, error: error.message };
  }
  return { checklistId: data as string, error: null };
}
