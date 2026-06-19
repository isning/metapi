import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  buildE2ERunnerConfig,
  createTemporaryE2EDataDir,
  shouldAllocateE2EPort,
  shouldCleanE2EDataDir,
} from './e2eRunnerConfig.js';

describe('e2e runner config', () => {
  it('allocates a random port only for isolated local e2e runs', () => {
    expect(shouldAllocateE2EPort({})).toBe(true);
    expect(shouldAllocateE2EPort({ E2E_PORT: '4900' })).toBe(false);
    expect(shouldAllocateE2EPort({ E2E_BASE_URL: 'http://127.0.0.1:4900' })).toBe(false);
  });

  it('cleans only auto-created local data directories', () => {
    expect(shouldCleanE2EDataDir({})).toBe(true);
    expect(shouldCleanE2EDataDir({ E2E_DATA_DIR: 'tmp/keep-me' })).toBe(false);
    expect(shouldCleanE2EDataDir({ E2E_BASE_URL: 'http://127.0.0.1:4900' })).toBe(false);
  });

  it('builds isolated local runner environment with allocated port and temporary data dir', () => {
    const result = buildE2ERunnerConfig({
      env: { NODE_ENV: 'test' },
      processId: 123,
      allocatedPort: 4567,
    });

    expect(result.shouldCleanDataDir).toBe(true);
    expect(result.env.NODE_ENV).toBe('test');
    expect(result.env.E2E_PORT).toBe('4567');
    expect(result.env.E2E_DATA_DIR).toBe(join('tmp', 'e2e-data-123-4567'));
  });

  it('preserves explicit local port and user data dir', () => {
    const result = buildE2ERunnerConfig({
      env: { E2E_PORT: '4999', E2E_DATA_DIR: 'tmp/manual-e2e' },
      processId: 123,
    });

    expect(result.shouldCleanDataDir).toBe(false);
    expect(result.env.E2E_PORT).toBe('4999');
    expect(result.env.E2E_DATA_DIR).toBe('tmp/manual-e2e');
  });

  it('does not allocate ports or cleanup data dirs for external base URLs', () => {
    const result = buildE2ERunnerConfig({
      env: { E2E_BASE_URL: 'http://127.0.0.1:4999' },
      processId: 123,
    });

    expect(result.shouldCleanDataDir).toBe(false);
    expect(result.env.E2E_PORT).toBeUndefined();
    expect(result.env.E2E_DATA_DIR).toBeUndefined();
  });

  it('fails fast when a local isolated run needs a port but none was allocated', () => {
    expect(() => buildE2ERunnerConfig({ env: {}, processId: 123 }))
      .toThrow(/allocatedPort is required/);
  });

  it('formats temporary data directories deterministically', () => {
    expect(createTemporaryE2EDataDir(777, '4555')).toBe(join('tmp', 'e2e-data-777-4555'));
    expect(createTemporaryE2EDataDir(777, undefined)).toBe(join('tmp', 'e2e-data-777-external'));
  });
});
