import { supabaseAdmin } from "@/lib/automations/admin-client";
import { evaluateConditions, type OperationAutomationConditionContext, type OperationAutomationFieldValue } from "./condition-eval";
import { mapActivityEventToTriggerCandidates } from "./event-trigger-map";
import type {
  OperationAutomation,
  OperationAutomationLogStepResult,
  OperationAutomationPendingExecution,
  OperationAutomationStep,
  OperationAutomationTriggerType,
  OperationCard,
  OperationCardActivityEventType,
} from "@/types";

/**
 * Server-side engine for Operations automations (PRD 16) — called by
 * the three route handlers in src/app/api/operations/automations/
 * (dispatch, resume-cron, time-sweep-cron), themselves invoked
 * instantly by a Postgres trigger (pg_net) or on a schedule (pg_cron),
 * never directly by the client. Parallel to, and does not share any
 * code path with, src/lib/automations/engine.ts (the Deal/Conversation
 * engine) beyond the generic service-role client wrapper.
 *
 * Loop protection: chain_depth is threaded through every automation-
 * triggered action (see execute_operation_automation_action, migration
 * 081) via a session GUC, and persisted on the resulting
 * operation_card_activity row. dispatchOperationAutomationEvent bails
 * out before doing any work once the INCOMING event's chain_depth
 * already reached MAX_AUTOMATION_CHAIN_DEPTH — mirrors
 * src/lib/contacts/tag-chain.ts's MAX_TAG_CHAIN_DEPTH pattern,
 * generalized to every action type instead of just add_tag.
 */

export const MAX_AUTOMATION_CHAIN_DEPTH = 3;

type AdminClient = ReturnType<typeof supabaseAdmin>;

type AutomationWithSteps = OperationAutomation & { operation_automation_steps: OperationAutomationStep[] };

interface DispatchEventInput {
  eventType: OperationCardActivityEventType;
  cardId: string;
  chainDepth: number;
  payload: Record<string, unknown>;
}

// ============================================================
// Instant, activity-triggered dispatch.
// ============================================================
export async function dispatchOperationAutomationEvent(input: DispatchEventInput): Promise<void> {
  if (input.chainDepth >= MAX_AUTOMATION_CHAIN_DEPTH) {
    console.warn(`[operation-automations] chain depth ${input.chainDepth} reached the max — skipping dispatch for card ${input.cardId}`);
    return;
  }

  const admin = supabaseAdmin();
  const { data: card } = await admin.from("operation_cards").select("*").eq("id", input.cardId).maybeSingle();
  if (!card || card.archived_at) return;

  let candidates = mapActivityEventToTriggerCandidates(input.eventType, input.payload);
  if (candidates.length === 0) return;

  candidates = await refineAggregateCandidates(admin, input, candidates);
  if (candidates.length === 0) return;

  const { data: automations } = await admin
    .from("operation_automations")
    .select("*, operation_automation_steps(*)")
    .eq("board_id", card.board_id)
    .eq("is_active", true)
    .in("trigger_type", candidates);

  for (const automation of (automations ?? []) as AutomationWithSteps[]) {
    if (!triggerConfigMatches(automation, input)) continue;
    await runAutomationForCard(admin, automation, card as OperationCard, input.chainDepth, input.eventType);
  }
}

function triggerConfigMatches(automation: OperationAutomation, input: DispatchEventInput): boolean {
  const cfg = automation.trigger_config as Record<string, unknown>;
  switch (automation.trigger_type) {
    case "entered_stage":
      return !!cfg.stage_id && cfg.stage_id === input.payload.to_stage_id;
    case "left_stage":
      return !!cfg.stage_id && cfg.stage_id === input.payload.from_stage_id;
    case "field_changed":
      return !cfg.field_def_id || cfg.field_def_id === input.payload.field_def_id;
    case "tag_added":
    case "tag_removed":
      return !cfg.tag_id || cfg.tag_id === input.payload.tag_id;
    default:
      return true;
  }
}

/**
 * event-trigger-map.ts only knows which trigger_types are POSSIBLE for
 * a given activity event_type — narrowing candidates that need a DB
 * lookup (is this task a subtask? are all first-level tasks now done?
 * is this checklist / every checklist on the card now fully done?)
 * happens here.
 */
