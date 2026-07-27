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
    apiMock.getModelRouteFlow.mockResolvedValue({
      flow: {
        requestedModel: 'gpt-4o-mini',
        matched: true,
        diagnostics: [],
        projectedAt: '2026-07-02T00:00:00.000Z',
        compiledRuntime: {
          runtimeRef: { artifactId: 'runtime-artifact-1', bundleHash: 'hash' },
          match: { requestedModel: 'gpt-4o-mini', planId: 'plan', entryNodeId: 'entry', publicModelName: 'gpt-4o-mini' },
          dispatchers: [],
          terminalCandidates: [],
          endpoints: [],
          executionAttempts: [{
            executionAttemptId: 'ea_25',
            endpointId: 'endpoint:a',
            nodeId: 'endpoint:a',
            model: 'gpt-4o-mini',
            modelSource: 'fixed',
            enabled: true,
            siteId: 1,
            siteName: 'site-a',
            siteUrl: null,
            sitePlatform: 'openai',
            accountId: 12,
            accountLabel: 'tester',
            tokenId: 34,
            tokenLabel: 'default',
            tokenGroup: null,
            weight: 1,
            probability: 1,
            probabilityStatus: 'static',
            health: {
              successRate: null,
              totalCalls: 0,
              avgLatencyMs: null,
              cooldownUntil: null,
              consecutiveFailureCount: null,
            },
          }],
          selected: {
            dispatcherCandidateIds: [],
            terminalCandidateId: null,
            endpointId: 'endpoint:a',
            executionAttemptId: 'ea_25',
            accountId: 12,
            tokenId: 34,
            siteId: 1,
            actualModel: 'gpt-4o-mini',
            selectionSource: 'forced_execution_attempt',
          },
          filters: { preSelectionApplied: [], postBuild: [] },
          syntheticResponse: null,
        },
      },
    });

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
      forcedExecutionAttemptId: 'ea_25',
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

  it('keeps the restored fixed execution attempt selected through initial model hydration', async () => {
    let root!: ReactTestRenderer;

    try {
      await act(async () => {
        root = create(<ModelTester />);
      });
      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o-mini', expect.objectContaining({
          forcedExecutionAttemptId: 'ea_25',
          request: expect.objectContaining({
            requestedModel: 'gpt-4o-mini',
            method: 'POST',
            path: '/v1/chat/completions',
            payload: expect.objectContaining({ model: 'gpt-4o-mini' }),
          }),
        }));
        expect(collectText(root.root)).toContain('pages.modelTester.forcedExecutionAttemptHint');
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

  it('does not fall back to route-group APIs when marketplace is unavailable', async () => {
    apiMock.getModelsMarketplace.mockRejectedValueOnce(new Error('market unavailable'));
    apiMock.getModelRouteFlow.mockResolvedValueOnce({ flow: null });

    let root!: ReactTestRenderer;

    try {
      await act(async () => {
        root = create(<ModelTester />);
      });
      await vi.waitFor(async () => {
        await flushMicrotasks();
        const text = collectText(root.root);
        expect(text).toContain('pages.modelTester.failedLoadModelList');
      });
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o-mini', expect.objectContaining({
        forcedExecutionAttemptId: 'ea_25',
        request: expect.objectContaining({
          requestedModel: 'gpt-4o-mini',
          method: 'POST',
          path: '/v1/chat/completions',
        }),
      }));
    } finally {
      root?.unmount();
    }
  });
});
