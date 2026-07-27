import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';

import type { PricingReferenceCatalog, PricingReferenceConfig } from '../api.js';
import CostCatalog from './CostCatalog.js';

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: {
    getPricingReferenceConfig: vi.fn(),
    getPricingReferenceCatalog: vi.fn(),
    getPlatformPricingConfig: vi.fn(),
    listUpstreamCostPricings: vi.fn(),
    updatePricingReferenceConfig: vi.fn(),
    updatePricingReferenceCatalog: vi.fn(),
    importPricingReferenceCatalog: vi.fn(),
    syncPricingReferenceCatalog: vi.fn(),
    updatePlatformPricingConfig: vi.fn(),
    listWalletAcquisitionProfiles: vi.fn(),
    createWalletAcquisitionProfile: vi.fn(),
    updateWalletAcquisitionProfile: vi.fn(),
    deleteWalletAcquisitionProfile: vi.fn(),
    listFxRateSnapshots: vi.fn(),
    createFxRateSnapshot: vi.fn(),
    updateFxRateSnapshot: vi.fn(),
    deleteFxRateSnapshot: vi.fn(),
    getAccountsSnapshot: vi.fn(),
    getAccountTokens: vi.fn(),
  },
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/Toast.js', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
  useToast: () => toastMock,
}));

const referenceConfig: PricingReferenceConfig = {
  schemaVersion: 1,
  sync: {
    enabled: false,
    url: '',
    cron: '0 3 * * *',
    replaceOnSync: true,
    lastSyncedAt: null,
    lastError: null,
  },
};

const referenceCatalog: PricingReferenceCatalog = {
  schemaVersion: 1,
  entries: [],
  updatedAt: null,
};