async function refineAggregateCandidates(
  admin: AdminClient,
  input: DispatchEventInput,
  candidates: OperationAutomationTriggerType[],
): Promise<OperationAutomationTriggerType[]> {
  const result = new Set(candidates);

  if (result.has("subtask_completed") || result.has("task_completed")) {
    const taskId = input.payload.task_id as string | undefined;
    const { data: task } = taskId
      ? await admin.from("operation_tasks").select("parent_task_id").eq("id", taskId).maybeSingle()
      : { data: null };
    if (!task?.parent_task_id) result.delete("subtask_completed");
  }

  if (result.has("all_tasks_completed")) {
    const { data: remaining } = await admin
      .from("operation_tasks")
      .select("id")
      .eq("card_id", input.cardId)
      .is("parent_task_id", null)
      .not("status", "in", "(done,cancelled)");
    if ((remaining ?? []).length > 0) result.delete("all_tasks_completed");
  }

  if (result.has("checklist_completed") || result.has("all_items_completed")) {
    const checklistId = input.payload.checklist_id as string | undefined;
    const checklistDone = checklistId ? await isChecklistFullyDone(admin, checklistId) : false;
    if (!checklistDone) {
      result.delete("checklist_completed");
      result.delete("all_items_completed");
    } else if (result.has("all_items_completed")) {
      const allDone = await areAllCardChecklistsDone(admin, input.cardId);
      if (!allDone) result.delete("all_items_completed");
    }
  }

  return [...result];
}

async function isChecklistFullyDone(admin: AdminClient, checklistId: string): Promise<boolean> {
  const { data: items } = await admin.from("operation_checklist_items").select("is_done").eq("checklist_id", checklistId);
  return (items ?? []).length > 0 && (items ?? []).every((i) => i.is_done);
}

async function areAllCardChecklistsDone(admin: AdminClient, cardId: string): Promise<boolean> {
  const { data: checklists } = await admin.from("operation_checklists").select("id").eq("card_id", cardId);
  const ids = (checklists ?? []).map((c) => c.id);
  if (ids.length === 0) return true;
  const { data: items } = await admin.from("operation_checklist_items").select("is_done").in("checklist_id", ids);
  return (items ?? []).every((i) => i.is_done);
}

