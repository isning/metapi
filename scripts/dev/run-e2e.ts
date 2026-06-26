import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { preflightExternalBaseUrl } from './e2ePreflight.js';
import { buildE2ERunnerConfig, shouldAllocateE2EPort } from './e2eRunnerConfig.js';

const host = process.env.E2E_HOST || '127.0.0.1';

async function findFreePort(preferredPort: number, bindHost: string): Promise<number> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    const finish = (port: number) => {
      server.close(() => resolve(port));
    };
    server.once('error', () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.listen(0, bindHost, () => {
        const address = fallback.address();
        const port = typeof address === 'object' && address ? address.port : preferredPort + 1;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferredPort, bindHost, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      finish(port);
    });
  });
}

async function main() {
  await preflightExternalBaseUrl(process.env);
  const allocatedPort = shouldAllocateE2EPort(process.env)
    ? await findFreePort(0, host)
    : undefined;
  const { env, shouldCleanDataDir } = buildE2ERunnerConfig({
    env: process.env,
    processId: process.pid,
    allocatedPort,
  });

  const playwrightCli = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
  const cleanupDataDir = async () => {
    if (!shouldCleanDataDir || !env.E2E_DATA_DIR) return;
    await rm(join(process.cwd(), env.E2E_DATA_DIR), { recursive: true, force: true }).catch(() => undefined);
  };
  const child = spawn(
    playwrightCli,
    ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    },
  );
  child.once('error', async (error) => {
    await cleanupDataDir();
    console.error(error);
    process.exit(1);
  });
  child.once('exit', async (code, signal) => {
    await cleanupDataDir();
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
