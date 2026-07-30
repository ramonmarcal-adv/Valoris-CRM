import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Liberar meus leads" — bulk-unassign every conversation currently
 * assigned to the caller. A plain filtered UPDATE (no RPC needed): it's
 * scoped by `assigned_agent_id = userId`, so it never touches another
 * agent's rows and has no cross-row invariant to protect — same trust
 * boundary as the single-row patches in conversation-context-menu.tsx.
 */
export async function releaseMyLeads(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
) {
  return supabase
    .from("conversations")
    .update({ assigned_agent_id: null })
    .eq("account_id", accountId)
    .eq("assigned_agent_id", userId)
    .select("id");
}

/**
 * "Redistribuir fila" — round-robin reassigns every unassigned, non-
 * archived conversation across the account's agent+ members. Delegates
 * to a SECURITY DEFINER RPC (supabase/migrations/045_bulk_reassignment_rpc.sql)
 * rather than a client read-then-write loop, since two concurrent calls
 * racing on the client could double-assign the same conversation.
 */
export async function redistributeQueue(supabase: SupabaseClient) {
  return supabase.rpc("redistribute_unassigned_queue");
}
