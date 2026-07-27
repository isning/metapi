import { randomUUID } from 'node:crypto';
import type { ValidatedModelTesterProxyEnvelope } from '../contracts/modelTesterProxyPayload.js';
import type {
  ModelTesterProxyJob,
  ModelTesterProxyJobCreated,
  ModelTesterProxyJobStatus,
} from '../../shared/modelTesterProxy.js';
import {
  executeModelTesterProxyBuffered,
  ModelTesterTransportError,
  ModelTesterUpstreamError,
} from '../proxy-core/surfaces/modelTesterProxySurface.js';

type StoredJob = {
  id: string;
  status: ModelTesterProxyJobStatus;
  envelope: ValidatedModelTesterProxyEnvelope;
  result?: unknown;
  error?: unknown;
  controller: AbortController | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

type BufferedExecutor = typeof executeModelTesterProxyBuffered;

export class ModelTesterProxyJobService {
  private readonly jobs = new Map<string, StoredJob>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly executeBuffered: BufferedExecutor = executeModelTesterProxyBuffered,
    private readonly now: () => number = Date.now,
    private readonly jobTtlMs = 10 * 60 * 1000,
    private readonly cleanupIntervalMs = 60 * 1000,
  ) {}

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  stopCleanup(): void {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  start(envelope: ValidatedModelTesterProxyEnvelope): ModelTesterProxyJobCreated {
    const timestamp = this.now();
    const job: StoredJob = {
      id: randomUUID(),
      status: 'pending',
      envelope,
      controller: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + this.jobTtlMs,
    };
    this.jobs.set(job.id, job);
    void this.run(job.id);
    return {
      jobId: job.id,
      status: 'pending',
      createdAt: new Date(job.createdAt).toISOString(),
      expiresAt: new Date(job.expiresAt).toISOString(),
    };
  }

  get(jobId: string): ModelTesterProxyJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      expiresAt: new Date(job.expiresAt).toISOString(),
    };
  }

  delete(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.controller?.abort();
    return this.jobs.delete(jobId);
  }

  cleanupExpired(): void {
    const timestamp = this.now();
    for (const [jobId, job] of this.jobs) {
      if (job.expiresAt <= timestamp) this.jobs.delete(jobId);
    }
  }

  private async run(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') return;
    const controller = new AbortController();
    job.controller = controller;
    try {
      const result = await this.executeBuffered(job.envelope, {
        signal: controller.signal,
        forceStream: job.envelope.stream,
      });
      this.finish(jobId, 'succeeded', { result });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        this.finish(jobId, 'cancelled', {
          error: { success: false, code: 'model_tester_job_cancelled', params: {} },
        }, 30_000);
        return;
      }
      this.finish(jobId, 'failed', {
        error: error instanceof ModelTesterUpstreamError
          ? error.responsePayload
          : {
              success: false,
              code: error instanceof ModelTesterTransportError
                ? error.code
                : 'model_tester_transport_failed',
              params: {},
            },
      });
    }
  }

  private finish(
    jobId: string,
    status: Exclude<ModelTesterProxyJobStatus, 'pending'>,
    values: { result?: unknown; error?: unknown },
    ttlMs = this.jobTtlMs,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const timestamp = this.now();
    Object.assign(job, values, {
      status,
      controller: null,
      updatedAt: timestamp,
      expiresAt: timestamp + ttlMs,
    });
  }
}
