import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { resumeOperationAutomationPendingExecution } from "@/lib/operations/automations/engine";
import type { OperationAutomationPendingExecution } from "@/types";

/**
 * Drains due operation_automation_pending_executions rows ('wait'
 * steps). Called on a schedule by pg_cron (migration 080,
 * 'operation-automation-resume', every minute) — not by an external
 * pinger, unlike the pre-existing /api/automations/cron for the
 * Deal/Conversation engine. Same optimistic claim-by-UPDATE pattern.
 */
export async function POST(request: Request) {
  const expected = process.env.OPERATION_AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-automation-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: due, error } = await admin
    .from("operation_automation_pending_executions")
    .select("*")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 });

  let processed = 0;
  for (const row of due) {
    const { data: claim } = await admin
      .from("operation_automation_pending_executions")
      .update({ status: "running" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claim) continue;

    await resumeOperationAutomationPendingExecution(row as OperationAutomationPendingExecution);
    processed++;
  }

  return NextResponse.json({ processed });
}
