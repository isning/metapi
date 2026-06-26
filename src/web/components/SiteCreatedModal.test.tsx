// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SiteCreatedModal from './SiteCreatedModal.js';

describe('SiteCreatedModal', () => {
  async function renderModal(props: React.ComponentProps<typeof SiteCreatedModal>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host);
      root.render(<SiteCreatedModal {...props} />);
    });
    return {
      host,
      root: root!,
      cleanup: async () => {
        await act(async () => {
          root!.unmount();
        });
        host.remove();
      },
    };
  }

  it('uses the shadcn dialog shell and close button instead of a native dialog skin', async () => {
    const onChoice = vi.fn();
    const onClose = vi.fn();
    const rendered = await renderModal(
      {
        siteName: 'Demo Site',
        onChoice,
        onClose,
      },
    );

    expect(document.body.querySelector('dialog')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-content"]')).not.toBeNull();

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]')!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoice).not.toHaveBeenCalled();
    await rendered.cleanup();
  });

  it('keeps both next-step actions visible while promoting API key flow for api-key-first presets', async () => {
    const onChoice = vi.fn();
    const onClose = vi.fn();
    const rendered = await renderModal(
      {
        siteName: 'CodingPlan',
        initializationPresetId: 'codingplan-openai',
        initialSegment: 'apikey',
        onChoice,
        onClose,
      },
    );

    const choiceButtons = Array.from(document.body.querySelectorAll('button'))
      .filter((button) => [
        '添加 API Key（推荐）',
        '添加账号（用户名密码登录）',
      ].includes(button.textContent || ''));

    expect(choiceButtons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        '添加 API Key（推荐）',
        '添加账号（用户名密码登录）',
      ]),
    );
    expect(choiceButtons.every((button) => typeof button.click === 'function')).toBe(true);

    const sessionButton = choiceButtons.find((button) => button.textContent === '添加账号（用户名密码登录）');
    await act(async () => {
      sessionButton!.click();
    });

    expect(onChoice).toHaveBeenCalledWith('session');
    await rendered.cleanup();
  });

  it('uses the supplied session label for OAuth-style session actions', async () => {
    const rendered = await renderModal(
      {
        siteName: 'Codex Site',
        initialSegment: 'session',
        sessionLabel: '添加 OAuth 连接',
        onChoice: () => {},
        onClose: () => {},
      },
    );

    const buttons = Array.from(document.body.querySelectorAll('button'))
      .filter((button) => button.textContent !== 'Close');

    expect(buttons.some((button) => button.textContent === '添加 OAuth 连接')).toBe(true);
    await rendered.cleanup();
  });
});
