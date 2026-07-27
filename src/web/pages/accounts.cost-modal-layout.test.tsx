import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Account model cost pricing modal layout', () => {
  it('keeps the dialog within the viewport and scrolls the pricing editor body', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/accounts/AccountModelsModal.tsx'), 'utf8');

    expect(source).toContain('w-[min(94vw,980px)] overflow-hidden p-0');
    expect(source).toContain('shrink-0 border-b px-5 py-4');
    expect(source).toContain('min-h-0 overflow-y-auto px-5 py-4');
    expect(source).toContain('<UpstreamCostPricingEditor');
  });
});
