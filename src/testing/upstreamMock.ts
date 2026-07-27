import { vi, type Mock } from 'vitest';

export type UpstreamMockRequest = {
  url: URL;
  method: string;
  headers: Headers;
  bodyText: string;
  json: unknown;
};

export type UpstreamMockMatcher =
  | string
  | RegExp
  | ((request: UpstreamMockRequest) => boolean);

export type UpstreamMockResponse =
  | Response
  | {
      status?: number;
      headers?: HeadersInit;
      body?: BodyInit | null;
      json?: unknown;
      text?: string;
      sse?: Array<string | { event?: string; data: unknown }>;
      delayMs?: number;
    }
  | ((request: UpstreamMockRequest) => Response | Promise<Response> | UpstreamMockResponse | Promise<UpstreamMockResponse>);

export type UpstreamMockRoute = {
  method?: string;
  path?: UpstreamMockMatcher;
  respond: UpstreamMockResponse;
  once?: boolean;
};

export type UpstreamMockHandle = {
  fetch: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
  calls: UpstreamMockRequest[];
  routes: UpstreamMockRoute[];
  add: (route: UpstreamMockRoute) => UpstreamMockHandle;
  reset: () => void;
  restore: () => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input, 'https://upstream.test');
  return new URL(input.url);
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (init?.body === undefined || init.body === null) {
    if (input instanceof Request) return await input.clone().text();
    return '';
  }
  const body = init.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) return '[form-data]';
  if (body instanceof Blob) return await body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return String(body);
}

function parseJsonBody(bodyText: string): unknown {
  if (!bodyText) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

function normalizeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function matchPath(matcher: UpstreamMockMatcher | undefined, request: UpstreamMockRequest): boolean {
  if (!matcher) return true;
  const path = `${request.url.pathname}${request.url.search}`;
  if (typeof matcher === 'string') return matcher === path || matcher === request.url.pathname || matcher === request.url.href;
  if (matcher instanceof RegExp) return matcher.test(path) || matcher.test(request.url.href);
  return matcher(request);
}

function findRoute(routes: UpstreamMockRoute[], request: UpstreamMockRequest): { route: UpstreamMockRoute; index: number } | null {
  const method = request.method.toUpperCase();
  const index = routes.findIndex((route) => {
    const routeMethod = route.method ? route.method.toUpperCase() : method;
    return routeMethod === method && matchPath(route.path, request);
  });
  return index >= 0 ? { route: routes[index]!, index } : null;
}

function sseBody(events: NonNullable<Extract<UpstreamMockResponse, { sse?: unknown }>['sse']>): string {
  return events.map((event) => {
    if (typeof event === 'string') return event.endsWith('\n\n') ? event : `${event}\n\n`;
    const lines = [];
    if (event.event) lines.push(`event: ${event.event}`);
    lines.push(`data: ${typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}`);
    return `${lines.join('\n')}\n\n`;
  }).join('');
}

async function toResponse(response: UpstreamMockResponse, request: UpstreamMockRequest): Promise<Response> {
  if (typeof response === 'function') {
    return await toResponse(await response(request), request);
  }
  if (response instanceof Response) return response;

  if (response.delayMs && response.delayMs > 0) {
    await sleep(response.delayMs);
  }

  const headers = new Headers(response.headers);
  if (response.json !== undefined) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(response.json), {
      status: response.status || 200,
      headers,
    });
  }
  if (response.sse) {
    if (!headers.has('content-type')) headers.set('content-type', 'text/event-stream');
    return new Response(sseBody(response.sse), {
      status: response.status || 200,
      headers,
    });
  }
  if (response.text !== undefined) {
    return new Response(response.text, {
      status: response.status || 200,
      headers,
    });
  }
  return new Response(response.body ?? null, {
    status: response.status || 200,
    headers,
  });
}

export function createUpstreamMock(initialRoutes: UpstreamMockRoute[] = []): UpstreamMockHandle {
  const routes = [...initialRoutes];
  const calls: UpstreamMockRequest[] = [];
  const previousFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = normalizeUrl(input);
    const bodyText = await readRequestBody(input, init);
    const request: UpstreamMockRequest = {
      url,
      method: (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      headers: normalizeHeaders(input, init),
      bodyText,
      json: parseJsonBody(bodyText),
    };
    calls.push(request);

    const matched = findRoute(routes, request);
    if (!matched) {
      return new Response(JSON.stringify({
        error: {
          message: `No upstream mock matched ${request.method} ${request.url.pathname}${request.url.search}`,
          type: 'mock_error',
        },
      }), {
        status: 599,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (matched.route.once) routes.splice(matched.index, 1);
    return await toResponse(matched.route.respond, request);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetch: fetchMock,
    calls,
    routes,
    add(route) {
      routes.push(route);
      return this;
    },
    reset() {
      calls.splice(0, calls.length);
      routes.splice(0, routes.length, ...initialRoutes);
      fetchMock.mockClear();
    },
    restore() {
      vi.stubGlobal('fetch', previousFetch);
    },
  };
}

export function openAiChatCompletionChunk(input: {
  id?: string;
  model?: string;
  delta?: Record<string, unknown>;
  finishReason?: string | null;
}): string {
  return `data: ${JSON.stringify({
    id: input.id || 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: input.model || 'test-model',
    choices: [{
      index: 0,
      delta: input.delta || {},
      finish_reason: input.finishReason ?? null,
    }],
  })}`;
}

export function doneSseChunk(): string {
  return 'data: [DONE]';
}
