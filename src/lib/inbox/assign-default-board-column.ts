import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the account's flagged default Inbox Kanban column for a
 * brand-new conversation — is_default_for_groups when it's a WhatsApp
 * group, is_default_for_leads otherwise. Every account is guaranteed
 * exactly one of each (partial unique indexes, migration 057; seeded
 * for existing accounts by that migration's backfill, and for every
 * new account by the on_account_created_seed_board_columns trigger),
 * so a null return should only happen in a bug/race scenario.
 *
 * Unlike the old ensureDefaultPipelineDeal (which ran best-effort
 * *after* the conversation already existed), callers must embed this
 * result into the `conversations` INSERT payload — board_column_id is
 * a plain column on that row, not a separate linked table.
 */
export async function resolveDefaultBoardColumnId(
  db: SupabaseClient,
  args: { accountId: string; isGroup: boolean },
): Promise<string | null> {
  const flagColumn = args.isGroup ? "is_default_for_groups" : "is_default_for_leads";
  const { data, error } = await db
    .from("conversation_board_columns")
    .select("id")
    .eq("account_id", args.accountId)
    .eq(flagColumn, true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[assign-default-board-column] lookup failed:", error);
    return null;
  }
  return data?.id ?? null;
}
