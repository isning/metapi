import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import { api } from '../../api.js';
import { useModelDetailsResourceCache } from './useModelDetailsResourceCache.js';

vi.mock('../../api.js', () => ({
  api: {
    getModelRouteFlow: vi.fn(),
    getModelRouteFlowDiagnostics: vi.fn(),
    getModelRuntimeObservability: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createRouteFlow(): ModelRouteFlowData {
  return {
    requestedModel: 'gpt-prefetch',
    matched: true,
    diagnostics: [],
    compiledRuntime: null,
    projectedAt: '2026-07-11T00:00:00.000Z',
  };
}

type HookApi = ReturnType<typeof useModelDetailsResourceCache>;

function Harness({ onRender }: { onRender: (value: HookApi) => void }) {
  const value = useModelDetailsResourceCache();
  onRender(value);
  return null;
}

describe('useModelDetailsResourceCache', () => {
  beforeEach(() => {
    vi.mocked(api.getModelRouteFlow).mockReset();
    vi.mocked(api.getModelRouteFlowDiagnostics).mockReset();
    vi.mocked(api.getModelRuntimeObservability).mockReset();
  });

  it('keeps prefetch silent but lets activation take over the same route-flow request', async () => {
    const routeFlow = deferred<{ flow: ModelRouteFlowData }>();
    vi.mocked(api.getModelRouteFlow).mockReturnValue(routeFlow.promise as ReturnType<typeof api.getModelRouteFlow>);
    let hook!: HookApi;
    const root = create(<Harness onRender={(value) => { hook = value; }} />);

    act(() => {
      hook.prefetch([{ type: 'route-flow', model: 'gpt-prefetch' }]);
    });
    expect(api.getModelRouteFlow).toHaveBeenCalledTimes(1);
    expect(hook.snapshot.routeFlowLoadingByModel['gpt-prefetch']).toBeUndefined();

    act(() => {
      hook.ensure([{ type: 'route-flow', model: 'gpt-prefetch' }]);
    });
    expect(api.getModelRouteFlow).toHaveBeenCalledTimes(1);
    expect(hook.snapshot.routeFlowLoadingByModel['gpt-prefetch']).toBe(true);

    await act(async () => {
      routeFlow.resolve({ flow: createRouteFlow() });
      await routeFlow.promise;
    });

    expect(hook.snapshot.routeFlowLoadingByModel['gpt-prefetch']).toBe(false);
    expect(hook.snapshot.routeFlowByModel['gpt-prefetch']?.requestedModel).toBe('gpt-prefetch');
    root.unmount();
  });
});
