import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tokens model cost entry', () => {
  it('uses the shared account model management surface with the current token selected', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/tokens/TokensPanel.tsx'), 'utf8');

    expect(source).toContain('import AccountModelsModal from');
    expect(source).toContain('api.getAccountModels(Number(token.accountId))');
    expect(source).toContain('initialTokenId={tokenAccountModelModal.tokenId}');
    expect(source).toContain('api.refreshAccountTokenModels(tokenId)');
    expect(source).toContain('api.updateAccountTokenDisabledModels(targetTokenId, Array.from(disabledModels))');
    expect(source).toContain('api.addAccountTokenAvailableModels(targetTokenId, models)');
  });
});
