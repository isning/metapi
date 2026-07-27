// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import MobileFilterSheet from './MobileFilterSheet.js';

describe('MobileFilterSheet', () => {
  async function renderSheet(onClose = vi.fn()) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MobileFilterSheet open onClose={onClose} title="筛选条件">
          <div>FilterContent</div>
        </MobileFilterSheet>,
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

  it('renders content with the shadcn sheet shell instead of the legacy mobile drawer skin', async () => {
    const rendered = await renderSheet();

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
    expect(document.body.textContent).toContain('筛选条件');
    expect(document.body.textContent).toContain('FilterContent');

    await rendered.cleanup();
  });

  it('closes through the sheet close control', async () => {
    const onClose = vi.fn();
    const rendered = await renderSheet(onClose);

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[data-slot="sheet-close"]')!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    await rendered.cleanup();
  });
});
