// ============================================================
// POST /api/forms/[slug]/submit
//
// Public — no auth required. Runs entirely on the service-role
// client (src/lib/operations/forms/admin-client.ts) since an
// anonymous visitor has no session and RLS on contacts/
// operation_cards can never be satisfied — same established pattern
// as the WhatsApp webhook and /api/v1/*.
//
// Order: rate-limit by IP -> honeypot/timing check (both fail
// SILENTLY with a fake 200 + the real thank-you message, nothing
// persisted, only logged server-side — a bot that gets a real error
// learns something, one that gets an identical success learns
// nothing) -> load the form (must be published, not archived) ->
// validate required questions -> submitOperationForm().
// ============================================================

import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/http/client-ip";
import { isHoneypotTripped, isSubmittedTooFast } from "@/lib/operations/forms/honeypot";
import { supabaseAdmin } from "@/lib/operations/forms/admin-client";
import { submitOperationForm } from "@/lib/operations/forms/submit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { OperationForm, OperationFormQuestion } from "@/types";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`formSubmit:${ip}`, RATE_LIMITS.formSubmit);
  if (!limit.success) return rateLimitResponse(limit);

  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: form } = await admin
    .from("operation_forms")
    .select("*")
    .eq("slug", slug)
    .is("archived_at", null)
    .eq("is_published", true)
    .maybeSingle();

  if (!form) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const typedForm = form as OperationForm;

  // Silent-reject bots: identical success response, nothing written.
  if (isHoneypotTripped(body.honeypot) || isSubmittedTooFast(body.loadedAt)) {
    console.warn("[forms] rejected suspected bot submission", { formId: typedForm.id, ip });
    return NextResponse.json({ ok: true, thank_you_message: typedForm.thank_you_message });
  }

  if (typedForm.consent_required && body.consentGiven !== true) {
    return NextResponse.json({ ok: false, error: "consent_required" }, { status: 400 });
  }

  const { data: questionRows } = await admin
    .from("operation_form_questions")
    .select("*")
    .eq("form_id", typedForm.id)
    .order("position");
  const questions = (questionRows ?? []) as OperationFormQuestion[];

  const answers = (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<string, unknown>;
  const missingRequired = questions.filter((q) => {
    if (!q.is_required) return false;
    const v = answers[q.id];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { ok: false, error: "missing_required", questionIds: missingRequired.map((q) => q.id) },
      { status: 400 },
    );
  }

  try {
    await submitOperationForm(admin, {
      form: typedForm,
      questions,
      answers: answers as Record<string, string | string[] | number | boolean | null | undefined>,
      utm: {
        source: typeof body.utm_source === "string" ? body.utm_source : undefined,
        medium: typeof body.utm_medium === "string" ? body.utm_medium : undefined,
        campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : undefined,
        content: typeof body.utm_content === "string" ? body.utm_content : undefined,
      },
      referralCode: typeof body.referral_code === "string" ? body.referral_code : undefined,
      hiddenFields: body.hidden_fields && typeof body.hidden_fields === "object" ? body.hidden_fields : {},
      consentGiven: body.consentGiven === true,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[forms] submitOperationForm failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, thank_you_message: typedForm.thank_you_message });
}
