import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchOperationAutomationEvent } from "@/lib/operations/automations/engine";

/**
 * Called instantly by a Postgres trigger (pg_net.http_post, migration
 * 080) the moment a row is inserted into operation_card_activity — NOT
 * polled, NOT called by the client. Requires the shared secret set in
 * private.automation_webhook_config('dispatch_secret') to match
 * OPERATION_AUTOMATION_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const expected = process.env.OPERATION_AUTOMATION_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "dispatch not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-automation-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.card_id !== "string" || typeof body.event_type !== "string") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  await dispatchOperationAutomationEvent({
    eventType: body.event_type,
    cardId: body.card_id,
    chainDepth: typeof body.chain_depth === "number" ? body.chain_depth : 0,
    payload: (body.payload as Record<string, unknown>) ?? {},
  });

  return NextResponse.json({ ok: true });
}
