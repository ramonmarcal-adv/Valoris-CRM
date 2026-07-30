import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppApiType, WhatsAppConfig } from '@/types';

/**
 * Single source of truth for "which whatsapp_config row should this
 * send use" — imported by every place that used to do its own
 * `.from('whatsapp_config').eq('account_id', accountId).single()`
 * (src/lib/whatsapp/send-message.ts, src/lib/flows/meta-send.ts,
 * src/lib/automations/meta-send.ts). Introduced specifically because
 * those three are independent implementations that don't share code
 * today — without one shared resolver, the Meta/Evolution routing
 * rule would need to be kept in sync by hand in three places.
 *
 * Routing rule:
 *   - Group conversations ALWAYS route to the account's 'evolution'
 *     config — Meta's Cloud API cannot send/receive group messages at
 *     all, so this isn't a preference, it's a hard constraint.
 *   - 1:1 conversations route to whichever config row has
 *     is_primary = true (falls back to the first row found if, for
 *     some reason, none is marked primary — should not happen given
 *     the partial unique index in migration 048, but callers get a
 *     usable config instead of a crash).
 */
export interface ResolvedProvider {
  provider: WhatsAppApiType;
  config: WhatsAppConfig;
}

export class ProviderNotConfiguredError extends Error {
  readonly code = 'whatsapp_not_configured';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}

export async function resolveProviderConfig(
  db: SupabaseClient,
  accountId: string,
  isGroup: boolean,
): Promise<ResolvedProvider> {
  if (isGroup) {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
      .maybeSingle();
    if (error || !data) {
      throw new ProviderNotConfiguredError(
        'This account has no Evolution API connection configured, so group messages cannot be sent. Connect Evolution API in Settings first.',
      );
    }
    return { provider: 'evolution', config: data as WhatsAppConfig };
  }

  const { data: rows, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId);

  if (error || !rows || rows.length === 0) {
    throw new ProviderNotConfiguredError(
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
    );
  }

  const primary = (rows as WhatsAppConfig[]).find((r) => r.is_primary) ?? rows[0];
  return { provider: primary.api_type, config: primary };
}
