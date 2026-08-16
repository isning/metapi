import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import ModernSelect from '../components/ModernSelect.js';
import { ToastProvider } from '../components/Toast.js';
import Accounts from './Accounts.js';
import { installAccountsSnapshotCompat } from './testApiCompat.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getAccounts: vi.fn(),
    getAccountsSnapshot: vi.fn(),
    getSites: vi.fn(),
    getAccountTokens: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function renderAccounts(
  initialEntry: string,
  sites: Array<{ id: number; name: string; url?: string; platform: string; status: string; credentialCapabilities?: { session: boolean; apiKey: boolean } }> = [
    { id: 10, name: 'Demo Site', platform: 'new-api', status: 'active', credentialCapabilities: { session: true, apiKey: true } },
  ],
) {
  apiMock.getAccounts.mockResolvedValue([]);
  apiMock.getSites.mockResolvedValue(sites);
  apiMock.getAccountTokens.mockResolvedValue([]);

  let root!: WebTestRenderer;
  await act(async () => {
    root = create(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Accounts />
        </ToastProvider>
      </MemoryRouter>,
    );
  });
  await flushMicrotasks();
  return root!;
}

describe('Accounts create intent handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAccountsSnapshotCompat(apiMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the session add modal and preselects the site for session create intent', async () => {
    const root = await renderAccounts('/accounts?create=1&siteId=10');
    try {
      const rendered = JSON.stringify(root.toJSON());
      expect(rendered).toContain('添加 Session 连接');
      expect(rendered).not.toContain('添加 API Key 连接');

      const selects = root.root.findAllByType(ModernSelect);
      expect(selects[1]?.props.value).toBe('10');
    } finally {
      root?.unmount();
    }
  });

  it('opens the apikey add modal and preselects the site for apikey create intent', async () => {
    const root = await renderAccounts('/accounts?segment=apikey&create=1&siteId=10');
    try {
      const rendered = JSON.stringify(root.toJSON());
      expect(rendered).toContain('添加 API Key 连接');

      const selects = root.root.findAllByType(ModernSelect);
      expect(selects[1]?.props.value).toBe('10');
    } finally {
      root?.unmount();
    }
  });

  it('uses searchable site selectors for manual connection creation', async () => {
    const root = await renderAccounts('/accounts', [
      { id: 10, name: 'Demo Site', url: 'https://demo.example.com', platform: 'new-api', status: 'active', credentialCapabilities: { session: true, apiKey: true } },
      { id: 11, name: 'Codex Workspace', url: 'https://workspace.example.com', platform: 'codex', status: 'active', credentialCapabilities: { session: false, apiKey: false } },
    ]);
    try {
      const addButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).includes('添加连接')
      ));

      await act(async () => {
        addButton.props.onClick();
      });
      await flushMicrotasks();

      const selects = root.root.findAllByType(ModernSelect);
      const siteSelect = selects.find((select) => (
        select.props.options.some((option: { value: string }) => option.value === '10')
      ));
      expect(siteSelect?.props.searchable).toBe(true);
      expect(siteSelect?.props.searchPlaceholder).toBe('筛选站点（名称 / 平台 / URL）');
      expect(siteSelect?.props.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: '10',
            label: 'Demo Site (new-api)',
            description: 'https://demo.example.com',
          }),
        ]),
      );
    } finally {
      root?.unmount();
    }
  });

  it('ignores create intent in the tokens segment', async () => {
    const root = await renderAccounts('/accounts?segment=tokens&create=1&siteId=10');
    try {
      const rendered = JSON.stringify(root.toJSON());
      expect(rendered).not.toContain('添加 Session 连接');
      expect(rendered).not.toContain('添加 API Key 连接');
    } finally {
      root?.unmount();
    }
  });
});
