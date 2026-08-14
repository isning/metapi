import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { api, type ProxyTestRequestEnvelope } from "./api.js";
import { getAuthToken, persistAuthSession } from "./authSession.js";

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
  const fetchMock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api proxy test timeout handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", createMemoryStorage());
    persistAuthSession(globalThis.localStorage as Storage, "token-1");
  });

  it("sends an explicit JSON command body for a parameterless POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, queued: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.triggerCheckinAll();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST" });
    expect(init.body).toBe("{}");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("sends an explicit JSON command body when syncing account tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.syncAccountTokens(42);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST" });
    expect(init.body).toBe("{}");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("serializes explicit JSON bodies and declares their content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.proxyTest({
      method: "POST",
      path: "/v1/chat/completions",
      requestKind: "json",
      jsonBody: { model: "test" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({
      method: "POST",
      path: "/v1/chat/completions",
      requestKind: "json",
      jsonBody: { model: "test" },
    }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("keeps every management write on the explicit JSON request variant", () => {
    const source = readFileSync(resolve(process.cwd(), "src/web/api.ts"), "utf8");
    const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
    const directRequestWrites: number[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "request"
      ) {
        const options = node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          const method = options.properties.find((property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property)
            && ts.isIdentifier(property.name)
            && property.name.text === "method",
          );
          if (
            method
            && ts.isStringLiteral(method.initializer)
            && ["POST", "PUT", "PATCH"].includes(method.initializer.text)
          ) {
            directRequestWrites.push(node.getStart(sourceFile));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    expect(directRequestWrites).toEqual([]);
  });

  it("sends an explicit JSON body when refreshing token models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.refreshAccountTokenModels(42);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST", body: "{}" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps image generation proxy tests alive past the default 30 second timeout", async () => {
    installPendingFetch();

    const payload: ProxyTestRequestEnvelope = {
      method: "POST",
      path: "/v1/images/generations",
      requestKind: "json",
      jsonBody: {
        model: "gemini-imagen",
        prompt: "banana cat",
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
      throw new Error("Expected image generation proxy test to time out");
    }
    expect(result.error.message).toBe("请求超时（150s）");
  });

  it("still uses the default 30 second timeout for generic proxy tests", async () => {
    installPendingFetch();

    const payload: ProxyTestRequestEnvelope = {
      method: "POST",
      path: "/v1/embeddings",
      requestKind: "json",
      jsonBody: {
        model: "text-embedding-3-small",
        input: "hello",
      },
    };

    const promise = api.proxyTest(payload).catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(promise).resolves.toMatchObject({
      message: "请求超时（30s）",
    });
  });

  it("forwards caller cancellation through both route graph workspace requests", async () => {
    const fetchMock = installPendingFetch();
    const indexController = new AbortController();
    const indexRequest = api
      .getRouteGraphWorkspaceIndex(
        { query: "macro", cursor: "opaque-cursor" },
        { signal: indexController.signal },
      )
      .catch((error: Error) => error);

    const indexFetchSignal = fetchMock.mock.calls[0]?.[1]
      ?.signal as AbortSignal;
    expect(indexFetchSignal).toBeTruthy();
    expect(indexFetchSignal.aborted).toBe(false);
    indexController.abort();
    expect(indexFetchSignal.aborted).toBe(true);
    await expect(indexRequest).resolves.toMatchObject({ name: "AbortError" });

    const focusController = new AbortController();
    const focusRequest = api
      .getRouteGraphFocusedWorkspace(
        {
          focus: { kind: "macro", id: "server-focus-id" },
          representation: "primitive",
          windowToken: "opaque-window-token",
        },
        { signal: focusController.signal },
      )
      .catch((error: Error) => error);

    const focusFetchSignal = fetchMock.mock.calls[1]?.[1]
      ?.signal as AbortSignal;
    expect(focusFetchSignal).toBeTruthy();
    expect(focusFetchSignal.aborted).toBe(false);
    focusController.abort();
    expect(focusFetchSignal.aborted).toBe(true);
    await expect(focusRequest).resolves.toMatchObject({ name: "AbortError" });
  });

  it("keeps all-model site probes alive past the default 30 second timeout", async () => {
    installPendingFetch();

    let settled = false;
    const promise = api.probeSiteNow(1, { scope: "all" });
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
      throw new Error("Expected all-model site probe to time out");
    }
    expect(result.error.message).toBe("请求超时（120s）");
  });

  it("times out replay hydration file-content fetches after 30 seconds", async () => {
    installPendingFetch();

    const getProxyFileContentDataUrl = (api as Record<string, any>)
      .getProxyFileContentDataUrl;
    let settled = false;
    const handled = getProxyFileContentDataUrl?.("file-metapi-123")
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
      throw new Error(
        "Expected replay hydration file-content fetch to time out",
      );
    }
    expect(result.error.message).toBe("请求超时（30s）");
  });

  it("loads proxy file content as a data URL for replay hydration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new Blob([Buffer.from("PDF")], { type: "application/pdf" }),
        {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'inline; filename="brief.pdf"',
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const getProxyFileContentDataUrl = (api as Record<string, any>)
      .getProxyFileContentDataUrl;
    const result = await getProxyFileContentDataUrl?.("file-metapi-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/files/file-metapi-123/content",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("GET");
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get("Authorization")).toBe(
      "Bearer token-1",
    );
    expect(result).toEqual({
      filename: "brief.pdf",
      mimeType: "application/pdf",
      data: "data:application/pdf;base64,UERG",
    });
  });

  it("reuses the same proxy test implementations for legacy aliases", () => {
    expect(api.proxyTest).toBe(api.testProxy);
    expect(api.proxyTestStream).toBe(api.testProxyStream);
  });
});

describe("api session-expired handling", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    persistAuthSession(globalThis.localStorage as Storage, "token-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears the frontend session only when the server marks an admin auth failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-metapi-auth-failure": "admin",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getDashboard()).rejects.toThrow("Session expired");
    expect(getAuthToken(globalThis.localStorage as Storage)).toBeNull();
  });

  it("does not clear the frontend session for unmarked business 401/403 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Invalid API key", type: "authentication_error" },
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.proxyTest({
        method: "POST",
        path: "/v1/chat/completions",
        requestKind: "json",
        rawMode: false,
        jsonBody: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        },
      }),
    ).rejects.toThrow("Invalid API key");
    expect(getAuthToken(globalThis.localStorage as Storage)).toBe("token-1");
  });

  it("returns unmarked streaming proxy 401 responses to the caller instead of expiring the session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Missing proxy key",
            type: "invalid_request_error",
          },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.proxyTestStream({
      method: "POST",
      path: "/gemini/v1beta/models/gemini-2.5-flash:generateContent?alt=sse",
      requestKind: "json",
      rawMode: false,
      stream: true,
      jsonBody: {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { message: "Missing proxy key", type: "invalid_request_error" },
    });
    expect(getAuthToken(globalThis.localStorage as Storage)).toBe("token-1");
  });
});