const referenceCatalogWithEntry: PricingReferenceCatalog = {
  schemaVersion: 1,
  entries: [
    {
      id: 'openai:gpt-4o',
      provider: 'openai',
      modelName: 'gpt-4o',
      normalizedModelName: 'gpt-4o',
      displayName: 'GPT-4o',
      aliases: ['gpt-4o-latest'],
      plan: {
        schemaVersion: 1,
        planKind: 'rate_card',
        components: [
          { id: 'input_tokens', price: { amount: 5 } },
          { id: 'output_tokens', price: { amount: 15 } },
        ],
      },
      planFingerprint: 'fingerprint',
      sourceUrl: null,
      sourceType: 'manual',
      updatedAt: '2026-06-20T00:00:00.000Z',
      notes: null,
    },
  ],
  updatedAt: null,
};

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function collectClassNames(node: ReactTestInstance): string[] {
  const ownClassName = typeof node.props.className === 'string' ? [node.props.className] : [];
  return ownClassName.concat(
    (node.children || []).flatMap((child) => (typeof child === 'string' ? [] : collectClassNames(child))),
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CostCatalog page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getPricingReferenceConfig.mockResolvedValue(referenceConfig);
    apiMock.getPricingReferenceCatalog.mockResolvedValue(referenceCatalog);
    apiMock.getPlatformPricingConfig.mockResolvedValue(null);
    apiMock.listFxRateSnapshots.mockResolvedValue([]);
    apiMock.updatePricingReferenceConfig.mockResolvedValue(referenceConfig);
    apiMock.updatePricingReferenceCatalog.mockResolvedValue(referenceCatalog);
    apiMock.importPricingReferenceCatalog.mockResolvedValue({ catalog: referenceCatalog, imported: 0, replaced: 0 });
    apiMock.syncPricingReferenceCatalog.mockResolvedValue({ skipped: true });
    apiMock.updatePlatformPricingConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders only the reference pricing catalog workspace', async () => {
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/costs']}>
            <CostCatalog />
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(apiMock.getPricingReferenceConfig).toHaveBeenCalledTimes(1);
      expect(apiMock.getPricingReferenceCatalog).toHaveBeenCalledTimes(1);
      expect(apiMock.getPlatformPricingConfig).not.toHaveBeenCalled();
      expect(apiMock.listFxRateSnapshots).not.toHaveBeenCalled();
      expect(apiMock.listUpstreamCostPricings).not.toHaveBeenCalled();
      expect(apiMock.listWalletAcquisitionProfiles).not.toHaveBeenCalled();
      expect(apiMock.getAccountsSnapshot).not.toHaveBeenCalled();
      expect(apiMock.getAccountTokens).not.toHaveBeenCalled();
      expect(text).toContain('成本目录');
      expect(text).not.toContain('本页配置');
      expect(text).toContain('参考价格条目');
      expect(text).toContain('远程同步');
      expect(text).toContain('同步');
      expect(text).toContain('导入');
      expect(text).toContain('新增条目');
      expect(text).not.toContain('模型身份');
      expect(text).not.toContain('价格表');
      expect(text).not.toContain('高级计价方案');
      expect(text).not.toContain('来源与备注');
      expect(text).not.toContain('价格数据入口');
      expect(text).not.toContain('单位换算');
      expect(text).not.toContain('单位对');
      expect(text).not.toContain('已保存的单位换算');
      expect(text).not.toContain('使用平台目录价格');
      expect(text).not.toContain('价格漂移检查');
      expect(text).not.toContain('上游默认价格');
      expect(text).not.toContain('基准成本单位');
      expect(text).not.toContain('路由 fallback 单价');
      expect(text).not.toContain('手动成本清单');
      expect(text).not.toContain('钱包获取成本');
      expect(text).not.toContain('DeepSeek V4 Flash');
      expect(text).not.toContain('每日余额');
      expect(text).not.toContain('每日来源');
      expect(text).not.toContain('按免费签到填写');
      expect(text).not.toContain('每日获得余额');
      expect(text).not.toContain('充值折扣');
      expect(text).not.toContain('作用域');

      const classNames = collectClassNames(root.root).join(' ');
      expect(classNames).not.toContain('xl:grid-cols-5');
      expect(classNames).not.toContain('xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]');
      expect(classNames).not.toContain('2xl:grid-cols-[minmax(0,1fr)_minmax(440px,520px)]');

      const newEntryButton = root.root.findAll((node) => (
        node.type === 'button'
        && collectText(node).includes('新增条目')
      ))[0];
      expect(newEntryButton).toBeTruthy();
      await act(async () => {
        newEntryButton.props.onClick();
      });
      const dialogText = collectText(root.root);
      expect(dialogText).toContain('模型身份');
      expect(dialogText).toContain('价格表');
      expect(dialogText).toContain('高级计价方案');
      expect(dialogText).toContain('来源与备注');
      expect(dialogText).toContain('当前使用上方图形化价格表生成计价方案。');
    } finally {
      root?.unmount();
    }
  });

  it('saves visual entry fields as a reference catalog payload', async () => {
    apiMock.getPricingReferenceCatalog.mockResolvedValue(referenceCatalogWithEntry);
    apiMock.updatePricingReferenceCatalog.mockResolvedValue(referenceCatalogWithEntry);
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/costs']}>
            <CostCatalog />
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const editButton = root.root.findAll((node) => (
        node.type === 'button'
        && collectText(node).includes('编辑')
      ))[0];
      expect(editButton).toBeTruthy();
      await act(async () => {
        editButton.props.onClick({ stopPropagation: () => undefined });
      });

      const inputs = root.root.findAll((node) => node.type === 'input');
      const inputPrice = inputs.find((node) => node.props.value === '5');
      expect(inputPrice).toBeTruthy();

      await act(async () => {
        inputPrice!.props.onChange({ target: { value: '6.5' } });
      });

      const saveButtons = root.root.findAll((node) => (
        node.type === 'button'
        && collectText(node).includes('保存')
      ));
      expect(saveButtons.length).toBeGreaterThanOrEqual(1);

      await act(async () => {
        saveButtons[0].props.onClick();
      });

      expect(apiMock.updatePricingReferenceCatalog).toHaveBeenCalledTimes(1);
      const payload = apiMock.updatePricingReferenceCatalog.mock.calls[0][0];
      expect(payload.entries[payload.entries.length - 1]).toMatchObject({
        id: 'openai:gpt-4o',
        modelName: 'gpt-4o',
        provider: 'openai',
        simpleTokenPricing: {
          inputPerMillion: 6.5,
          outputPerMillion: 15,
        },
      });
    } finally {
      root?.unmount();
    }
  });
});
