import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ModelTester from './ModelTester.js';
import {
  DEBUG_TABS,
  DEFAULT_INPUTS,
  DEFAULT_MODE_STATE,
  DEFAULT_PARAMETER_ENABLED,
  MODEL_TESTER_STORAGE_KEY,
  serializeModelTesterSession,
} from './helpers/modelTesterSession.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getModelsMarketplace: vi.fn(),
    getRouteSummaryPage: vi.fn(),
    getRouteDecision: vi.fn(),
    getModelRouteFlow: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/ModelRouteFlow.js', () => ({
  default: () => null,
}));

vi.mock('../authSession.js', () => ({
  clearAuthSession: vi.fn(),
  getAuthToken: vi.fn(() => null),
}));

vi.mock('./model-tester/ConversationComposer.js', () => ({
  default: () => null,
}));

vi.mock('./model-tester/DebugPanel.js', () => ({
  default: () => null,
}));

vi.mock('../components/useAnimatedVisibility.js', () => ({
  useAnimatedVisibility: () => ({ shouldRender: false, isVisible: false }),
}));

vi.mock('../components/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('../i18n.js', () => ({
  tr: (value: string) => value,
}));

function collectText(node: any): string {
  const children = node?.children || [];
  return children.map((child: any) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ModelTester fixed channel behavior', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        { name: 'gpt-4o-mini' },
      ],
    });
    apiMock.getRouteSummaryPage.mockResolvedValue({ items: [], pageInfo: { page: 1, pageSize: 500, totalCount: 0, hasMore: false } });
    apiMock.getRouteDecision.mockResolvedValue({
      decision: {
        candidates: [
          {
            targetId: 77,
            accountId: 12,
            username: 'tester',
            siteName: 'site-a',
            tokenName: 'default',
            priority: 0,
            eligible: true,
            reason: 'ok',
          },
        ],
      },
    });
    apiMock.getModelRouteFlow.mockResolvedValue({ flow: null });

    const session = serializeModelTesterSession({
      input: '',
      inputs: {
        ...DEFAULT_INPUTS,
        model: 'gpt-4o-mini',
      },
      parameterEnabled: DEFAULT_PARAMETER_ENABLED,
      messages: [],
      conversationFiles: [],
      pendingPayload: null,
      pendingJobId: null,
      forcedTargetId: 77,
      customRequestMode: false,
      customRequestBody: '',
      showDebugPanel: false,
      activeDebugTab: DEBUG_TABS.PREVIEW,
      modeState: DEFAULT_MODE_STATE,
    });

    const storage = new Map<string, string>([
      [MODEL_TESTER_STORAGE_KEY, session],
    ]);

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
  });

  afterEach(() => {
    if (originalLocalStorage) {
      vi.stubGlobal('localStorage', originalLocalStorage);
    } else {
      vi.unstubAllGlobals();
    }
    vi.clearAllMocks();
  });

  it('keeps the restored fixed channel selected through initial model hydration', async () => {
    let root!: ReactTestRenderer;

    try {
      await act(async () => {
        root = create(<ModelTester />);
      });
      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getRouteDecision).toHaveBeenCalledTimes(1);
        expect(apiMock.getRouteDecision).toHaveBeenCalledWith('gpt-4o-mini');
        expect(collectText(root.root)).toContain('已固定到目标 #77，失败不会自动切换。');
      });
      expect(apiMock.getModelsMarketplace).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 500,
        includePricing: false,
      }));
    } finally {
      root?.unmount();
    }
  });

  it('hydrates model choices from bounded route summary fallback when marketplace is unavailable', async () => {
    apiMock.getModelsMarketplace.mockRejectedValueOnce(new Error('market unavailable'));
    apiMock.getRouteSummaryPage.mockResolvedValueOnce({
      items: [
        {
          id: 50_000,
          enabled: true,
          visibility: 'public',
          match: {
            kind: 'model',
            requestedModelPattern: 'summary-only-model',
            displayName: null,
          },
          backend: { kind: 'supply' },
          presentation: { displayName: null, displayIcon: null },
          targetCount: 1,
          enabledTargetCount: 1,
          siteNames: ['site-a'],
          decisionSnapshot: null,
          decisionRefreshedAt: null,
        },
      ],
      pageInfo: { page: 1, pageSize: 500, totalCount: 50_000, hasMore: true },
    });
    apiMock.getRouteDecision.mockResolvedValueOnce({ decision: { candidates: [] } });
    apiMock.getModelRouteFlow.mockResolvedValueOnce({ flow: null });

    let root!: ReactTestRenderer;

    try {
      await act(async () => {
        root = create(<ModelTester />);
      });
      await vi.waitFor(async () => {
        await flushMicrotasks();
        const text = collectText(root.root);
        expect(text).toContain('共 1 个模型');
        expect(text).toContain('summary-only-model');
      });
      expect(apiMock.getRouteSummaryPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 500,
      }));
    } finally {
      root?.unmount();
    }
  });
});
