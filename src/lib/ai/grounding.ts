import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveKnowledge } from './knowledge'
import { resolveLinkContext } from './link-context'
import { latestUserMessage } from './query'
import type { AiConfig, ChatMessage } from './types'

export interface AiGrounding {
  knowledge: string[]
  pageContext: string | null
}

/**
 * Runs the two best-effort grounding lookups a reply can draw on —
 * the admin-curated knowledge base and any external page the customer
 * linked — in parallel, and returns both together. Shared by every
 * `generateReply` caller (auto-reply, draft, playground) so the
 * pairing can't drift out of sync between them and so the two lookups
 * don't add up their latencies serially.
 *
 * Neither lookup ever throws (see retrieveKnowledge / resolveLinkContext);
 * this doesn't either.
 */
export async function prepareAiGrounding(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  messages: ChatMessage[],
): Promise<AiGrounding> {
  const [knowledge, pageContext] = await Promise.all([
    retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
    resolveLinkContext(accountId, messages),
  ])
  return { knowledge, pageContext }
}
