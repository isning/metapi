import { describe, expect, it } from 'vitest';
import { normalizePagedResponse } from './pagedResponse.js';

describe('normalizePagedResponse', () => {
  it('preserves explicit zero totals instead of falling back to item count', () => {
    const result = normalizePagedResponse<{ id: number }>({
      items: [{ id: 1 }],
      pageInfo: {
        page: 1,
        pageSize: 20,
        totalCount: 0,
        hasMore: false,
      },
    }, {
      totalCount: 50_000,
    });

    expect(result.pageInfo).toEqual({
      page: 1,
      pageSize: 20,
      totalCount: 0,
      hasMore: false,
    });
  });
});
