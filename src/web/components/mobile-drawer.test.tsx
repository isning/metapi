// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import MobileDrawer from './MobileDrawer.js';

describe('MobileDrawer', () => {
  async function renderDrawer(onClose = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MobileDrawer open onClose={onClose} title="导航菜单">
          <div>DrawerContent</div>
        </MobileDrawer>,
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

  it('renders content through the shadcn sheet shell', async () => {
    const rendered = await renderDrawer();

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
    expect(document.body.textContent).toContain('导航菜单');
    expect(document.body.textContent).toContain('DrawerContent');

    await rendered.cleanup();
  });

  it('closes through the sheet close control', async () => {
    const onClose = vi.fn();
    const rendered = await renderDrawer(onClose);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[data-slot="sheet-close"]')!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    await rendered.cleanup();
  });
});
