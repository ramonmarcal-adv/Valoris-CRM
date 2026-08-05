import { describe, it, expect } from 'vitest';

import { serializeCard } from './cards';

describe('serializeCard', () => {
  it('flattens a full row', () => {
    const row = {
      id: 'card1',
      board_id: 'board1',
      stage_id: 'stage1',
      title: 'Apartamento no centro',
      description: 'Financiamento aceito',
      priority: 'high',
      position: 1000,
      assigned_to_user_id: 'user1',
      archived_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    expect(serializeCard(row)).toEqual({
      id: 'card1',
      board_id: 'board1',
      stage_id: 'stage1',
      title: 'Apartamento no centro',
      description: 'Financiamento aceito',
      priority: 'high',
      position: 1000,
      assigned_to_user_id: 'user1',
      archived_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('nulls missing optional fields', () => {
    const row = {
      id: 'card2',
      board_id: 'board1',
      stage_id: 'stage1',
      title: 'Sem descrição',
      priority: 'normal',
      position: 0,
      created_at: 'a',
      updated_at: 'b',
    };
    const result = serializeCard(row);
    expect(result.description).toBeNull();
    expect(result.assigned_to_user_id).toBeNull();
    expect(result.archived_at).toBeNull();
  });
});
