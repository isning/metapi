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

function normalizeNumber(
  value: unknown,
  fallback: unknown,
  finalFallback: number,
): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) ? fallbackParsed : finalFallback;
}

export function normalizePagedResponse<T>(
  response: unknown,
  fallbackPageInfo: Partial<PageInfo> = {},
): PagedResponse<T> {
  if (Array.isArray(response)) {
    const pageInfo = (response as unknown as { pageInfo?: Partial<PageInfo> }).pageInfo || {};
    return {
      items: response as T[],
      pageInfo: {
        page: normalizeNumber(pageInfo.page, fallbackPageInfo.page, 1),
        pageSize: normalizeNumber(pageInfo.pageSize, fallbackPageInfo.pageSize, response.length),
        totalCount: normalizeNumber(pageInfo.totalCount, fallbackPageInfo.totalCount, response.length),
        hasMore: Boolean(pageInfo.hasMore ?? fallbackPageInfo.hasMore),
      },
    };
  }

  const record = response && typeof response === 'object'
    ? response as { items?: unknown; pageInfo?: Partial<PageInfo> }
    : {};
  const items = Array.isArray(record.items) ? record.items as T[] : [];
  const pageInfo = record.pageInfo || {};
  return {
    ...record,
    items,
    pageInfo: {
      page: normalizeNumber(pageInfo.page, fallbackPageInfo.page, 1),
      pageSize: normalizeNumber(pageInfo.pageSize, fallbackPageInfo.pageSize, items.length),
      totalCount: normalizeNumber(pageInfo.totalCount, fallbackPageInfo.totalCount, items.length),
      hasMore: Boolean(pageInfo.hasMore ?? fallbackPageInfo.hasMore),
    },
  };
}
