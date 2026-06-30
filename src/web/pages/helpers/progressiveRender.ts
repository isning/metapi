export function normalizePageSize(pageSize: number): number {
  return Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : 1;
}

export function getRouteListTotalPages(total: number, pageSize: number): number {
  const normalizedTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  return Math.max(1, Math.ceil(normalizedTotal / normalizePageSize(pageSize)));
}

export function clampRouteListPage(page: number, total: number, pageSize: number): number {
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1;
  return Math.min(normalizedPage, getRouteListTotalPages(total, pageSize));
}

export function getRouteListPageWindow(input: {
  page: number;
  total: number;
  pageSize: number;
}): {
  safePage: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  displayedStart: number;
  displayedEnd: number;
} {
  const normalizedTotal = Number.isFinite(input.total) && input.total > 0 ? Math.trunc(input.total) : 0;
  const pageSize = normalizePageSize(input.pageSize);
  const totalPages = getRouteListTotalPages(normalizedTotal, pageSize);
  const safePage = clampRouteListPage(input.page, normalizedTotal, pageSize);
  const startIndex = normalizedTotal === 0 ? 0 : (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, normalizedTotal);
  return {
    safePage,
    totalPages,
    startIndex,
    endIndex,
    displayedStart: normalizedTotal === 0 ? 0 : startIndex + 1,
    displayedEnd: endIndex,
  };
}

export function getRouteListPageNumbers(currentPage: number, totalPages: number, maxPages = 5): number[] {
  const normalizedTotalPages = Math.max(1, Math.trunc(Number.isFinite(totalPages) ? totalPages : 1));
  const normalizedMaxPages = Math.max(1, Math.trunc(Number.isFinite(maxPages) ? maxPages : 5));
  const count = Math.min(normalizedTotalPages, normalizedMaxPages);
  const safePage = Math.min(
    Math.max(1, Math.trunc(Number.isFinite(currentPage) ? currentPage : 1)),
    normalizedTotalPages,
  );
  let start = Math.max(1, safePage - Math.floor(count / 2));
  start = Math.min(start, Math.max(1, normalizedTotalPages - count + 1));
  return Array.from({ length: count }, (_, index) => start + index);
}

export type RouteListPageItem =
  | { type: 'page'; page: number }
  | { type: 'ellipsis'; key: 'start-ellipsis' | 'end-ellipsis' };

export function getRouteListPageItems(currentPage: number, totalPages: number, siblingCount = 1): RouteListPageItem[] {
  const normalizedTotalPages = Math.max(1, Math.trunc(Number.isFinite(totalPages) ? totalPages : 1));
  const normalizedSiblingCount = Math.max(0, Math.trunc(Number.isFinite(siblingCount) ? siblingCount : 1));
  const safePage = Math.min(
    Math.max(1, Math.trunc(Number.isFinite(currentPage) ? currentPage : 1)),
    normalizedTotalPages,
  );
  const visiblePageBudget = 2 + (normalizedSiblingCount * 2) + 3;
  if (normalizedTotalPages <= visiblePageBudget) {
    return Array.from({ length: normalizedTotalPages }, (_, index) => ({
      type: 'page',
      page: index + 1,
    }));
  }

  const pages = new Set<number>([1, normalizedTotalPages]);
  const siblingStart = Math.max(
    Math.min(
      safePage - normalizedSiblingCount,
      normalizedTotalPages - 1 - (normalizedSiblingCount * 2),
    ),
    2,
  );
  const siblingEnd = Math.min(
    Math.max(
      safePage + normalizedSiblingCount,
      2 + (normalizedSiblingCount * 2),
    ),
    normalizedTotalPages - 1,
  );

  for (let page = siblingStart; page <= siblingEnd; page += 1) {
    pages.add(page);
  }

  const sortedPages = Array.from(pages).sort((left, right) => left - right);
  const items: RouteListPageItem[] = [];
  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (previous?.type === 'page' && page - previous.page > 1) {
      items.push({ type: 'ellipsis', key: previous.page === 1 ? 'start-ellipsis' : 'end-ellipsis' });
    }
    items.push({ type: 'page', page });
  }
  return items;
}
