import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import App from './App.js';

const { apiMock, authSessionMock } = vi.hoisted(() => ({
  apiMock: {
    getEvents: vi.fn(),
    getEventCount: vi.fn(),
  },
  authSessionMock: {
    hasValidAuthSession: vi.fn(),
    persistAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
  },
}));

vi.mock('./api.js', () => ({ api: apiMock }));
vi.mock('./authSession.js', () => authSessionMock);
vi.mock('./components/SearchModal.js', () => ({ default: () => null }));
vi.mock('./components/NotificationPanel.js', () => ({ default: () => null }));
vi.mock('./components/TooltipLayer.js', () => ({ default: () => null }));
vi.mock('./components/useAnimatedVisibility.js', () => ({
  useAnimatedVisibility: (open: boolean) => ({ shouldRender: open, isVisible: open }),
}));

const { translate } = vi.hoisted(() => ({
  translate: (text: string) => ({
    'app.opennavigate': '打开导航',
    'app.closenavigate': '关闭导航',
    'app.navigate': '导航菜单',
    'app.mainNavigation': '主导航',
  }[text] || text),
}));

vi.mock('./i18n.js', () => ({
  tr: translate,
  I18nProvider: ({ children }: { children: ReactNode }) => children,
  useI18n: () => ({ language: 'zh', toggleLanguage: vi.fn(), t: translate }),
}));

// Keep the page modules lazy while replacing only their network-heavy internals.
vi.mock('./pages/Dashboard.js', () => ({ default: () => <div data-route-marker="/" /> }));
vi.mock('./pages/Sites.js', () => ({ default: () => <div data-route-marker="/sites" /> }));
vi.mock('./pages/SiteAnnouncements.js', () => ({ default: () => <div data-route-marker="/site-announcements" /> }));
vi.mock('./pages/Accounts.js', () => ({ default: () => <div data-route-marker="/accounts" /> }));
vi.mock('./pages/CostCatalog.js', () => ({ default: () => <div data-route-marker="/costs" /> }));
vi.mock('./pages/OAuthManagement.js', () => ({ default: () => <div data-route-marker="/oauth" /> }));
vi.mock('./pages/Tokens.js', () => ({ default: () => <div data-route-marker="/tokens" /> }));
vi.mock('./pages/CheckinLog.js', () => ({ default: () => <div data-route-marker="/checkin" /> }));
vi.mock('./pages/TokenRoutes.js', () => ({ default: () => <div data-route-marker="/routes" /> }));
vi.mock('./pages/ProxyLogs.js', () => ({ default: () => <div data-route-marker="/logs" /> }));
vi.mock('./pages/Monitors.js', () => ({ default: () => <div data-route-marker="/monitor" /> }));
vi.mock('./pages/Settings.js', () => ({ default: () => <div data-route-marker="/settings" /> }));
vi.mock('./pages/DownstreamKeys.js', () => ({ default: () => <div data-route-marker="/downstream-keys" /> }));
vi.mock('./pages/ProgramLogs.js', () => ({ default: () => <div data-route-marker="/events" /> }));
vi.mock('./pages/ImportExport.js', () => ({ default: () => <div data-route-marker="/settings/import-export" /> }));
vi.mock('./pages/NotificationSettings.js', () => ({ default: () => <div data-route-marker="/settings/notify" /> }));
vi.mock('./pages/Models.js', () => ({ default: () => <div data-route-marker="/models" /> }));
vi.mock('./pages/ModelTester.js', () => ({ default: () => <div data-route-marker="/playground" /> }));
vi.mock('./pages/About.js', () => ({ default: () => <div data-route-marker="/about" /> }));

function createStorage(): Storage {
  const values = new Map<string, string>([
    ['metapi.theme.mode', 'light'],
    ['metapi.firstUseDocReminder', '1'],
    ['metapi.userProfile', JSON.stringify({ name: '管理员', avatarSeed: 'routes', avatarStyle: 'identicon' })],
  ]);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function installRuntime(): void {
  const storage = createStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', {
    innerWidth: 1280,
    matchMedia: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    body: { style: {} },
    documentElement: { setAttribute: vi.fn(), getAttribute: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

function marker(root: ReactTestInstance): string | undefined {
  return root.findAll((node) => typeof node.props['data-route-marker'] === 'string')[0]?.props['data-route-marker'];
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const concreteRoutes = [
  '/', '/sites', '/site-announcements', '/accounts', '/costs', '/oauth', '/tokens',
  '/checkin', '/routes', '/logs', '/monitor', '/settings', '/downstream-keys', '/events',
  '/settings/import-export', '/settings/notify', '/models', '/playground', '/about',
] as const;

describe('App real route table', () => {
  beforeEach(() => {
    installRuntime();
    vi.useFakeTimers();
    vi.clearAllMocks();
    authSessionMock.hasValidAuthSession.mockReturnValue(true);
    apiMock.getEvents.mockResolvedValue([]);
    apiMock.getEventCount.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(concreteRoutes)('renders the lazy page registered for %s', async (path) => {
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => {
        root = create(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
      });
      await settle();
      expect(marker(root.root)).toBe(path);
    } finally {
      root?.unmount();
    }
  });

  it('redirects unknown URLs through the real wildcard route', async () => {
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => {
        root = create(<MemoryRouter initialEntries={['/does-not-exist']}><App /></MemoryRouter>);
      });
      await settle();
      expect(marker(root.root)).toBe('/');
    } finally {
      root?.unmount();
    }
  });

  it('keeps an unauthenticated deep link until Login succeeds, then renders that page', async () => {
    authSessionMock.hasValidAuthSession.mockReturnValue(false);
    authSessionMock.persistAuthSession.mockImplementation(() => {
      authSessionMock.hasValidAuthSession.mockReturnValue(true);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    let root!: ReturnType<typeof create>;
    try {
      await act(async () => {
        root = create(<MemoryRouter initialEntries={['/tokens']}><App /></MemoryRouter>);
      });
      await settle();
      expect(root.root.findByProps({ id: 'admin-token-input' })).toBeTruthy();
      expect(root.root.findAll((node) => node.props['data-route-marker'] === '/tokens')).toHaveLength(0);

      const input = root.root.findByProps({ id: 'admin-token-input' });
      const form = root.root.findByType('form');
      act(() => {
        input.props.onChange({ target: { value: 'valid-token' } });
      });
      await act(async () => {
        await form.props.onSubmit({ preventDefault: vi.fn() });
      });
      await settle();

      expect(authSessionMock.persistAuthSession).toHaveBeenCalledWith(expect.anything(), 'valid-token');
      expect(marker(root.root)).toBe('/tokens');
    } finally {
      root?.unmount();
    }
  });
});
