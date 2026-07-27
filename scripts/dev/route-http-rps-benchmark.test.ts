import { describe, expect, it } from 'vitest';

import {
  selectRecommendedConnections,
  summarizeHttpRuns,
} from './route-http-rps-benchmark.js';

describe('route HTTP RPS benchmark helpers', () => {
  it('summarizes repeated autocannon runs and selects the lowest near-peak connection count', () => {
    const summaries = summarizeHttpRuns([
      fakeRun({ connections: 1, repeat: 1, rps: 100, cpuRps: 90, p99: 2 }),
      fakeRun({ connections: 1, repeat: 2, rps: 110, cpuRps: 95, p99: 2.5 }),
      fakeRun({ connections: 64, repeat: 1, rps: 1_900, cpuRps: 1_500, p99: 8 }),
      fakeRun({ connections: 64, repeat: 2, rps: 2_000, cpuRps: 1_600, p99: 9 }),
      fakeRun({ connections: 128, repeat: 1, rps: 1_980, cpuRps: 1_550, p99: 18 }),
      fakeRun({ connections: 128, repeat: 2, rps: 1_990, cpuRps: 1_580, p99: 20 }),
    ]);

    expect(summaries).toMatchObject([
      { connections: 1, repeats: 2, medianRps: 100 },
      { connections: 64, repeats: 2, medianRps: 1900 },
      { connections: 128, repeats: 2, medianRps: 1980 },
    ]);
    expect(selectRecommendedConnections(summaries)).toEqual({
      recommendedConnections: 64,
      peakConnections: 128,
      peakMedianRps: 1980,
    });
  });
});

function fakeRun(input: {
  connections: number;
  repeat: number;
  rps: number;
  cpuRps: number;
  p99: number;
}) {
  return {
    connections: input.connections,
    repeat: input.repeat,
    requests: 100,
    rps: input.rps,
    serverCpuMs: 100,
    serverCpuRps: input.cpuRps,
    serverCpuUtilization: 90,
    eventLoopUtilization: 80,
    eventLoopDelayP99Ms: 1,
    latency: {
      averageMs: 1,
      p50Ms: 1,
      p97_5Ms: 1,
      p99Ms: input.p99,
      maxMs: input.p99,
    },
    throughputBytesPerSec: 1024,
    errors: 0,
    timeouts: 0,
    non2xx: 0,
    statusCodeStats: { '200': { count: 100 } },
    before: { rssMiB: 1, heapUsedMiB: 1, heapTotalMiB: 1, externalMiB: 1 },
    after: { rssMiB: 1, heapUsedMiB: 1, heapTotalMiB: 1, externalMiB: 1 },
    delta: { rssMiB: 0, heapUsedMiB: 0, heapTotalMiB: 0, externalMiB: 0 },
  };
}
