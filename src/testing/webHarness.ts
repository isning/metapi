import { vi } from 'vitest';
import { persistAuthSession } from '../web/authSession.js';

export function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

export function installAuthenticatedWebSession(token = 'test-admin-token'): Storage {
  const storage = createMemoryStorage();
  vi.stubGlobal('localStorage', storage);
  persistAuthSession(storage, token);
  return storage;
}

export function installResizeObserverMock(): void {
  class ResizeObserverMock implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

export function installMatchMediaMock(matches = false): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

export function installWebDomHarness(options: { token?: string; mediaMatches?: boolean } = {}): Storage {
  const storage = installAuthenticatedWebSession(options.token);
  installResizeObserverMock();
  installMatchMediaMock(options.mediaMatches ?? false);
  return storage;
}
