import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('SQLite migration entrypoints', () => {
  it('routes application and development migrations through the guarded runner', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const restartScript = read('scripts/dev/restart.bat');
    const migrationSource = read('src/server/db/migrate.ts');

    expect(packageJson.scripts?.['db:migrate']).toBe('tsx src/server/db/migrate.ts');
    expect(restartScript).toContain('npm run db:migrate');
    expect(restartScript).not.toMatch(/drizzle-kit\s+(?:push|migrate)/i);
    expect(migrationSource).toContain('better-sqlite3/migrator');
  });
});
