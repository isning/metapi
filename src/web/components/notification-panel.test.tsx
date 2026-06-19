// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationPanel from './NotificationPanel.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getEvents: vi.fn(),
    markAllEventsRead: vi.fn(),
    clearEvents: vi.fn(),
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

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('NotificationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  async function renderPanel(onUnreadCountChange = vi.fn(), onClose = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const anchorRef = React.createRef<HTMLButtonElement>();
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <button ref={anchorRef} type="button">anchor</button>
          <NotificationPanel
            open
            onClose={onClose}
            anchorRef={anchorRef}
            onUnreadCountChange={onUnreadCountChange}
          />
        </MemoryRouter>,
      );
    });
    await flushEffects();

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

  it('renders events with shadcn shells and marks unread events read on open', async () => {
    const onUnreadCountChange = vi.fn();
    apiMock.getEvents.mockResolvedValue([
      {
        id: 1,
        type: 'proxy',
        level: 'warning',
        title: 'Proxy Warning',
        message: 'Latency crossed threshold',
        createdAt: '2026-06-19T10:00:00.000Z',
        read: false,
      },
    ]);
    apiMock.markAllEventsRead.mockResolvedValue({ success: true });
    apiMock.clearEvents.mockResolvedValue({ success: true });

    const rendered = await renderPanel(onUnreadCountChange);

    expect(document.body.textContent).toContain('通知');
    expect(document.body.textContent).toContain('Proxy Warning');
    expect(document.body.textContent).toContain('Latency crossed threshold');
    expect(apiMock.markAllEventsRead).toHaveBeenCalledTimes(1);
    expect(onUnreadCountChange).toHaveBeenCalledWith(0);
    expect(document.body.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(Array.from(document.body.querySelectorAll('button')).some((button) => button.textContent === '清空')).toBe(true);

    await rendered.cleanup();
  });

  it('clears events through the shadcn action button', async () => {
    apiMock.getEvents.mockResolvedValue([]);
    apiMock.clearEvents.mockResolvedValue({ success: true });
    const onUnreadCountChange = vi.fn();

    const rendered = await renderPanel(onUnreadCountChange);

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent === '清空')!
        .click();
    });

    expect(apiMock.clearEvents).toHaveBeenCalledTimes(1);
    expect(onUnreadCountChange).toHaveBeenCalledWith(0);
    await rendered.cleanup();
  });

  it('keeps the legacy outside-click close behavior without the legacy dropdown shell', async () => {
    apiMock.getEvents.mockResolvedValue([]);
    const onClose = vi.fn();
    const rendered = await renderPanel(vi.fn(), onClose);

    await act(async () => {
      document.body.querySelector('button')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await rendered.cleanup();
  });
});
