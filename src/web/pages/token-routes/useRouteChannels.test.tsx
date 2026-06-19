import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api.js';
import type { RouteChannel } from './types.js';
import { useRouteChannels } from './useRouteChannels.js';

vi.mock('../../api.js', () => ({
  api: {
    getRouteChannels: vi.fn(),
  },
}));

type HookState = ReturnType<typeof useRouteChannels>;

let latest: HookState | null = null;

function Probe() {
  latest = useRouteChannels();
  return null;
}

function buildChannel(id: number, priority: number): RouteChannel {
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

describe('useRouteChannels', () => {
  beforeEach(() => {
    latest = null;
    vi.mocked(api.getRouteChannels).mockReset();
  });

  it('loads, normalizes, caches, and invalidates channels by route id', async () => {
    vi.mocked(api.getRouteChannels)
      .mockResolvedValueOnce([buildChannel(2, 2), buildChannel(1, 1)])
      .mockResolvedValueOnce([buildChannel(3, 0)])
      .mockResolvedValueOnce([buildChannel(4, 0)]);
    const root = await renderProbe();

    await act(async () => {
      await latest!.loadChannels(11);
    });

    expect(api.getRouteChannels).toHaveBeenCalledTimes(1);
    expect(latest!.channelsByRouteId[11].map((channel) => channel.id)).toEqual([1, 2]);
    expect(latest!.loadingChannelsByRouteId[11]).toBe(false);

    await act(async () => {
      await latest!.loadChannels(11);
    });

    expect(api.getRouteChannels).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest!.loadChannels(11, true);
    });

    expect(api.getRouteChannels).toHaveBeenCalledTimes(2);
    expect(latest!.channelsByRouteId[11].map((channel) => channel.id)).toEqual([3]);

    await act(async () => {
      latest!.invalidateChannels(11);
    });

    expect(latest!.channelsByRouteId[11]).toBeUndefined();

    await act(async () => {
      await latest!.loadChannels(11);
    });

    expect(api.getRouteChannels).toHaveBeenCalledTimes(3);
    expect(latest!.channelsByRouteId[11].map((channel) => channel.id)).toEqual([4]);

    await act(async () => {
      latest!.invalidateChannels();
    });

    expect(latest!.channelsByRouteId).toEqual({});

    await act(async () => {
      root.unmount();
    });
  });

  it('allows callers to replace channels locally', async () => {
    const root = await renderProbe();

    await act(async () => {
      latest!.setChannels(22, [buildChannel(9, 0)]);
    });

    expect(latest!.channelsByRouteId[22].map((channel) => channel.id)).toEqual([9]);

    await act(async () => {
      root.unmount();
    });
  });

  it('clears loading state and rethrows load failures', async () => {
    const error = new Error('network failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.getRouteChannels).mockRejectedValueOnce(error);
    const root = await renderProbe();

    await expect(act(async () => {
      await latest!.loadChannels(33);
    })).rejects.toThrow('network failed');

    expect(latest!.loadingChannelsByRouteId[33]).toBe(false);
    expect(latest!.channelsByRouteId[33]).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});
