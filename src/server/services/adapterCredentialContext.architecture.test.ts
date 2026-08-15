import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverRoot = new URL('../', import.meta.url).pathname;

function productionTypeScriptFiles(directory = serverRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

describe('adapter credential context boundary', () => {
  it('keeps persisted credential mapping in the context service', () => {
    const allowed = new Set([
      'services/adapterCredentialContextService.ts',
      'services/platforms/base.ts',
      'services/platforms/testCredentialContext.ts',
    ]);
    const violations = productionTypeScriptFiles().flatMap((path) => {
      const relativePath = relative(serverRoot, path);
      if (allowed.has(relativePath)) return [];
      const source = readFileSync(path, 'utf8');
      const reconstructsContext = /account:\s*\{[^}]*credentialKind:[^}]*extraConfig:/s.test(source)
        && /endpoint:\s*\{\s*baseUrl:/s.test(source)
        && /token:\s*\{[^}]*accountId:[^}]*extraConfig:/s.test(source);
      return reconstructsContext ? [relativePath] : [];
    });

    expect(violations).toEqual([]);
  });

  it('does not expose the removed positional adapter option types', () => {
    const base = readFileSync(new URL('./platforms/base.ts', import.meta.url), 'utf8');
    expect(base).not.toContain('CredentialVerificationOptions');
    expect(base).not.toContain('ManagementCredentialOptions');
  });
});
