import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('account token route architecture boundaries', () => {
  it('keeps migration token repair out of the account token route controller', () => {
    const source = readSource('./accountTokens.ts');
    expect(source).not.toContain('rebuildRoutes: true');
    expect(source).not.toContain("defaultTokenSource: 'legacy'");
    expect(source).not.toContain("source: 'legacy'");
    expect(source).not.toContain('legacy_default_token_restored');
  });

  it('delegates destructive token workflows to the command service', () => {
    const source = readSource('./accountTokens.ts');
    const commandSource = readSource('../../services/accountTokenCommandService.ts');
    expect(source).toContain("from '../../services/accountTokenCommandService.js'");
    expect(source).not.toContain('adapter!.deleteApiToken');
    expect(source).not.toContain("db.delete(schema.accountTokens)");
    expect(commandSource).not.toContain('fastify');
    expect(commandSource).not.toContain('/routes/');
  });
});