// ============================================================
// Shared execution path (dispatch, resume, and sweep all funnel here).
// ============================================================
async function buildConditionContext(
  admin: AdminClient,
  card: OperationCard,
  taskId?: string | null,
): Promise<OperationAutomationConditionContext> {
  const [{ data: fieldValueRows }, { data: tagRows }, taskResult] = await Promise.all([
    admin.from("operation_card_field_values").select("*").eq("card_id", card.id),
    admin.from("operation_card_tags").select("tag_id").eq("card_id", card.id),
    taskId
      ? admin.from("operation_tasks").select("*").eq("id", taskId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const fieldValues: Record<string, OperationAutomationFieldValue> = {};
  for (const row of fieldValueRows ?? []) {
    fieldValues[row.field_def_id as string] = {
      text: row.value_text as string | null,
      number: row.value_number as number | null,
      date: row.value_date as string | null,
      boolean: row.value_boolean as boolean | null,
      uuid: row.value_uuid as string | null,
      multiSelect: row.value_multi_select as string[] | null,
    };
  }

  const task = taskResult.data;

  return {
    card: { priority: card.priority, stage_id: card.stage_id, assigned_to_user_id: card.assigned_to_user_id ?? null },
    task: task
      ? { priority: task.priority, status: task.status, assigned_to_user_id: task.assigned_to_user_id ?? null, due_at: task.due_at ?? null }
      : null,
    fieldValues,
    tagIds: (tagRows ?? []).map((t) => t.tag_id as string),
  };
}

async function runAutomationForCard(
  admin: AdminClient,
  automation: AutomationWithSteps,
  card: OperationCard,
  chainDepth: number,
  triggerEvent: string,
): Promise<void> {
  const conditionContext = await buildConditionContext(admin, card);
  const conditionsPass = evaluateConditions(automation.conditions, conditionContext);

  const { data: logRow } = await admin
    .from("operation_automation_logs")
    .insert({
      automation_id: automation.id,
      account_id: automation.account_id,
      board_id: automation.board_id,
      card_id: card.id,
      trigger_event: triggerEvent,
      chain_depth: chainDepth,
      status: "failed", // pessimistic seed — a crashed process leaves a correctly-failed row, not a false 'success'
    })
    .select()
    .single();
  if (!logRow) return;

  if (!conditionsPass) {
    await admin
      .from("operation_automation_logs")
      .update({
        status: "success",
        steps_executed: [{ step_id: "conditions", step_type: "wait", status: "success", detail: "conditions not met, no actions run" }],
      })
      .eq("id", logRow.id);
    return;
  }

  await admin
    .from("operation_automations")
    .update({ execution_count: automation.execution_count + 1, last_executed_at: new Date().toISOString() })
    .eq("id", automation.id);

  const steps = [...(automation.operation_automation_steps ?? [])].sort((a, b) => a.position - b.position);
  await executeStepsFrom({ admin, automation, card, chainDepth, logId: logRow.id as string, steps, startPosition: 0, context: {} });
}

function computeWaitRunAt(config: Record<string, unknown>): Date {
  const minutes = typeof config.minutes === "number" ? config.minutes : 0;
  const hours = typeof config.hours === "number" ? config.hours : 0;
  const days = typeof config.days === "number" ? config.days : 0;
  const ms = (minutes + hours * 60 + days * 24 * 60) * 60 * 1000;
  return new Date(Date.now() + ms);
}

async function finalizeLog(
  admin: AdminClient,
  logId: string,
  status: "success" | "partial" | "failed",
  newSteps: OperationAutomationLogStepResult[],
  errorMessage?: string | null,
): Promise<void> {
  const { data: existing } = await admin.from("operation_automation_logs").select("steps_executed").eq("id", logId).single();
  const merged = [...((existing?.steps_executed as OperationAutomationLogStepResult[] | null) ?? []), ...newSteps];
  await admin.from("operation_automation_logs").update({ status, steps_executed: merged, error_message: errorMessage ?? null }).eq("id", logId);
}

async function executeStepsFrom(args: {
  admin: AdminClient;
  automation: OperationAutomation;
  card: OperationCard;
  chainDepth: number;
  logId: string;
  steps: OperationAutomationStep[];
  startPosition: number;
  context: Record<string, unknown>;
}): Promise<void> {
  const { admin, automation, card, chainDepth, logId, steps, startPosition, context } = args;
  const results: OperationAutomationLogStepResult[] = [];
  let ctx = context;

  for (const step of steps) {
    if (step.position < startPosition) continue;

    if (step.step_type === "wait") {
      const runAt = computeWaitRunAt(step.step_config);
      await admin.from("operation_automation_pending_executions").insert({
        automation_id: automation.id,
        account_id: automation.account_id,
        board_id: automation.board_id,
        card_id: card.id,
        log_id: logId,
        next_step_position: step.position + 1,
        context: ctx,
        run_at: runAt.toISOString(),
      });
      results.push({ step_id: step.id, step_type: "wait", status: "success", detail: `waiting until ${runAt.toISOString()}` });
      await finalizeLog(admin, logId, "partial", results);
      return;
    }

    const { data, error } = await admin.rpc("execute_operation_automation_action", {
      p_step_type: step.step_type,
      p_step_config: step.step_config,
      p_card_id: card.id,
      p_chain_depth: chainDepth + 1,
      p_context: ctx,
    });

    if (error) {
      results.push({ step_id: step.id, step_type: step.step_type, status: "failed", detail: error.message });
      await finalizeLog(admin, logId, "failed", results, error.message);
      return;
    }

    const result = data as { status: string; detail: string; context: Record<string, unknown> };
    ctx = result.context ?? ctx;
    results.push({ step_id: step.id, step_type: step.step_type, status: "success", detail: result.detail });
  }

  await finalizeLog(admin, logId, "success", results);
}

// ============================================================
// Resume ('wait' queue drain — resume-cron).
// ============================================================
export async function resumeOperationAutomationPendingExecution(row: OperationAutomationPendingExecution): Promise<void> {
  const admin = supabaseAdmin();

  const { data: automation } = await admin
    .from("operation_automations")
    .select("*, operation_automation_steps(*)")
    .eq("id", row.automation_id)
    .maybeSingle();

  if (!automation || !automation.is_active) {
    await admin.from("operation_automation_pending_executions").update({ status: "cancelled" }).eq("id", row.id);
    return;
  }

  if (!row.card_id) {
    await admin.from("operation_automation_pending_executions").update({ status: "failed" }).eq("id", row.id);
    return;
  }

  const { data: card } = await admin.from("operation_cards").select("*").eq("id", row.card_id).maybeSingle();
  if (!card) {
    await admin.from("operation_automation_pending_executions").update({ status: "cancelled" }).eq("id", row.id);
    return;
  }

  const { data: logRow } = await admin.from("operation_automation_logs").select("chain_depth").eq("id", row.log_id).maybeSingle();
  const chainDepth = (logRow?.chain_depth as number | undefined) ?? 0;

  // PRD 16.6 — the condition is re-evaluated at execution time, after the wait.
  const conditionContext = await buildConditionContext(admin, card as OperationCard);
  const conditionsPass = evaluateConditions(automation.conditions, conditionContext);

  if (!conditionsPass) {
    await admin.from("operation_automation_pending_executions").update({ status: "done" }).eq("id", row.id);
    await finalizeLog(admin, row.log_id, "success", [
      { step_id: "resume-conditions", step_type: "wait", status: "success", detail: "conditions no longer met after wait — remaining actions skipped" },
    ]);
    return;
  }

  const steps = [...((automation as AutomationWithSteps).operation_automation_steps ?? [])].sort((a, b) => a.position - b.position);
  await executeStepsFrom({
    admin,
    automation,
    card: card as OperationCard,
    chainDepth,
    logId: row.log_id,
    steps,
    startPosition: row.next_step_position,
    context: row.context,
  });
  await admin.from("operation_automation_pending_executions").update({ status: "done" }).eq("id", row.id);
}

// ============================================================
// Time-based sweep (time-sweep-cron).
// ============================================================
interface SweepCandidate {
  automation_id: string;
  card_id: string;
  task_id?: string | null;
  fired_for_key: string;
}

async function getTaskDueCandidates(admin: AdminClient): Promise<SweepCandidate[]> {
  const { data: automations } = await admin
    .from("operation_automations")
    .select("id, board_id, trigger_type, trigger_config")
    .eq("is_active", true)
    .in("trigger_type", ["task_due_today", "task_overdue", "task_overdue_days"]);
  if (!automations || automations.length === 0) return [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const todayKey = todayStart.toISOString().slice(0, 10);

  const results: SweepCandidate[] = [];

  for (const automation of automations) {
    const { data: tasks } = await admin
      .from("operation_tasks")
      .select("id, card_id, due_at, operation_cards!inner(board_id, archived_at)")
      .eq("operation_cards.board_id", automation.board_id)
      .not("status", "in", "(done,cancelled)")
      .not("due_at", "is", null);

    for (const task of (tasks ?? []) as unknown as { id: string; card_id: string; due_at: string; operation_cards: { archived_at: string | null } }[]) {
      if (task.operation_cards.archived_at) continue;
      const dueAt = new Date(task.due_at);

      if (automation.trigger_type === "task_due_today" && dueAt >= todayStart && dueAt < todayEnd) {
        results.push({ automation_id: automation.id, card_id: task.card_id, task_id: task.id, fired_for_key: `${task.id}:${todayKey}` });
      } else if (automation.trigger_type === "task_overdue" && dueAt < todayStart) {
        results.push({ automation_id: automation.id, card_id: task.card_id, task_id: task.id, fired_for_key: `${task.id}:overdue` });
      } else if (automation.trigger_type === "task_overdue_days") {
        const days = (automation.trigger_config as Record<string, unknown>).days as number;
        const threshold = new Date(todayStart.getTime() - days * 24 * 60 * 60 * 1000);
        if (dueAt < threshold) {
          results.push({ automation_id: automation.id, card_id: task.card_id, task_id: task.id, fired_for_key: `${task.id}:${days}` });
        }
      }
    }
  }

  return results;
}

export async function sweepOperationAutomationTimeTriggers(): Promise<{ processed: number }> {
  const admin = supabaseAdmin();

  const [{ data: dateCandidates }, { data: stuckCandidates }, taskCandidates] = await Promise.all([
    admin.rpc("get_operation_date_trigger_candidates"),
    admin.rpc("get_operation_stuck_stage_candidates"),
    getTaskDueCandidates(admin),
  ]);

  const allCandidates: SweepCandidate[] = [
    ...((dateCandidates ?? []) as SweepCandidate[]),
    ...((stuckCandidates ?? []) as SweepCandidate[]),
    ...taskCandidates,
  ];

  let processed = 0;
  for (const candidate of allCandidates) {
    const { error: fireError } = await admin.from("operation_automation_fires").insert({
      automation_id: candidate.automation_id,
      card_id: candidate.card_id,
      task_id: candidate.task_id ?? null,
      fired_for_key: candidate.fired_for_key,
    });
    if (fireError) continue; // already fired for this key (unique violation) — skip

    const { data: automation } = await admin
      .from("operation_automations")
      .select("*, operation_automation_steps(*)")
      .eq("id", candidate.automation_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!automation) continue;

    const { data: card } = await admin.from("operation_cards").select("*").eq("id", candidate.card_id).maybeSingle();
    if (!card || card.archived_at) continue;

    await runAutomationForCard(admin, automation as AutomationWithSteps, card as OperationCard, 0, automation.trigger_type);
    processed++;
  }

  return { processed };
}
