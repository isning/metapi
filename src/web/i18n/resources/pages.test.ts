import { describe, expect, it } from 'vitest';
import { pagesResources } from './pages.js';

describe('pages i18n resources', () => {
  it('labels the shared site latency metric as observed latency, not threshold', () => {
    expect(pagesResources.zh['pages.sites.latency']).toBe('延迟');
    expect(pagesResources.zh['pages.sites.latency']).not.toContain('阈值');
    expect(pagesResources.en['pages.sites.latency']).toBe('Latency');
  });
});
