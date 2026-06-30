import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ProxyTestRequestEnvelope } from './api.js';
import { persistAuthSession } from './authSession.js';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

function installPendingFetch() {
  const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api proxy test timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', createMemoryStorage());
    persistAuthSession(globalThis.localStorage as Storage, 'token-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps image generation proxy tests alive past the default 30 second timeout', async () => {
    installPendingFetch();

    const payload: ProxyTestRequestEnvelope = {
      method: 'POST',
      path: '/v1/images/generations',
      requestKind: 'json',
      jsonBody: {
        model: 'gemini-imagen',
        prompt: 'banana cat',
      },
    };

    let settled = false;
    const promise = api.proxyTest(payload);
    const handled = promise
      .then(() => ({ ok: true as const }))
      .catch((error: Error) => ({ ok: false as const, error }))
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    const result = await handled;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected image generation proxy test to time out');
    }
    expect(result.error.message).toBe('请求超时（150s）');
  });

  it('still uses the default 30 second timeout for generic proxy tests', async () => {
    installPendingFetch();

    const payload: ProxyTestRequestEnvelope = {
      method: 'POST',
      path: '/v1/embeddings',
      requestKind: 'json',
      jsonBody: {
        model: 'text-embedding-3-small',
        input: 'hello',
      },
    };

    const promise = api.proxyTest(payload).catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(promise).resolves.toMatchObject({ message: '请求超时（30s）' });
  });

  it('keeps all-model site probes alive past the default 30 second timeout', async () => {
    installPendingFetch();

    let settled = false;
    const promise = api.probeSiteNow(1, { scope: 'all' });
    const handled = promise
      .then(() => ({ ok: true as const }))
      .catch((error: Error) => ({ ok: false as const, error }))
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(90_000);
    const result = await handled;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected all-model site probe to time out');
    }
    expect(result.error.message).toBe('请求超时（120s）');
  });

  it('times out replay hydration file-content fetches after 30 seconds', async () => {
    installPendingFetch();

    const getProxyFileContentDataUrl = (api as Record<string, any>).getProxyFileContentDataUrl;
    let settled = false;
    const handled = getProxyFileContentDataUrl?.('file-metapi-123')
      .then(() => ({ ok: true as const }))
      .catch((error: Error) => ({ ok: false as const, error }))
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(true);

    const result = await handled;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected replay hydration file-content fetch to time out');
    }
    expect(result.error.message).toBe('请求超时（30s）');
  });

  it('loads proxy file content as a data URL for replay hydration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Blob([Buffer.from('PDF')], { type: 'application/pdf' }),
      {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'inline; filename="brief.pdf"',
        },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const getProxyFileContentDataUrl = (api as Record<string, any>).getProxyFileContentDataUrl;
    const result = await getProxyFileContentDataUrl?.('file-metapi-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/files/file-metapi-123/content');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('GET');
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer token-1');
    expect(result).toEqual({
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      data: 'data:application/pdf;base64,UERG',
    });
  });

  it('reuses the same proxy test implementations for legacy aliases', () => {
    expect(api.proxyTest).toBe(api.testProxy);
    expect(api.proxyTestStream).toBe(api.testProxyStream);
  });
});

describe('api paged route projection helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    persistAuthSession(globalThis.localStorage as Storage, 'token-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves route summary page metadata for callers that need real totals', async () => {
    const pageInfo = {
      page: 2,
      pageSize: 137,
      totalCount: 50_000,
      hasMore: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [{ id: 50_000, match: { requestedModelPattern: 'tail-model' } }],
        pageInfo,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getRouteSummaryPage({ page: 2, pageSize: 137 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/routes/summary?paged=1&page=2&pageSize=137');
    expect(result.items).toEqual([{ id: 50_000, match: { requestedModelPattern: 'tail-model' } }]);
    expect(result.pageInfo).toEqual(pageInfo);
  });

  it('serializes route summary filters for server-side route list projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [{ id: 50_000, match: { requestedModelPattern: 'tail-model' } }],
        pageInfo: { page: 2, pageSize: 20, totalCount: 50_000, hasMore: true },
        facets: { brands: [], otherBrandCount: 0, sites: [], tabs: { public: 50_000, internal: 0, manual: 0 }, enabled: { enabled: 50_000, disabled: 0 } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await api.getRouteSummaryPage({
      page: 2,
      pageSize: 20,
      q: 'tail',
      tab: 'public',
      group: '__all__',
      brand: 'OpenAI',
      site: 'Demo Site',
      endpointType: 'openai',
      includeZeroTarget: true,
      enabled: 'enabled',
      sortBy: 'name',
      sortDir: 'asc',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/routes/summary?paged=1&page=2&pageSize=20&q=tail&tab=public&group=__all__&brand=OpenAI&site=Demo+Site&endpointType=openai&includeZeroTarget=1&enabled=enabled&sortBy=name&sortDir=asc');
  });

  it('preserves route endpoint catalog page metadata for source pickers', async () => {
    const pageInfo = {
      page: 1,
      pageSize: 73,
      totalCount: 50_000,
      hasMore: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        items: [{ endpointId: 'route-endpoint:supply:tail', label: 'tail source' }],
        pageInfo,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getRouteEndpointPage({
      page: 1,
      pageSize: 73,
      endpointKind: 'supply',
      q: 'tail',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/route-endpoints?paged=1&page=1&pageSize=73&endpointKind=supply&q=tail');
    expect(result.items).toEqual([{ endpointId: 'route-endpoint:supply:tail', label: 'tail source' }]);
    expect(result.pageInfo).toEqual(pageInfo);
  });

  it('serializes marketplace paging filters and sorting for server-side projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        models: [{ name: 'gpt-tail-model' }],
        pageInfo: { page: 3, pageSize: 50, totalCount: 50_000, hasMore: true },
        facets: { brands: [], otherBrandCount: 0, sites: [] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getModelsMarketplace({
      page: 3,
      pageSize: 50,
      q: 'tail',
      brand: 'OpenAI',
      site: 'Demo Site',
      sortBy: 'name',
      sortDir: 'asc',
      includePricing: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/models/marketplace?page=3&pageSize=50&q=tail&brand=OpenAI&site=Demo+Site&sortBy=name&sortDir=asc&includePricing=1');
    expect(result).toMatchObject({
      models: [{ name: 'gpt-tail-model' }],
      pageInfo: { totalCount: 50_000 },
    });
  });
});
