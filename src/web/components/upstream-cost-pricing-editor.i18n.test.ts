import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UpstreamCostPricingEditor i18n', () => {
  it('uses semantic i18next keys for user-facing copy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/UpstreamCostPricingEditor.tsx'), 'utf8');

    expect(source).toContain("tr('upstreamCostPricing.title')");
    expect(source).toContain("tr('upstreamCostPricing.rateCard')");
    expect(source).toContain("tr('upstreamCostPricing.activeCost')");
    expect(source).toContain("tr('upstreamCostPricing.manualConfigurations')");
    expect(source).toContain("tr('upstreamCostPricing.previewComponentCost')");
    expect(source).toContain("tr('upstreamCostPricing.pricingMode.tiered')");
    expect(source).toContain('accountId: accountId ?? undefined');
    expect(source).not.toContain('tokenId: fixedTokenId ?? undefined');
    expect(source).toContain('availableTokens.find((token) => token.id === fixedTokenId)');
    expect(source).toContain('Promise.all([loadRecords(), refreshPreview()])');
    expect(source).toContain('const [activePreview, setActivePreview]');
    expect(source).toContain('const [draftPreview, setDraftPreview]');
    expect(source).toContain('previewComponents(activePreview)');
    expect(source).toContain('previewTotal(draftPreview)');
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
