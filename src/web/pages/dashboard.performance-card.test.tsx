import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import Dashboard from './Dashboard.js';
import { installDashboardSnapshotCompat } from './testApiCompat.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getDashboard: vi.fn(),
    getDashboardSnapshot: vi.fn(),
    getDashboardInsights: vi.fn(),
    getSiteSnapshot: vi.fn(),
    getSiteDistribution: vi.fn(),
    getSiteTrend: vi.fn(),
    getSites: vi.fn(),
    getEvents: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function isCard(node: ReactTestInstance): boolean {
  return node.props['data-slot'] === 'card';
}

function findStatCards(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => {
    if (!isCard(node)) return false;
    const text = collectText(node);
    return [
      '账户数据',
      '使用统计',
      '资源消耗',
      '签到状态',
      '性能指标',
    ].some((title) => text.includes(title));
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Dashboard performance stat card', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.clearAllMocks();
    installDashboardSnapshotCompat(apiMock);
    apiMock.getSiteDistribution.mockResolvedValue({ distribution: [] });
    apiMock.getSiteTrend.mockResolvedValue({ trend: [] });
    apiMock.getSites.mockResolvedValue([]);
    apiMock.getEvents.mockResolvedValue([]);
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementById: vi.fn(() => null),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    vi.clearAllMocks();
  });

  it('renders RPM and TPM inside a fifth stat card within the same dashboard grid', async () => {
    apiMock.getDashboard.mockResolvedValue({
      totalBalance: 0,
      totalUsed: 0,
      todaySpend: 0,
      todayReward: 0,
      activeAccounts: 0,
      totalAccounts: 0,
      todayCheckin: { success: 0, total: 0 },
      proxy24h: { success: 0, total: 0, totalTokens: 606_573_377 },
      performance: {
        windowSeconds: 60,
        requestsPerMinute: 17,
        tokensPerMinute: 7_974,
      },
      modelAnalysis: null,
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <Dashboard />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const statCards = findStatCards(root!.root);
      const statGridText = statCards.map((card) => collectText(card)).join('');

      expect(statCards).toHaveLength(5);
      expect(statGridText).toContain('性能指标');
      expect(statGridText).toContain('RPM');
      expect(statGridText).toContain('17');
      expect(statGridText).toContain('TPM');
      expect(statGridText).toContain('8K');
      expect(statGridText).toContain('24h Tokens');
      expect(statGridText).toContain('606.6M');
    } finally {
      root?.unmount();
    }
  });

  it('shows five skeleton stat cards while dashboard data is still loading', async () => {
    let resolveDashboard: ((value: Record<string, unknown>) => void) | undefined;
    apiMock.getDashboard.mockImplementation(() => (
      new Promise((resolve) => {
        resolveDashboard = resolve as (value: Record<string, unknown>) => void;
      })
    ));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/']}>
            <ToastProvider>
              <Dashboard />
            </ToastProvider>
          </MemoryRouter>,
        );
      });

      const statCards = root!.root.findAll(isCard);

      expect(statCards).toHaveLength(5);
    } finally {
      if (resolveDashboard) {
        resolveDashboard({
          totalBalance: 0,
          totalUsed: 0,
          todaySpend: 0,
          todayReward: 0,
          activeAccounts: 0,
          totalAccounts: 0,
          todayCheckin: { success: 0, total: 0 },
          proxy24h: { success: 0, total: 0, totalTokens: 0 },
          performance: { windowSeconds: 60, requestsPerMinute: 0, tokensPerMinute: 0 },
          modelAnalysis: null,
        });
      }
      root?.unmount();
    }
  });
});
