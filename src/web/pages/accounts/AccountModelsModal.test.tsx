import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import AccountModelsModal from './AccountModelsModal.js';

vi.mock('../../components/Toast.js', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

vi.mock('../../components/CenteredModal.js', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

describe('AccountModelsModal', () => {
  it('does not schedule another render while closed with unchanged model state', async () => {
    const onSave = vi.fn();
    await act(async () => {
      create(
        <AccountModelsModal
          modelModal={{
            open: false,
            account: { id: 1, siteId: 1 },
            models: [{ name: 'gpt-4', latencyMs: null, disabled: false }],
            loading: false,
            saving: false,
            siteName: 'Site A',
          }}
          onClose={vi.fn()}
          onSave={onSave}
          onRefresh={vi.fn()}
          onReload={vi.fn()}
          onAddManualModels={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('labels configured system-default pricing instead of falling back to not configured', async () => {
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(
        <AccountModelsModal
          modelModal={{
            open: true,
            account: { id: 1, siteId: 1 },
            models: [{
              name: 'gpt-4',
              latencyMs: null,
              disabled: false,
              costPricing: {
                status: 'configured',
                configured: true,
                matchedScope: 'system_default',
                pricingId: null,
                totalCost: 1,
              },
            }],
            loading: false,
            saving: false,
            siteName: 'Site A',
          }}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onRefresh={vi.fn()}
          onReload={vi.fn()}
          onAddManualModels={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    expect(JSON.stringify(root.toJSON())).toContain('系统默认');
    expect(JSON.stringify(root.toJSON())).not.toContain('未配置成本');
    root.unmount();
  });
});
