import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

type RuntimeDbModule = typeof import('../server/db/index.js');

export type TestDataDirHandle = {
  path: string;
  previousDataDir: string | undefined;
  previousDbType: string | undefined;
  previousDbUrl: string | undefined;
  cleanup: () => void;
};

export type IsolatedRuntimeDbHandle = TestDataDirHandle & {
  db: RuntimeDbModule['db'];
  schema: RuntimeDbModule['schema'];
  dbModule: RuntimeDbModule;
  cleanup: () => Promise<void>;
};

export function createIsolatedDataDir(prefix = 'metapi-test-'): TestDataDirHandle {
  const previousDataDir = process.env.DATA_DIR;
  const previousDbType = process.env.DB_TYPE;
  const previousDbUrl = process.env.DB_URL;
  const path = mkdtempSync(join(tmpdir(), prefix));
  process.env.DATA_DIR = path;
  process.env.DB_TYPE = 'sqlite';
  delete process.env.DB_URL;

  return {
    path,
    previousDataDir,
    previousDbType,
    previousDbUrl,
    cleanup: () => {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      if (previousDbType === undefined) {
        delete process.env.DB_TYPE;
      } else {
        process.env.DB_TYPE = previousDbType;
      }
      if (previousDbUrl === undefined) {
        delete process.env.DB_URL;
      } else {
        process.env.DB_URL = previousDbUrl;
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}

export async function bootIsolatedRuntimeDb(prefix = 'metapi-integration-'): Promise<IsolatedRuntimeDbHandle> {
  const dataDir = createIsolatedDataDir(prefix);

  try {
    vi.resetModules();
    await import('../server/db/migrate.js');
    const dbModule = await import('../server/db/index.js');
    return {
      ...dataDir,
      db: dbModule.db,
      schema: dbModule.schema,
      dbModule,
      cleanup: async () => {
        await dbModule.closeDbConnections();
        dataDir.cleanup();
      },
    };
  } catch (error) {
    dataDir.cleanup();
    throw error;
  }
}

export async function closeFastifyApp(app: FastifyInstance | null | undefined): Promise<void> {
  if (!app) return;
  await app.close();
}
