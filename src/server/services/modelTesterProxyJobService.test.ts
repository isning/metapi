import { describe, expect, it, vi } from 'vitest';
import type { ValidatedModelTesterProxyEnvelope } from '../contracts/modelTesterProxyPayload.js';
import { ModelTesterProxyJobService } from './modelTesterProxyJobService.js';

const envelope: ValidatedModelTesterProxyEnvelope = {
  method: 'POST',
  path: '/v1/responses',
  requestKind: 'json',
  rawMode: false,
  jsonBody: { model: 'gpt-test' },
  stream: false,
  jobMode: true,
  forcedExecutionAttemptId: null,
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ModelTesterProxyJobService', () => {
  it('owns pending-to-success transitions and exposes the shared job DTO', async () => {
    let resolveExecution!: (value: unknown) => void;
    const execute = vi.fn(() => new Promise((resolve) => { resolveExecution = resolve; }));
    let now = 1_000;
    const service = new ModelTesterProxyJobService(execute, () => now, 10_000, 1_000);

    const created = service.start(envelope);
    expect(service.get(created.jobId)).toMatchObject({ status: 'pending' });
    resolveExecution({ ok: true });
    now = 2_000;
    await settle();

    expect(service.get(created.jobId)).toMatchObject({
      jobId: created.jobId,
      status: 'succeeded',
      result: { ok: true },
      updatedAt: new Date(2_000).toISOString(),
      expiresAt: new Date(12_000).toISOString(),
    });
    expect(execute).toHaveBeenCalledWith(envelope, {
      signal: expect.any(AbortSignal),
      forceStream: false,
    });
  });

  it('owns deletion, abort and expiration without leaking job state into routes', () => {
    let now = 1_000;
    const execute = vi.fn((_input, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }));
    const service = new ModelTesterProxyJobService(execute, () => now, 10_000, 1_000);
    const deleted = service.start(envelope);
    expect(service.delete(deleted.jobId)).toBe(true);
    expect(service.get(deleted.jobId)).toBeNull();

    const expired = service.start(envelope);
    now = 11_001;
    service.cleanupExpired();
    expect(service.get(expired.jobId)).toBeNull();
  });
});
