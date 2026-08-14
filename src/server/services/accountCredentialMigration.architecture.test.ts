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

describe('account credential migration ownership', () => {
  it('keeps legacy account credential interpretation out of runtime services', () => {
    const allowed = new Set([
      'services/backupAccountCredentialMigration.ts',
    ]);
    const violations = productionTypeScriptFiles().flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const relativePath = relative(serverRoot, path);
      if (allowed.has(relativePath)) return [];
      const ownsLegacyMigration = source.includes('getCredentialModeFromExtraConfig')
        || /extraConfig(?:\.|\[['"])(?:credentialMode|authType)/.test(source)
        || /delete\s+\w+\.(?:accessToken|apiToken|access_token|api_token|credentialMode|authType)/.test(source)
        || /schema\.accounts\.(?:accessToken|apiToken)/.test(source)
        || /\b(?:account|accounts|row)\??\.(?:accessToken|apiToken|modelApiKey)\b/.test(source)
        || /\blegacyModelToken\b/.test(source)
        || source.includes('legacy_backup_account_credential');
      return ownsLegacyMigration ? [relativePath] : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps backup credential data rewriting behind the dedicated migration module', () => {
    const backupService = readFileSync(new URL('./backupService.ts', import.meta.url), 'utf8');
    const routeMigration = readFileSync(new URL('./backupImportMigration.ts', import.meta.url), 'utf8');

    expect(backupService).toContain('migrateImportedAccountCredential(');
    expect(backupService).toContain('reconcileImportedAccountCredentialTokens(');
    expect(backupService).not.toMatch(/delete\s+\w+\.(?:accessToken|apiToken|credentialMode|authType)/);
    expect(backupService).not.toContain('legacy_backup_account_credential');
    expect(routeMigration).not.toContain('migrateImportedAccountCredential');
    expect(routeMigration).not.toContain('legacyModelToken');
  });

  it('keeps database legacy cleanup in versioned migrations, not startup compatibility shims', () => {
    const compatibility = readFileSync(new URL('../db/accountTokenSchemaCompatibility.ts', import.meta.url), 'utf8');
    const bootstrap = readFileSync(new URL('../db/schemaBootstrapCompatibility.ts', import.meta.url), 'utf8');

    expect(compatibility).not.toContain('ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS');
    expect(compatibility).not.toContain('a.api_token');
    expect(bootstrap).not.toContain('ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS');
  });

  it('keeps OAuth identity compatibility owned by its dedicated backfill module', () => {
    const oauthAccount = readFileSync(new URL('./oauth/oauthAccount.ts', import.meta.url), 'utf8');
    const oauthBackfill = readFileSync(new URL('./oauth/oauthIdentityBackfill.ts', import.meta.url), 'utf8');
    const oauthService = readFileSync(new URL('./oauth/service.ts', import.meta.url), 'utf8');
    const serverIndex = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    expect(oauthAccount).not.toContain('buildOauthIdentityBackfillPatch');
    expect(oauthBackfill).toContain('function buildOauthIdentityBackfillPatch(');
    expect(oauthBackfill).toContain('buildOauthIdentityBackfillPatch(row)');
    expect(oauthBackfill).toContain('ensureOauthIdentityBackfill');
    expect(oauthService).toContain('await ensureOauthIdentityBackfill()');
    expect(serverIndex).toContain('await ensureOauthIdentityBackfill()');
  });
});
