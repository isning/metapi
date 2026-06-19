// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchModal from './SearchModal.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    search: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../i18n.js', () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div id="location-probe">{`${location.pathname}${location.search}`}</div>;
}

async function flushSearch() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SearchModal results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  async function renderSearchModal(onClose = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <LocationProbe />
          <SearchModal open onClose={onClose} />
        </MemoryRouter>,
      );
    });

    return {
      onClose,
      cleanup: async () => {
        await act(async () => {
          root!.unmount();
        });
        host.remove();
      },
    };
  }

  it('renders account token results and navigates API key accounts to the apikey segment', async () => {
    apiMock.search.mockResolvedValue({
      models: [],
      sites: [],
      checkinLogs: [],
      proxyLogs: [],
      accounts: [
        {
          id: 8,
          username: '',
          balance: 0,
          segment: 'apikey',
          site: { name: 'Key Search Site' },
        },
      ],
      accountTokens: [
        {
          id: 15,
          name: 'search-token',
          tokenGroup: 'default',
          accountId: 8,
          account: { username: '', segment: 'apikey' },
          site: { name: 'Key Search Site' },
        },
      ],
    });

    const rendered = await renderSearchModal();

    await act(async () => {
      const input = document.body.querySelector<HTMLInputElement>('input[cmdk-input]')!;
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      valueSetter.call(input, 'search');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushSearch();

    expect(document.body.textContent).toContain('账号令牌');
    expect(document.body.textContent).toContain('search-token');
    expect(document.body.textContent).toContain('API Key 连接');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[cmdk-list]')).not.toBeNull();

    const accountItem = Array.from(document.body.querySelectorAll<HTMLElement>('[cmdk-item]'))
      .find((item) => item.textContent?.includes('余额 $0.00'));
    expect(accountItem).toBeTruthy();

    await act(async () => {
      accountItem!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      accountItem!.click();
    });

    expect(document.body.querySelector('#location-probe')?.textContent).toBe('/accounts?segment=apikey&focusAccountId=8');
    await rendered.cleanup();
  });

  it('closes through the shadcn dialog close control', async () => {
    apiMock.search.mockResolvedValue({
      models: [],
      sites: [],
      checkinLogs: [],
      proxyLogs: [],
      accounts: [],
      accountTokens: [],
    });
    const onClose = vi.fn();
    const rendered = await renderSearchModal(onClose);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]')!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    await rendered.cleanup();
  });
});
