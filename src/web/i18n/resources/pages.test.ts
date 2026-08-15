import { describe, expect, it } from 'vitest';
import { pagesResources } from './pages.js';

describe('pages i18n resources', () => {
  it('does not retain obsolete site-level model probing copy', () => {
    for (const locale of [pagesResources.zh, pagesResources.en]) {
      expect(locale).not.toHaveProperty('pages.sites.refreshAutomaticRequest');
      expect(locale).not.toHaveProperty('pages.sites.detectNow');
      expect(locale).not.toHaveProperty('pages.sites.probing');
    }
  });
});
