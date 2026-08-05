// ============================================================
// GET  /api/v1/cards  — list Operations cards (scope: cards:read)
// POST /api/v1/cards  — create a card         (scope: cards:write)
//
// List is keyset-paginated (see src/lib/api/v1/pagination.ts) and
// supports `?board_id=`, `?stage_id=`, `?priority=`,
// `?assigned_to_user_id=` filters (all optional, combined with AND).
// Archived cards are excluded unless `?archived=true` is passed.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  CARD_SELECT,
  serializeCard,
  createCard,
  CardError,
  type ApiCard,
} from '@/lib/api/v1/cards';

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'cards:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const boardId = url.searchParams.get('board_id');
    const stageId = url.searchParams.get('stage_id');
    const priority = url.searchParams.get('priority');
    const assignedToUserId = url.searchParams.get('assigned_to_user_id');
    const includeArchived = url.searchParams.get('archived') === 'true';

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return fail('bad_request', `'priority' must be one of ${VALID_PRIORITIES.join(', ')}`, 400);
    }

    let query = ctx.supabase
      .from('operation_cards')
      .select(CARD_SELECT)
      .eq('account_id', ctx.accountId);

    if (!includeArchived) query = query.is('archived_at', null);
    if (boardId) query = query.eq('board_id', boardId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (priority) query = query.eq('priority', priority);
    if (assignedToUserId) query = query.eq('assigned_to_user_id', assignedToUserId);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/cards] list error:', error);
      return fail('internal', 'Failed to list cards', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeCard(r as Record<string, unknown>)) as ApiCard[],
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'cards:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const boardId = typeof body.board_id === 'string' ? body.board_id : '';
    if (!boardId) {
      return fail('bad_request', "'board_id' is required", 400);
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return fail('bad_request', "'title' is required", 400);
    }
    if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority as string)) {
      return fail('bad_request', `'priority' must be one of ${VALID_PRIORITIES.join(', ')}`, 400);
    }

    const card = await createCard(ctx.supabase, ctx.accountId, {
      boardId,
      title,
      description: typeof body.description === 'string' ? body.description : undefined,
      priority: body.priority as ApiCard['priority'] | undefined,
      stageId: typeof body.stage_id === 'string' ? body.stage_id : undefined,
      assignedToUserId: typeof body.assigned_to_user_id === 'string' ? body.assigned_to_user_id : undefined,
    });

    return ok(card, 201);
  } catch (err) {
    if (err instanceof CardError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
