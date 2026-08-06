// ============================================================
// GET /api/forms/[slug]
//
// Public — no auth required. Lets the /f/<slug> page render the
// form's questions before the visitor submits anything.
//
// Same composition as /api/invitations/[token]/peek: rate-limit by
// IP first, then call a SECURITY DEFINER RPC (get_public_form,
// migration 084) through the anon-key server client — the RPC
// bypasses RLS internally and returns a fixed-shape JSON payload
// that never leaks columns beyond what the public page renders
// (never maps_to/card_field_def_id/account_id).
// ============================================================

import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/http/client-ip";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`formView:${ip}`, RATE_LIMITS.formView);
  if (!limit.success) return rateLimitResponse(limit);

  const { slug } = await params;
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_form", { p_slug: slug });

  if (error) {
    console.error("[forms] get_public_form rpc error:", error);
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500 });
  }

  return NextResponse.json(data);
}
