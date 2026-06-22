import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UpstreamCostPricingEditor i18n', () => {
  it('uses semantic i18next keys for user-facing copy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/UpstreamCostPricingEditor.tsx'), 'utf8');

    expect(source).toContain("tr('upstreamCostPricing.title')");
    expect(source).toContain("tr('upstreamCostPricing.rateCard')");
    expect(source).toContain("tr('upstreamCostPricing.scope.siteModel')");
    expect(source).not.toContain('legacy.');

    for (const hardcoded of [
      'Upstream Model Cost',
      'Rate Card',
      'Input / 1M',
      'Output / 1M',
      'Cache read / 1M',
      'Request fee',
      'Token group',
    ]) {
      expect(source).not.toContain(hardcoded);
    }
  });
});
