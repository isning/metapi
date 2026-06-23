import { describe, expect, it } from 'vitest';
import {
  clampRouteListPage,
  getRouteListPageNumbers,
  getRouteListPageWindow,
  getRouteListTotalPages,
  normalizePageSize,
} from './progressiveRender.js';

describe('route list pagination', () => {
  it('normalizes page sizes and total pages', () => {
    expect(normalizePageSize(40)).toBe(40);
    expect(normalizePageSize(0)).toBe(1);
    expect(getRouteListTotalPages(0, 40)).toBe(1);
    expect(getRouteListTotalPages(10, 40)).toBe(1);
    expect(getRouteListTotalPages(120, 40)).toBe(3);
  });

  it('clamps the current page to available pages', () => {
    expect(clampRouteListPage(0, 120, 40)).toBe(1);
    expect(clampRouteListPage(2, 120, 40)).toBe(2);
    expect(clampRouteListPage(8, 120, 40)).toBe(3);
  });

  it('returns list slice bounds and displayed item numbers', () => {
    expect(getRouteListPageWindow({ page: 1, total: 144, pageSize: 40 })).toMatchObject({
      safePage: 1,
      totalPages: 4,
      startIndex: 0,
      endIndex: 40,
      displayedStart: 1,
      displayedEnd: 40,
    });
    expect(getRouteListPageWindow({ page: 4, total: 144, pageSize: 40 })).toMatchObject({
      safePage: 4,
      totalPages: 4,
      startIndex: 120,
      endIndex: 144,
      displayedStart: 121,
      displayedEnd: 144,
    });
  });

  it('keeps page number buttons centered around the active page', () => {
    expect(getRouteListPageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(getRouteListPageNumbers(5, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(getRouteListPageNumbers(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});
