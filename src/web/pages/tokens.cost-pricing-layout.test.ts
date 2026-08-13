import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tokens model cost entry', () => {
  it('locks the token-page editor to the current token pricing scopes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/tokens/TokensPanel.tsx'), 'utf8');

    expect(source).toContain('api.getAccountTokenModels(Number(token.id))');
    expect(source).toContain('api.refreshAccountTokenModels(Number(tokenModelsSubject.token.id))');
    expect(source).toContain("accountModelsModal.modelManagement");
    expect(source).toContain('allowedScopes={TOKEN_COST_PRICING_SCOPES}');
    expect(source).toContain('initialScope="token_model"');
    expect(source).toContain('fixedTokenId={tokenCostSubject.token.id}');
  });
});
