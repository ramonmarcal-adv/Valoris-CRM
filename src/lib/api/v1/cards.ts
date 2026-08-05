// ============================================================
// Shared card logic for the public API (v1) Operations endpoints.
//
// Scope for Release A: native card fields only (title, description,
// priority, stage, assignee, archived). Sub-resources (comments,
// attachments, relations, custom field values) are deliberately left
// out of the public API for now — each is its own paginated
// sub-resource and isn't needed until an external consumer (the
// planned Chrome extension) actually requires them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveInitialStageId } from '@/lib/operations/board-stages';

export const CARD_SELECT = '*';

export interface ApiCard {
  id: string;
  board_id: string;
  stage_id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  position: number;
  assigned_to_user_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class CardError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CardError';
    this.status = status;
  }
}

export function serializeCard(row: Record<string, unknown>): ApiCard {
  return {
    id: row.id as string,
    board_id: row.board_id as string,
    stage_id: row.stage_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    priority: row.priority as ApiCard['priority'],
    position: row.position as number,
    assigned_to_user_id: (row.assigned_to_user_id as string | null) ?? null,
    archived_at: (row.archived_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Fetch + serialize a single card scoped to the account, or null. */
export async function getCardById(
  db: SupabaseClient,
  accountId: string,
  cardId: string
): Promise<ApiCard | null> {
  const { data, error } = await db
    .from('operation_cards')
    .select(CARD_SELECT)
    .eq('id', cardId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeCard(data as Record<string, unknown>);
}

/** Verify a board belongs to the account before letting a caller create/move a card into it. */
export async function verifyBoardInAccount(
  db: SupabaseClient,
  accountId: string,
  boardId: string
): Promise<boolean> {
  const { data } = await db
    .from('operation_boards')
    .select('id')
    .eq('id', boardId)
    .eq('account_id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  return !!data;
}

/** Verify a stage belongs to the given board before letting a caller set/move a card to it. */
export async function verifyStageInBoard(
  db: SupabaseClient,
  boardId: string,
  stageId: string
): Promise<boolean> {
  const { data } = await db
    .from('operation_board_stages')
    .select('id')
    .eq('id', stageId)
    .eq('board_id', boardId)
    .is('archived_at', null)
    .maybeSingle();
  return !!data;
}

export interface CreateCardInput {
  boardId: string;
  title: string;
  description?: string | null;
  priority?: ApiCard['priority'];
  stageId?: string;
  assignedToUserId?: string | null;
}

/**
 * Create a card via the public API. Mirrors the web app's CardForm:
 * resolves the board's initial stage when `stageId` is omitted, and
 * defaults position to the end of that stage (fractional, same
 * convention as the Kanban drag — see src/lib/kanban/reorder.ts).
 */
export async function createCard(
  db: SupabaseClient,
  accountId: string,
  input: CreateCardInput
): Promise<ApiCard> {
  const boardOk = await verifyBoardInAccount(db, accountId, input.boardId);
  if (!boardOk) {
    throw new CardError("'board_id' does not refer to a board in this account", 400);
  }

  let stageId = input.stageId;
  if (stageId) {
    const stageOk = await verifyStageInBoard(db, input.boardId, stageId);
    if (!stageOk) {
      throw new CardError("'stage_id' does not refer to a stage on this board", 400);
    }
  } else {
    stageId = (await resolveInitialStageId(db, input.boardId)) ?? undefined;
    if (!stageId) {
      throw new CardError('This board has no stages yet', 400);
    }
  }

  const { data: maxPositionRow } = await db
    .from('operation_cards')
    .select('position')
    .eq('stage_id', stageId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((maxPositionRow?.position as number | undefined) ?? 0) + 1000;

  const { data, error } = await db
    .from('operation_cards')
    .insert({
      account_id: accountId,
      board_id: input.boardId,
      stage_id: stageId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      position,
      assigned_to_user_id: input.assignedToUserId ?? null,
    })
    .select(CARD_SELECT)
    .single();

  if (error || !data) {
    console.error('[api/v1/cards] create error:', error);
    throw new CardError('Failed to create card', 500);
  }

  return serializeCard(data as Record<string, unknown>);
}
