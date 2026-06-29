import { describe, expect, it } from 'vitest';

import {
  buildConcurrencySweep,
  parsePositiveIntegerList,
  percentile,
  selectRecommendedConcurrency,
  summarizeThroughputRuns,
} from './route-runtime-throughput-benchmark.js';

describe('route runtime throughput benchmark helpers', () => {
  it('parses positive integer lists with sorting and dedupe', () => {
    expect(parsePositiveIntegerList('128, 1, nope, 64, 128, 0', [8])).toEqual([1, 64, 128]);
    expect(parsePositiveIntegerList('', [1, 2])).toEqual([1, 2]);
  });

  it('builds an auto concurrency sweep up to the requested maximum', () => {
    expect(buildConcurrencySweep({ maxConcurrency: 1_500 })).toEqual([
      1,
      2,
      4,
      8,
      16,
      32,
      64,
      128,
      256,
      512,
      1_024,
      1_500,
    ]);
  });

  it('honors an explicit concurrency sweep within the maximum', () => {
    expect(buildConcurrencySweep({
      maxConcurrency: 512,
      explicitSweep: [1024, 128, 1, 128],
    })).toEqual([1, 128]);
  });

  it('computes percentile values from sorted samples', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('summarizes repeats and selects the lowest concurrency near peak throughput', () => {
    const summaries = summarizeThroughputRuns([
      fakeRun({ concurrency: 1, repeat: 1, elapsedQps: 100, cpuQps: 90, p99: 2 }),
      fakeRun({ concurrency: 1, repeat: 2, elapsedQps: 110, cpuQps: 95, p99: 2.5 }),
      fakeRun({ concurrency: 8, repeat: 1, elapsedQps: 950, cpuQps: 900, p99: 5 }),
      fakeRun({ concurrency: 8, repeat: 2, elapsedQps: 1_000, cpuQps: 940, p99: 6 }),
      fakeRun({ concurrency: 16, repeat: 1, elapsedQps: 980, cpuQps: 930, p99: 12 }),
      fakeRun({ concurrency: 16, repeat: 2, elapsedQps: 990, cpuQps: 935, p99: 14 }),
    ]);

    expect(summaries).toMatchObject([
      { concurrency: 1, repeats: 2, medianElapsedQps: 100 },
      { concurrency: 8, repeats: 2, medianElapsedQps: 950 },
      { concurrency: 16, repeats: 2, medianElapsedQps: 980 },
    ]);
    expect(selectRecommendedConcurrency(summaries)).toEqual({
      recommendedConcurrency: 8,
      peakConcurrency: 16,
      peakMedianElapsedQps: 980,
    });
  });
});

function fakeRun(input: {
  concurrency: number;
  repeat: number;
  elapsedQps: number;
  cpuQps: number;
  p99: number;
}) {
  return {
    concurrency: input.concurrency,
    repeat: input.repeat,
    operations: 100,
    failures: 0,
    elapsedMs: 100,
    cpuMs: 100,
    elapsedQps: input.elapsedQps,
    cpuQps: input.cpuQps,
    processCpuUtilization: 90,
    eventLoopUtilization: 80,
    eventLoopDelayP95Ms: 1,
    eventLoopDelayP99Ms: 2,
    latency: {
      minMs: 1,
      p50Ms: 1,
      p95Ms: 1,
      p99Ms: input.p99,
      maxMs: input.p99,
    },
    before: { rssMiB: 1, heapUsedMiB: 1, heapTotalMiB: 1, externalMiB: 1 },
    after: { rssMiB: 1, heapUsedMiB: 1, heapTotalMiB: 1, externalMiB: 1 },
    delta: { rssMiB: 0, heapUsedMiB: 0, heapTotalMiB: 0, externalMiB: 0 },
  };
}
