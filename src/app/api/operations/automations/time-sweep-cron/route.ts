import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepOperationAutomationTimeTriggers } from "@/lib/operations/automations/engine";

/**
 * Sweeps the 7 time-based triggers (PRD 16.3) that can't come from an
 * operation_card_activity write — date_reached / days_before_date /
 * days_after_date / task_due_today / task_overdue / task_overdue_days
 * / card_stuck_in_stage_days. Called on a schedule by pg_cron
 * (migration 080, 'operation-automation-time-sweep', every 15
 * minutes) — daily-granularity triggers don't need tighter polling.
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

  const result = await sweepOperationAutomationTimeTriggers();
  return NextResponse.json(result);
}
