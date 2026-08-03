import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-links a brand-new 1:1 conversation to the account's default
 * pipeline, in its first stage — the LeilãoDesk spec's "every new
 * conversation starts as a Lead" requirement. Without this, a
 * conversation with no linked deal has nothing for the Inbox Kanban
 * (grouped by pipeline) to place it under, so it falls into "Sem
 * negócio neste pipeline" — a column that also disables drag (there's
 * no `deals.stage_id` to move), leaving the card stuck.
 *
 * "Default pipeline" has no dedicated flag in the schema — same
 * oldest-created convention already used by `pipelines/page.tsx` and
 * `inbox/page.tsx`. Deliberately NOT called for group conversations
 * (callers gate on that) — a WhatsApp group isn't a sales lead in the
 * same sense a 1:1 contact is; per user decision, groups stay
 * unlinked unless someone creates a deal for one by hand.
 *
 * Best-effort: swallows its own errors (bad account state, RLS
 * denial, etc.) rather than throwing — this must never break message
 * ingest or the outbound send path over a missing/misconfigured
 * pipeline. Also a no-op when the account has no pipeline yet (rare —
 * an account that's never opened Settings/Pipelines).
 */
export async function ensureDefaultPipelineDeal(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    contactId: string;
    conversationId: string;
    /** Deal title fallback when the caller already has the contact's
     *  display name/phone in hand; queried from `contacts` otherwise. */
    contactLabel?: string;
  },
): Promise<void> {
  try {
    const { data: pipeline } = await db
      .from("pipelines")
      .select("id")
      .eq("account_id", args.accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!pipeline) return;

    const { data: firstStage } = await db
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStage) return;

    // A contact can already have a deal in this pipeline (e.g. created
    // by hand before this conversation existed) — link the existing
    // one back to the conversation instead of creating a duplicate.
    const { data: existingDeal } = await db
      .from("deals")
      .select("id, conversation_id")
      .eq("pipeline_id", pipeline.id)
      .eq("contact_id", args.contactId)
      .limit(1)
      .maybeSingle();
    if (existingDeal) {
      if (!existingDeal.conversation_id) {
        await db
          .from("deals")
          .update({ conversation_id: args.conversationId })
          .eq("id", existingDeal.id);
      }
      return;
    }

    let title = args.contactLabel;
    if (!title) {
      const { data: contact } = await db
        .from("contacts")
        .select("name, phone")
        .eq("id", args.contactId)
        .maybeSingle();
      title = contact?.name || contact?.phone || "Novo lead";
    }

    await db.from("deals").insert({
      account_id: args.accountId,
      user_id: args.userId,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
      title,
    });
  } catch (err) {
    console.error("[ensure-default-deal] failed:", err);
  }
}
