import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationAutomationStepType } from "@/types";

/**
 * Stage shortcuts (PRD 16.8) — "on entering this stage: + apply
 * checklist / + apply template / + assign responsible / + change
 * priority". Not a special execution path: configuring a shortcut
 * upserts a REAL operation_automations row (trigger_type='entered_stage',
 * one step) that goes through the exact same dispatch pipeline as any
 * manually-built automation. created_via/shortcut_stage_id/
 * shortcut_action_type (migration 075) exist purely so this module can
 * find/update "the" automation behind a given shortcut on reconfigure
 * instead of creating a duplicate — enforced by a partial unique index
 * on (board_id, shortcut_stage_id, shortcut_action_type) WHERE
 * created_via='stage_shortcut'.
 */

export const STAGE_SHORTCUT_ACTION_TYPES: OperationAutomationStepType[] = [
  "apply_checklist_template",
  "apply_task_template",
  "assign_card",
  "change_priority",
];

export interface StageShortcutRow {
  automationId: string;
  actionType: OperationAutomationStepType;
  stepConfig: Record<string, unknown>;
}

export async function getStageShortcuts(
  supabase: SupabaseClient,
  boardId: string,
  stageId: string,
): Promise<StageShortcutRow[]> {
  const { data } = await supabase
    .from("operation_automations")
    .select("id, shortcut_action_type, operation_automation_steps(step_config)")
    .eq("board_id", boardId)
    .eq("shortcut_stage_id", stageId)
    .eq("created_via", "stage_shortcut");

  return ((data ?? []) as { id: string; shortcut_action_type: OperationAutomationStepType; operation_automation_steps: { step_config: Record<string, unknown> }[] }[]).map(
    (row) => ({
      automationId: row.id,
      actionType: row.shortcut_action_type,
      stepConfig: row.operation_automation_steps[0]?.step_config ?? {},
    }),
  );
}

export async function upsertStageShortcut(
  supabase: SupabaseClient,
  args: {
    accountId: string;
    boardId: string;
    stageId: string;
    stageName: string;
    actionType: OperationAutomationStepType;
    stepConfig: Record<string, unknown>;
  },
): Promise<{ error: string | null }> {
  const { data: automation, error } = await supabase
    .from("operation_automations")
    .upsert(
      {
        account_id: args.accountId,
        board_id: args.boardId,
        name: `${args.stageName} · ${args.actionType}`,
        trigger_type: "entered_stage",
        trigger_config: { stage_id: args.stageId },
        conditions: [],
        is_active: true,
        created_via: "stage_shortcut",
        shortcut_stage_id: args.stageId,
        shortcut_action_type: args.actionType,
      },
      { onConflict: "board_id,shortcut_stage_id,shortcut_action_type" },
    )
    .select("id")
    .single();

  if (error || !automation) return { error: error?.message ?? "failed to save shortcut" };

  await supabase.from("operation_automation_steps").delete().eq("automation_id", automation.id);
  const { error: stepError } = await supabase
    .from("operation_automation_steps")
    .insert({ automation_id: automation.id, step_type: args.actionType, step_config: args.stepConfig, position: 0 });

  return { error: stepError?.message ?? null };
}

export async function removeStageShortcut(
  supabase: SupabaseClient,
  boardId: string,
  stageId: string,
  actionType: OperationAutomationStepType,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("operation_automations")
    .delete()
    .eq("board_id", boardId)
    .eq("shortcut_stage_id", stageId)
    .eq("shortcut_action_type", actionType)
    .eq("created_via", "stage_shortcut");
  return { error: error?.message ?? null };
}
