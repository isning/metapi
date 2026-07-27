import { describe, expect, it } from 'vitest';
import {
  MODEL_DETAILS_SUMMARY_RANGE,
  modelDetailsResourceKey,
  modelDetailsResourcesFor,
} from './modelDetailsResourcePolicy.js';

describe('modelDetailsResourcePolicy', () => {
  it('prefetches diagnostics entries without prefetching full route flow', () => {
    const resources = modelDetailsResourcesFor({
      model: 'gpt-4o',
      tab: 'diagnostics',
      range: '6h',
      phase: 'prefetch',
    });

    expect(resources.map(modelDetailsResourceKey)).toEqual([
      'route-diagnostics:gpt-4o',
    ]);
  });

  it('activates diagnostics with full route flow for the JSON payload', () => {
    const resources = modelDetailsResourcesFor({
      model: 'gpt-4o',
      tab: 'diagnostics',
      range: '6h',
      phase: 'activate',
    });

    expect(resources.map(modelDetailsResourceKey)).toEqual([
      'route-flow:gpt-4o',
    ]);
  });

  it('loads summary and selected range observability for performance', () => {
    const resources = modelDetailsResourcesFor({
      model: 'gpt-4o',
      tab: 'performance',
      range: '5m',
      phase: 'activate',
    });

    expect(resources.map(modelDetailsResourceKey)).toEqual([
      `runtime-observability:gpt-4o:${MODEL_DETAILS_SUMMARY_RANGE}`,
      'runtime-observability:gpt-4o:5m',
    ]);
  });
});
