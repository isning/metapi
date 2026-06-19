import { vi, type Mock } from 'vitest';

export type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

export function installFetchMock(): FetchMock {
  const fetchMock: FetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

export function installNeverResolvingFetchMock(): FetchMock {
  const fetchMock: FetchMock = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
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

