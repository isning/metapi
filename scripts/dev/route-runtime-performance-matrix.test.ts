import { describe, expect, it } from 'vitest';

import {
  normalizeCpuProfiles,
  parsePositiveIntegerList,
  shouldAcceptWorkerReport,
  summarizeMeasurements,
} from './route-runtime-performance-matrix.js';

describe('route runtime performance matrix helpers', () => {
  it('parses positive integer lists with stable sorting and dedupe', () => {
    expect(parsePositiveIntegerList('4, 1, nope, 2, 4, 0, -1', [8])).toEqual([1, 2, 4]);
    expect(parsePositiveIntegerList('', [1, 2])).toEqual([1, 2]);
    expect(parsePositiveIntegerList(undefined, [1, 2])).toEqual([1, 2]);
  });

  it('builds taskset cpu profiles from requested vcpu counts', () => {
    expect(normalizeCpuProfiles({
      requestedVcpus: [1, 2, 8],
      availableCpuCount: 4,
      tasksetAvailable: true,
      includeUnrestricted: false,
    })).toEqual([
      { label: 'vcpu-1', vcpus: 1, cpuSet: '0', usesTaskset: true },
      { label: 'vcpu-2', vcpus: 2, cpuSet: '0-1', usesTaskset: true },
      { label: 'vcpu-4', vcpus: 4, cpuSet: '0-3', usesTaskset: true },
    ]);
  });

  it('falls back to unrestricted mode when taskset is unavailable', () => {
    expect(normalizeCpuProfiles({
      requestedVcpus: [1, 2],
      availableCpuCount: 4,
      tasksetAvailable: false,
      includeUnrestricted: false,
    })).toEqual([
      { label: 'unrestricted', vcpus: null, cpuSet: null, usesTaskset: false },
    ]);
  });

  it('can include an unrestricted baseline beside taskset cpu profiles', () => {
    expect(normalizeCpuProfiles({
      requestedVcpus: [1],
      availableCpuCount: 4,
      tasksetAvailable: true,
      includeUnrestricted: true,
    })).toEqual([
      { label: 'vcpu-1', vcpus: 1, cpuSet: '0', usesTaskset: true },
      { label: 'unrestricted', vcpus: null, cpuSet: null, usesTaskset: false },
    ]);
  });

  it('accepts failed worker exits only when the gate report records budget failure', () => {
    expect(shouldAcceptWorkerReport(0, { status: 'passed' })).toBe(true);
    expect(shouldAcceptWorkerReport(1, { status: 'failed' })).toBe(true);
    expect(shouldAcceptWorkerReport(1, { status: 'passed' })).toBe(false);
    expect(shouldAcceptWorkerReport(null, { status: 'failed' })).toBe(false);
  });

  it('summarizes worker measurements into aggregate qps statistics', () => {
    const summary = summarizeMeasurements([
      {
        label: 'concurrent distinct cold models x12800 (2048-wide)',
        operations: 100,
        elapsedMs: 100,
        cpuMs: 50,
        elapsedQps: 1000,
        cpuQps: 2000,
        avgCpuMs: 0.5,
      },
      {
        label: 'concurrent distinct cold models x12800 (2048-wide)',
        operations: 100,
        elapsedMs: 200,
        cpuMs: 100,
        elapsedQps: 500,
        cpuQps: 1000,
        avgCpuMs: 1,
      },
    ]);

    expect(summary).toMatchObject({
      operations: 200,
      maxMeasuredElapsedMs: 200,
      sumMeasuredCpuMs: 150,
      measuredElapsedQps: 1000,
      cpuQps: 1333.33,
      workerCpuQpsMin: 1000,
      workerCpuQpsMedian: 1000,
      workerCpuQpsP95: 2000,
      workerCpuQpsMax: 2000,
    });
  });
});
