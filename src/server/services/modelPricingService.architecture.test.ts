import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('modelPricingService architecture boundaries', () => {
  it('keeps upstream catalog transport behind the platform pricing catalog seam', () => {
    const source = readSource('./modelPricingService.ts');

    expect(source).toContain("from './upstreamPricingCatalogService.js'");
    expect(source).not.toContain("from './platforms/");
    expect(source).not.toContain("from './siteProxy.js'");
    expect(source).not.toContain("from './platforms/newApiShield.js'");
    expect(source).not.toContain('/api/pricing');
    expect(source).not.toContain('/api/available_model');
    expect(source).not.toContain('fetchJson');
  });

  it('keeps pricing catalog discovery at the platform adapter seam', () => {
    const source = readSource('./upstreamPricingCatalogService.ts');

    expect(source).toContain("from './platforms/index.js'");
    expect(source).not.toContain("from './siteProxy.js'");
    expect(source).not.toContain("from './platforms/newApiShield.js'");
    expect(source).not.toContain('/api/pricing');
    expect(source).not.toContain('/api/available_model');
    expect(source).not.toContain('undici');
  });
});
