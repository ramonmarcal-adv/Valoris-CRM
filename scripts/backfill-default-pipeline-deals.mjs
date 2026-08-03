// One-off backfill: links every existing 1:1 conversation to its
// account's default pipeline (oldest-created) first stage, mirroring
// what src/lib/deals/ensure-default-deal.ts now does automatically for
// every NEW conversation going forward (LeilãoDesk spec — "every new
// conversation starts as a Lead"). Without this, conversations created
// before that fix stay stuck in the Inbox Kanban's "Sem negócio neste
// pipeline" column with drag disabled (no deal to move).
//
// Safe to re-run: skips conversations that already resolve to a deal
// in the account's default pipeline, and skips group conversations
// entirely (same exclusion as the go-forward logic).
//
// Usage: node --env-file=.env.local scripts/backfill-default-pipeline-deals.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: accounts, error: accountsError } = await supabase.from("accounts").select("id");
  if (accountsError) {
    console.error("Failed to list accounts:", accountsError.message);
    process.exit(1);
  }

  let dealsCreated = 0;
  let dealsLinked = 0;
  let groupsSkipped = 0;
  let accountsWithNoPipeline = 0;

  for (const account of accounts ?? []) {
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("id, name")
      .eq("account_id", account.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!pipeline) {
      accountsWithNoPipeline++;
      continue;
    }

    const { data: firstStage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStage) continue;

    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select("id, contact_id, user_id, contact:contacts(id, name, phone, is_group_placeholder)")
      .eq("account_id", account.id);
    if (convError) {
      console.error(`Failed to list conversations for account ${account.id}:`, convError.message);
      continue;
    }

    for (const conv of conversations ?? []) {
      if (!conv.contact_id) continue;
      const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact;
      if (contact?.is_group_placeholder) {
        groupsSkipped++;
        continue;
      }

      const { data: existingDeal } = await supabase
        .from("deals")
        .select("id, conversation_id")
        .eq("pipeline_id", pipeline.id)
        .eq("contact_id", conv.contact_id)
        .limit(1)
        .maybeSingle();

      if (existingDeal) {
        if (!existingDeal.conversation_id) {
          await supabase.from("deals").update({ conversation_id: conv.id }).eq("id", existingDeal.id);
          dealsLinked++;
        }
        continue;
      }

      const title = contact?.name || contact?.phone || "Novo lead";
      const { error: insertError } = await supabase.from("deals").insert({
        account_id: account.id,
        user_id: conv.user_id,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        contact_id: conv.contact_id,
        conversation_id: conv.id,
        title,
      });
      if (insertError) {
        console.error(`Failed to create deal for conversation ${conv.id}:`, insertError.message);
        continue;
      }
      dealsCreated++;
    }
  }

  console.log("Backfill finished.");
  console.log(`  Deals created: ${dealsCreated}`);
  console.log(`  Existing deals linked to their conversation: ${dealsLinked}`);
  console.log(`  Group conversations skipped: ${groupsSkipped}`);
  console.log(`  Accounts with no pipeline yet (skipped): ${accountsWithNoPipeline}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
