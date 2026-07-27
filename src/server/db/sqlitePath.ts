import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { threadId } from 'node:worker_threads';

function isVitestRuntime(): boolean {
  if ((process.env.VITEST || '').trim().toLowerCase() === 'true') return true;
  if ((process.env.VITEST_POOL_ID || '').trim()) return true;
  if ((process.env.VITEST_WORKER_ID || '').trim()) return true;
  return [...process.argv, ...process.execArgv]
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes('vitest'));
}

function isDefaultRepoDataDir(value: string | undefined): boolean {
  const trimmed = (value || '').trim();
  return !!trimmed && resolve(trimmed) === resolve('./data');
}

/**
 * Resolves the one SQLite path used by both the Drizzle migrator and the
 * runtime client. Vitest workers receive isolated databases without changing
 * application configuration.
 */
export function resolveSqliteDatabasePath(input: {
  dbUrl?: string;
  dataDir?: string;
}): string {
  const raw = (input.dbUrl || '').trim();
  if (raw) {
    if (raw === ':memory:') return raw;
    if (raw.startsWith('file://')) return decodeURIComponent(new URL(raw).pathname);
    if (raw.startsWith('sqlite://')) return resolve(raw.slice('sqlite://'.length).trim());
    return resolve(raw);
  }

  const configuredDataDir = (input.dataDir || '').trim();
  const usesDefaultDataDir = !configuredDataDir || isDefaultRepoDataDir(configuredDataDir);
  if (isVitestRuntime() && usesDefaultDataDir && !process.env.DB_URL) {
    const workerTag = process.env.VITEST_POOL_ID
      || process.env.VITEST_WORKER_ID
      || `${process.pid}-${threadId}`;
    return resolve(tmpdir(), `metapi-vitest-${workerTag}`, 'hub.db');
  }
  if (isVitestRuntime() && configuredDataDir && !usesDefaultDataDir) {
    return resolve(`${configuredDataDir}/hub.db`);
  }
  return resolve(`${configuredDataDir || './data'}/hub.db`);
}
