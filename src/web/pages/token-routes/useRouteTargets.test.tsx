import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import type { RouteEndpointTarget } from './types.js';
import { useRouteTargets } from './useRouteTargets.js';

vi.mock('../../api.js', () => ({
  api: {
    getRouteTargets: vi.fn(),
  },
}));

type HookState = ReturnType<typeof useRouteTargets>;

let latest: HookState | null = null;

function Probe() {
  latest = useRouteTargets();
  return null;
}

function buildTarget(id: number, priority: number): RouteEndpointTarget {
  return {
    id,
    routeId: 11,
    accountId: id,
    tokenId: null,
    sourceModel: `model-${id}`,
    priority,
    weight: 10,
    enabled: true,
    manualOverride: false,
    successCount: 0,
    failCount: 0,
  };
}

async function renderProbe() {
  let root!: WebTestRenderer;
  await act(async () => {
    root = create(<Probe />);
  });
  return root;
}

describe('useRouteTargets', () => {
  beforeEach(() => {
    latest = null;
    vi.mocked(api.getRouteTargets).mockReset();
  });

  it('loads, normalizes, caches, and invalidates targets by route id', async () => {
    vi.mocked(api.getRouteTargets)
      .mockResolvedValueOnce([buildTarget(2, 2), buildTarget(1, 1)])
      .mockResolvedValueOnce([buildTarget(3, 0)])
      .mockResolvedValueOnce([buildTarget(4, 0)]);
    const root = await renderProbe();

    await act(async () => {
      await latest!.loadTargets(11);
    });

    expect(api.getRouteTargets).toHaveBeenCalledTimes(1);
    expect(latest!.targetsByRouteId[11].map((target) => target.id)).toEqual([1, 2]);
    expect(latest!.loadingTargetsByRouteId[11]).toBe(false);

    await act(async () => {
      await latest!.loadTargets(11);
    });

    expect(api.getRouteTargets).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest!.loadTargets(11, true);
    });

    expect(api.getRouteTargets).toHaveBeenCalledTimes(2);
    expect(latest!.targetsByRouteId[11].map((target) => target.id)).toEqual([3]);

    await act(async () => {
      latest!.invalidateTargets(11);
    });

    expect(latest!.targetsByRouteId[11]).toBeUndefined();

    await act(async () => {
      await latest!.loadTargets(11);
    });

    expect(api.getRouteTargets).toHaveBeenCalledTimes(3);
    expect(latest!.targetsByRouteId[11].map((target) => target.id)).toEqual([4]);

    await act(async () => {
      latest!.invalidateTargets();
    });

    expect(latest!.targetsByRouteId).toEqual({});

    await act(async () => {
      root.unmount();
    });
  });

  it('allows callers to replace targets locally', async () => {
    const root = await renderProbe();

    await act(async () => {
      latest!.setTargets(22, [buildTarget(9, 0)]);
    });

    expect(latest!.targetsByRouteId[22].map((target) => target.id)).toEqual([9]);

    await act(async () => {
      root.unmount();
    });
  });

  it('clears loading state and rethrows load failures', async () => {
    const error = new Error('network failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.getRouteTargets).mockRejectedValueOnce(error);
    const root = await renderProbe();

    await expect(act(async () => {
      await latest!.loadTargets(33);
    })).rejects.toThrow('network failed');

    expect(latest!.loadingTargetsByRouteId[33]).toBe(false);
    expect(latest!.targetsByRouteId[33]).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});
