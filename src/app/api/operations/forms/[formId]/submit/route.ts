// ============================================================
// POST /api/operations/forms/[formId]/submit
//
// Authenticated — the "fill this form from the dashboard" path
// (always available for any form, published or not; this is how
// staff intake a caller over the phone, and how the future Chrome
// extension, Release F2, will feed Cards from a form too). Uses the
// caller's own RLS-scoped client (src/lib/supabase/server.ts), NOT
// service-role — every table submitOperationForm touches already
// requires agent+ via its own RLS, so no separate rate-limit/honeypot
// is needed here (unlike the public path, the caller is already an
// authenticated, accountable member).
// ============================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { submitOperationForm } from "@/lib/operations/forms/submit";
import type { OperationForm, OperationFormQuestion } from "@/types";

export async function POST(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const { formId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const { data: form } = await supabase.from("operation_forms").select("*").eq("id", formId).is("archived_at", null).maybeSingle();
  if (!form) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  const typedForm = form as OperationForm;

  const { data: questionRows } = await supabase
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
    const result = await submitOperationForm(supabase, {
      form: typedForm,
      questions,
      answers: answers as Record<string, string | string[] | number | boolean | null | undefined>,
      consentGiven: body.consentGiven === true,
      submittedByUserId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[operations/forms] submitOperationForm failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
