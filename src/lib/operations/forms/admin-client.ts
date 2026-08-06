import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy, shared service-role client for public form submissions — no
// session exists for an anonymous visitor, so RLS on contacts/
// operation_cards (agent+) can never be satisfied; every query here
// must scope by account_id explicitly. Same pattern as
// src/lib/automations/admin-client.ts / src/lib/flows/admin-client.ts /
// src/lib/ai/admin-client.ts (a 4th near-identical copy, kept
// consistent with the existing per-domain convention rather than
// extracting a shared one in this release).
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
