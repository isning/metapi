import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import ModelDiagnosticsTab from './ModelDiagnosticsTab.js';
import { buildModelDetailsView, type ModelRow } from './modelDetailsView.js';
import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import type { ModelRouteFlowDiagnostics } from '../../api.js';
import { tr } from '../../i18n.js';

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => (
    typeof child === 'string' ? child : collectText(child)
  )).join('');
}

function createModel(): ModelRow {
  return {
    name: 'gpt-4o',
    accountCount: 1,
    tokenCount: 1,
    managedTokenCount: 1,
    credentialCount: 1,
    endpointCount: 1,
    executionAttemptCount: 1,
    avgLatency: null,
    successRate: null,
    description: null,
    tags: [],
    supportedEndpointTypes: [],
    runtimeInventoryIssues: [],
    pricingSources: [],
    measuredEntryPricing: null,
    accounts: [],
    siteCounts: {},
  };
}

function createRouteFlow(): ModelRouteFlowData {
  return {
    requestedModel: 'gpt-4o',
    matched: true,
    diagnostics: [{ level: 'info', message: 'compiled route ready' }],
    compiledRuntime: null,
    projectedAt: '2026-07-07T00:00:00.000Z',
  };
}

function createDetails(input: {
  routeFlow: ModelRouteFlowData | null;
  routeFlowDiagnostics?: ModelRouteFlowDiagnostics | null;
  routeFlowLoading?: boolean;
  routeFlowError?: string;
  routeFlowDiagnosticsError?: string;
}) {
  return buildModelDetailsView({
    model: createModel(),
    brandName: null,
    routeFlow: input.routeFlow,
    routeFlowDiagnostics: input.routeFlowDiagnostics ?? null,
    routeFlowDiagnosticsError: input.routeFlowDiagnosticsError ?? '',
    routeFlowLoading: input.routeFlowLoading ?? false,
    routeFlowError: input.routeFlowError ?? '',
    observability: null,
    observabilityLoading: false,
    observabilityError: '',
  });
}

describe('ModelDiagnosticsTab rendering', () => {
  it('uses prefetched diagnostics entries without showing the diagnostics list loader', () => {
    const prefetchedDiagnostics: ModelRouteFlowDiagnostics = {
      requestedModel: 'gpt-4o',
      actualModel: 'gpt-4o',
      matched: true,
      entryId: 'entry:route-fixture:gpt-4o',
      selectedEndpointId: null,
      selectedAccountId: null,
      diagnostics: [{ level: 'info', message: 'compiled route ready' }],
      projectedAt: '2026-07-07T00:00:00.000Z',
    };

    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ModelDiagnosticsTab
          diagnostics={createDetails({
            routeFlow: null,
            routeFlowDiagnostics: prefetchedDiagnostics,
            routeFlowLoading: true,
          }).diagnosticsView}
        />,
      );
    });

    expect(collectText(root.root)).toContain('compiled route ready');
    expect(root.root.findAll((node) => node.props.role === 'status' && node.props['aria-busy'] === 'true')).toHaveLength(1);
    expect(collectText(root.root)).not.toContain('"diagnostics"');
    root.unmount();
  });

  it('uses an empty prefetched diagnostics result without showing the diagnostics list loader', () => {
    const prefetchedDiagnostics: ModelRouteFlowDiagnostics = {
      requestedModel: 'gpt-4o',
      actualModel: 'gpt-4o',
      matched: true,
      entryId: 'entry:route-fixture:gpt-4o',
      selectedEndpointId: null,
      selectedAccountId: null,
      diagnostics: [],
      projectedAt: '2026-07-07T00:00:00.000Z',
    };

    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ModelDiagnosticsTab
          diagnostics={createDetails({
            routeFlow: null,
            routeFlowDiagnostics: prefetchedDiagnostics,
            routeFlowLoading: true,
          }).diagnosticsView}
        />,
      );
    });

    expect(root.root.findAll((node) => node.props.role === 'status' && node.props['aria-busy'] === 'true')).toHaveLength(1);
    root.unmount();
  });

  it('does not render a temporary diagnostics-only JSON object while route flow is loading', () => {
    let root!: ReturnType<typeof create>;

    act(() => {
      root = create(
        <ModelDiagnosticsTab diagnostics={createDetails({ routeFlow: null, routeFlowLoading: true }).diagnosticsView} />,
      );
    });

    expect(root.root.findAll((node) => node.props.role === 'status' && node.props['aria-busy'] === 'true')).toHaveLength(2);
    expect(collectText(root.root)).not.toContain(tr('pages.models.modelOverviewTab.loadingRouteFlow'));
    expect(collectText(root.root)).not.toContain('"diagnostics"');
    expect(collectText(root.root)).not.toContain(tr('pages.models.modelRoutingTab.noRouteFlow'));

    act(() => {
      root.update(
        <ModelDiagnosticsTab diagnostics={createDetails({ routeFlow: createRouteFlow(), routeFlowLoading: false }).diagnosticsView} />,
      );
    });

    expect(collectText(root.root)).toContain('compiled route ready');
    expect(collectText(root.root)).toContain('"requestedModel"');
    expect(collectText(root.root)).toContain('"diagnostics"');
    root.unmount();
  });

  it('renders a diagnostics request failure instead of an empty diagnostics state', () => {
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ModelDiagnosticsTab
          diagnostics={createDetails({
            routeFlow: null,
            routeFlowLoading: false,
            routeFlowDiagnosticsError: 'diagnostics request failed',
          }).diagnosticsView}
        />,
      );
    });

    const text = collectText(root.root);
    expect(text).toContain('diagnostics request failed');
    expect(text).not.toContain(tr('pages.models.modelDiagnosticsTab.noDiagnostics'));
    root.unmount();
  });

  it('renders a route-flow payload failure instead of an empty JSON state', () => {
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ModelDiagnosticsTab
          diagnostics={createDetails({
            routeFlow: null,
            routeFlowLoading: false,
            routeFlowError: 'route flow request failed',
          }).diagnosticsView}
        />,
      );
    });

    const text = collectText(root.root);
    expect(text).toContain('route flow request failed');
    expect(text).not.toContain(tr('pages.models.modelRoutingTab.noRouteFlow'));
    root.unmount();
  });
});
