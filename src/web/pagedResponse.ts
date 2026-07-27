export type PageInfo = {
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
};

export type PagedResponse<T> = {
  items: T[];
  pageInfo: PageInfo;
};

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid paged response: ${field} must be a finite number`);
  }
  return value;
}

export function normalizePagedResponse<T>(
  response: unknown,
): PagedResponse<T> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Invalid paged response: expected an object');
  }
  const record = response as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    throw new Error('Invalid paged response: items must be an array');
  }
  if (!record.pageInfo || typeof record.pageInfo !== 'object' || Array.isArray(record.pageInfo)) {
    throw new Error('Invalid paged response: pageInfo must be an object');
  }
  const pageInfo = record.pageInfo as Record<string, unknown>;
  if (typeof pageInfo.hasMore !== 'boolean') {
    throw new Error('Invalid paged response: pageInfo.hasMore must be a boolean');
  }
  return {
    ...record,
    items: record.items as T[],
    pageInfo: {
      page: requireFiniteNumber(pageInfo.page, 'pageInfo.page'),
      pageSize: requireFiniteNumber(pageInfo.pageSize, 'pageInfo.pageSize'),
      totalCount: requireFiniteNumber(pageInfo.totalCount, 'pageInfo.totalCount'),
      hasMore: pageInfo.hasMore,
    },
  };
}
