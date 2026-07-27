import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import SiteDistributionChart from './SiteDistributionChart.js';

const chartMockState = vi.hoisted(() => ({
  latestSpec: null as Record<string, any> | null,
}));

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { spec: Record<string, any> }) => {
    chartMockState.latestSpec = props.spec;
    return null;
  },
}));

describe('SiteDistributionChart', () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalMutationObserver = globalThis.MutationObserver;

  beforeEach(() => {
    chartMockState.latestSpec = null;
    globalThis.document = {
      documentElement: {
        getAttribute: vi.fn(),
      },
    } as unknown as Document;
    Reflect.deleteProperty(globalThis as typeof globalThis & Record<string, unknown>, 'getComputedStyle');
    Reflect.deleteProperty(globalThis as typeof globalThis & Record<string, unknown>, 'MutationObserver');
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.MutationObserver = originalMutationObserver;
  });

  it('renders with fallback label color when browser theme APIs are unavailable', async () => {
    let renderer!: WebTestRenderer;

    await expect(act(async () => {
      renderer = create(
        <SiteDistributionChart
          data={[
            {
              siteName: 'Demo Site',
              platform: 'demo',
              totalBalance: 12.34,
              rawBalance: 2468,
              rawBalanceUnit: 'POINTS',
              baseCostUnit: 'USD',
              valuedAccountCount: 2,
              valuationWarningCount: 0,
              totalSpend: 1.23,
              accountCount: 2,
            },
          ]}
        />,
      );
    })).resolves.toBeUndefined();

    renderer.unmount();
  });

  it('can switch the distribution calculation to raw balance', async () => {
    let renderer!: WebTestRenderer;

    await act(async () => {
      renderer = create(
        <SiteDistributionChart
          data={[
            {
              siteName: 'Raw Site',
              platform: 'demo',
              totalBalance: 12.34,
              rawBalance: 2468,
              rawBalanceUnit: 'POINTS',
              baseCostUnit: 'USD',
              valuedAccountCount: 1,
              valuationWarningCount: 0,
              totalSpend: 1.23,
              accountCount: 1,
            },
          ]}
        />,
      );
    });

    const rawBalanceButton = renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('').includes('原始余额'));
    expect(rawBalanceButton).toBeTruthy();

    await act(async () => {
      rawBalanceButton?.props.onClick();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('2468.00');
    expect(JSON.stringify(renderer.toJSON())).toContain('POINTS');
    renderer.unmount();
  });

  it('formats raw balance with its unit in valued-balance tooltip details', async () => {
    let renderer!: WebTestRenderer;

    await act(async () => {
      renderer = create(
        <SiteDistributionChart
          data={[
            {
              siteName: 'Tooltip Site',
              platform: 'demo',
              totalBalance: 12.34,
              rawBalance: 2468,
              rawBalanceUnit: 'POINTS',
              baseCostUnit: 'USD',
              valuedAccountCount: 1,
              valuationWarningCount: 0,
              totalSpend: 1.23,
              accountCount: 1,
            },
          ]}
        />,
      );
    });

    const tooltipContent = chartMockState.latestSpec?.tooltip?.mark?.content;
    expect(Array.isArray(tooltipContent)).toBe(true);
    const rawBalanceFormatter = tooltipContent?.[2]?.value;
    expect(typeof rawBalanceFormatter).toBe('function');
    expect(rawBalanceFormatter({
      rawBalance: 2468,
      rawBalanceUnit: 'POINTS',
      rawBalanceUnitMixed: false,
    })).toBe('2468.00 POINTS');

    renderer.unmount();
  });
});
