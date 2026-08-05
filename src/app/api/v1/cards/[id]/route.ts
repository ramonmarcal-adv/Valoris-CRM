// ============================================================
// GET   /api/v1/cards/{id} — read a card   (scope: cards:read)
// PATCH /api/v1/cards/{id} — update a card (scope: cards:write)
//
// Both are account-scoped: a card belonging to another account
// returns 404 (never 403 — don't reveal it exists elsewhere). PATCH
// updates only the fields present in the body. Moving `stage_id` is
// validated against the card's own board — cross-board moves aren't
// supported via this endpoint (mirrors the web app: a card never
// changes board after creation).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getCardById,
  verifyStageInBoard,
  serializeCard,
  CARD_SELECT,
  CardError,
} from '@/lib/api/v1/cards';

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'cards:read');
    const { id } = await params;
    const card = await getCardById(ctx.supabase, ctx.accountId, id);
    if (!card) return fail('not_found', 'Card not found', 404);
    return ok(card);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'cards:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const existing = await getCardById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Card not found', 404);

    const updates: Record<string, unknown> = {};

    if ('title' in body) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return fail('bad_request', "'title' must be a non-empty string", 400);
      updates.title = title;
    }

    if ('description' in body) {
      const value = body.description;
      if (value !== null && typeof value !== 'string') {
        return fail('bad_request', "'description' must be a string or null", 400);
      }
      updates.description = value;
    }

    if ('priority' in body) {
      if (!VALID_PRIORITIES.includes(body.priority as string)) {
        return fail('bad_request', `'priority' must be one of ${VALID_PRIORITIES.join(', ')}`, 400);
      }
      updates.priority = body.priority;
    }

    if ('assigned_to_user_id' in body) {
      const value = body.assigned_to_user_id;
      if (value !== null && typeof value !== 'string') {
        return fail('bad_request', "'assigned_to_user_id' must be a string or null", 400);
      }
      updates.assigned_to_user_id = value;
    }

    if ('stage_id' in body) {
      const stageId = typeof body.stage_id === 'string' ? body.stage_id : '';
      if (!stageId) return fail('bad_request', "'stage_id' must be a non-empty string", 400);
      const stageOk = await verifyStageInBoard(ctx.supabase, existing.board_id, stageId);
      if (!stageOk) {
        return fail('bad_request', "'stage_id' does not refer to a stage on this card's board", 400);
      }
      updates.stage_id = stageId;
    }

    if ('archived' in body) {
      if (typeof body.archived !== 'boolean') {
        return fail('bad_request', "'archived' must be a boolean", 400);
      }
      updates.archived_at = body.archived ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length === 0) {
      return ok(existing);
    }

    updates.updated_at = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from('operation_cards')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(CARD_SELECT)
      .single();

    if (error || !data) {
      console.error('[api/v1/cards] update error:', error);
      return fail('internal', 'Failed to update card', 500);
    }

    return ok(serializeCard(data as Record<string, unknown>));
  } catch (err) {
    if (err instanceof CardError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