describe("api paged route projection helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    persistAuthSession(globalThis.localStorage as Storage, "token-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserves route summary page metadata for callers that need real totals", async () => {
    const pageInfo = {
      page: 2,
      pageSize: 137,
      totalCount: 50_000,
      hasMore: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: 50_000, match: { requestedModelPattern: "tail-model" } },
          ],
          pageInfo,
          summary: { candidateCount: 137 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getRouteGroupPage({ page: 2, pageSize: 137 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/route-groups?paged=1&page=2&pageSize=137",
    );
    expect(result.items).toEqual([
      { id: 50_000, match: { requestedModelPattern: "tail-model" } },
    ]);
    expect(result.pageInfo).toEqual(pageInfo);
    expect(result.summary).toEqual({ candidateCount: 137 });
  });

  it("serializes route summary filters for server-side route list projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: 50_000, match: { requestedModelPattern: "tail-model" } },
          ],
          pageInfo: {
            page: 2,
            pageSize: 20,
            totalCount: 50_000,
            hasMore: true,
          },
          summary: { candidateCount: 50_000 },
          facets: {
            brands: [],
            otherBrandCount: 0,
            sites: [],
            tabs: { public: 50_000, internal: 0, manual: 0 },
            enabled: { enabled: 50_000, disabled: 0 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getRouteGroupPage({
      page: 2,
      pageSize: 20,
      q: "tail",
      tab: "public",
      group: "__all__",
      brand: "OpenAI",
      site: "Demo Site",
      endpointType: "openai",
      enabled: "enabled",
      sortBy: "name",
      sortDir: "asc",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/route-groups?paged=1&page=2&pageSize=20&q=tail&tab=public&group=__all__&brand=OpenAI&site=Demo+Site&endpointType=openai&enabled=enabled&sortBy=name&sortDir=asc",
    );
  });

  it("clears route group failure state by route-group resource id", async () => {
    const routeGroupId = "manual:route-group-test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          routeGroupKey: routeGroupId,
          clearedExecutionTargets: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.clearRouteGroupFailureState(routeGroupId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/route-groups/manual%3Aroute-group-test/failure-state",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
    });
  });

  it("uses route group candidate resources for candidate mutations", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const routeGroupId = "upstream:deepseek-ai/deepseek-v4-flash";
    await api.getRouteGroupFallbackStages(routeGroupId);
    await api.batchAddCandidates(routeGroupId, [
      "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
    ]);
    await api.addRouteGroupCandidate(routeGroupId, {
      sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
    });
    await api.updateRouteGroupMember(
      routeGroupId,
      "dispatcher-member:managed:17",
      { enabled: false },
    );
    await api.moveRouteGroupCandidatesToFallbackStages(
      routeGroupId,
      [
        {
          id: "dispatcher-member:managed:17",
          stageId: "fallback-stage:managed:3",
          sortOrder: 2,
        },
      ],
      ["dispatcher-member:managed:17"],
    );
    await api.deleteRouteGroupCandidate(
      routeGroupId,
      "dispatcher-member:managed:17",
    );
    await api.updateRouteGroup(routeGroupId, { enabled: false });
    await api.deleteRouteGroup(routeGroupId);

    const encodedRouteGroupId = "upstream%3Adeepseek-ai%2Fdeepseek-v4-flash";
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/stages`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/candidates/batch`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        sourceRefs: ["67d54dd0-45c8-4d98-b7b9-7ac550192ec7"],
      }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/candidates`,
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
      }),
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/candidates/dispatcher-member%3Amanaged%3A17`,
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/candidates/stages`,
    );
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        updates: [
          {
            id: "dispatcher-member:managed:17",
            stageId: "fallback-stage:managed:3",
            sortOrder: 2,
          },
        ],
        manuallyAdjustedCandidateIds: ["dispatcher-member:managed:17"],
      }),
    });
    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}/candidates/dispatcher-member%3Amanaged%3A17`,
    );
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[6]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}`,
    );
    expect(fetchMock.mock.calls[6]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[7]?.[0]).toBe(
      `/api/route-groups/${encodedRouteGroupId}`,
    );
    expect(fetchMock.mock.calls[7]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("uses explicit automatic-management reset resources", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ success: true, restoredCount: 1, stages: [] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const routeGroupId = "automatic:deepseek-v4-flash";
    const candidateId = "member:generated:17";
    await api.restoreAutomaticRouteGroupCandidate(routeGroupId, candidateId);
    await api.restoreAutomaticRouteGroupCandidates(routeGroupId);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/route-groups/automatic%3Adeepseek-v4-flash/candidates/member%3Agenerated%3A17/manual-adjustment",
      expect.objectContaining({ method: "DELETE" }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/route-groups/automatic%3Adeepseek-v4-flash/manual-adjustments",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("preserves route endpoint catalog page metadata for source pickers", async () => {
    const pageInfo = {
      page: 1,
      pageSize: 73,
      totalCount: 50_000,
      hasMore: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          revision: "draft:4:9",
          items: [
            { endpointId: "route-endpoint:supply:tail", label: "tail source" },
          ],
          pageInfo,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getRouteGraphEndpointPage({
      page: 1,
      pageSize: 73,
      endpointKind: "supply",
      q: "tail",
      revision: "draft:4:9",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/route-graph/endpoints?paged=1&page=1&pageSize=73&endpointKind=supply&q=tail&revision=draft%3A4%3A9",
    );
    expect(result.items).toEqual([
      { endpointId: "route-endpoint:supply:tail", label: "tail source" },
    ]);
    expect(result.pageInfo).toEqual(pageInfo);
  });

  it("serializes marketplace paging filters and sorting for server-side projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "gpt-tail-model" }],
          pageInfo: {
            page: 3,
            pageSize: 50,
            totalCount: 50_000,
            hasMore: true,
          },
          facets: { brands: [], otherBrandCount: 0, sites: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getModelsMarketplace({
      page: 3,
      pageSize: 50,
      q: "tail",
      brand: "OpenAI",
      site: "Demo Site",
      sortBy: "name",
      sortDir: "asc",
      includePricing: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/models/marketplace?page=3&pageSize=50&q=tail&brand=OpenAI&site=Demo+Site&sortBy=name&sortDir=asc&includePricing=1",
    );
    expect(result).toMatchObject({
      models: [{ name: "gpt-tail-model" }],
      pageInfo: { totalCount: 50_000 },
    });
  });

  it("posts route-flow pricing usage with the runtime request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, flow: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getModelRouteFlow("gpt-advanced", {
      forcedExecutionAttemptId: "ea_25",
      request: {
        requestedModel: "gpt-advanced",
        method: "POST",
        path: "/v1/chat/completions",
        payload: { model: "gpt-advanced" },
      },
      pricingUsage: {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheReadTokens: 300,
        cacheWriteTokens: 40,
        reasoningTokens: 50,
        requestCount: 1,
      },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/models/gpt-advanced/route-flow?forcedExecutionAttemptId=ea_25",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        request: {
          requestedModel: "gpt-advanced",
          method: "POST",
          path: "/v1/chat/completions",
          payload: { model: "gpt-advanced" },
        },
        pricingUsage: {
          inputTokens: 1000,
          outputTokens: 2000,
          cacheReadTokens: 300,
          cacheWriteTokens: 40,
          reasoningTokens: 50,
          requestCount: 1,
        },
      }),
    });
  });
});
