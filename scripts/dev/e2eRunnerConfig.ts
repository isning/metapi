import { join } from 'node:path';

export type E2ERunnerEnv = Pick<NodeJS.ProcessEnv, 'E2E_BASE_URL' | 'E2E_PORT' | 'E2E_DATA_DIR'>;

export type E2ERunnerConfig = {
  env: NodeJS.ProcessEnv;
  shouldCleanDataDir: boolean;
};

export function shouldAllocateE2EPort(env: E2ERunnerEnv): boolean {
  return !env.E2E_BASE_URL && !env.E2E_PORT;
}

export function shouldCleanE2EDataDir(env: E2ERunnerEnv): boolean {
  return !env.E2E_BASE_URL && !env.E2E_DATA_DIR;
}

export function createTemporaryE2EDataDir(processId: number, port: string | undefined): string {
  return join('tmp', `e2e-data-${processId}-${port || 'external'}`);
}

export function buildE2ERunnerConfig(input: {
  env: NodeJS.ProcessEnv;
  processId: number;
  allocatedPort?: number;
}): E2ERunnerConfig {
  const env = { ...input.env };
  if (shouldAllocateE2EPort(env)) {
    if (!input.allocatedPort) throw new Error('allocatedPort is required when E2E_PORT is not set');
    env.E2E_PORT = String(input.allocatedPort);
  }

  const shouldCleanDataDir = shouldCleanE2EDataDir(env);
  if (shouldCleanDataDir) {
    env.E2E_DATA_DIR = createTemporaryE2EDataDir(input.processId, env.E2E_PORT);
  }

  return {
    env,
    shouldCleanDataDir,
  };
}
