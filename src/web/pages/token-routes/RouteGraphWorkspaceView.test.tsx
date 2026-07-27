import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphWorkspaceIndexPage,
} from '../../../shared/routeGraphWorkspace.js';
import type { RouteGraphNodeType } from '../../../shared/routeGraph.js';
import { ToastProvider } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import { Select } from '../../components/ui/select/index.js';
import { tr } from '../../i18n.js';

const state = vi.hoisted(() => ({
  canvasModuleLoaded: false,
  forceTabsContent: false,
  nodeType: 'entry' as RouteGraphNodeType,
  api: {
    getRouteGraphWorkspaceIndex: vi.fn(),
    getRouteGraphWorkspaceResume: vi.fn(),
    getRouteGraphFocusedWorkspace: vi.fn(),
    applyRouteGraphWorkspaceOperations: vi.fn(),
    createRouteGraphWorkspaceNode: vi.fn(),
    reserveRouteGraphWorkspaceNode: vi.fn(),
    createRouteGraphWorkspaceMacro: vi.fn(),
    getRouteGraphWorkspaceOperationBatches: vi.fn(),
    replayRouteGraphWorkspaceOperationBatch: vi.fn(),
    getRouteGraphWorkspaceRemovalImpact: vi.fn(),
    getRouteGraphWorkspaceConnectionTargets: vi.fn(),
    createRouteGraphWorkspaceConnection: vi.fn(),
    draftRouteGraphWorkspaceConnection: vi.fn(),
    queryRouteGraphWorkspaceConnectionTargets: vi.fn(),
    validateRouteGraphWorkspace: vi.fn(),
    publishRouteGraphDraft: vi.fn(),
    getRuntimeSettings: vi.fn(),
  },
}));

vi.mock('../../api.js', () => ({ api: state.api }));

vi.mock('../../components/ui/tabs/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../components/ui/tabs/index.js')>(
    '../../components/ui/tabs/index.js',
  );
  const ActualTabsContent = actual.TabsContent;
  function TabsContent({ forceMount, ...props }: ComponentProps<typeof ActualTabsContent>) {
    return <ActualTabsContent forceMount={state.forceTabsContent || forceMount} {...props} />;
  }
  return { ...actual, TabsContent };
});

vi.mock('./RouteGraphNodeMenu.js', () => ({
  default: ({ disabled, onSelect }: { disabled?: boolean; onSelect: (type: RouteGraphNodeType) => void }) => (
    <button
      type="button"
      disabled={disabled}
      data-testid="route-graph-add-node"
      onClick={() => onSelect(state.nodeType)}
    >
      add node
    </button>
  ),
}));

vi.mock('./RouteGraphFocusCanvas.js', async () => {
  state.canvasModuleLoaded = true;
  return {
    default: ({ workspace, graph, onGraphChange, onCreateNode, onSelect, onOpenPortal }: {
      workspace: RouteGraphFocusedWorkspace;
      graph: RouteGraphFocusedWorkspace['residentGraph'];
      onGraphChange: (graph: RouteGraphFocusedWorkspace['residentGraph']) => void;
      onCreateNode: (type: 'entry', position: { x: number; y: number }) => Promise<unknown>;
      onSelect: (selection: { kind: 'node'; item: RouteGraphFocusedWorkspace['residentGraph']['nodes'][number] } | { kind: 'portal'; item: RouteGraphFocusedWorkspace['portals'][number] }) => void;
      onOpenPortal: (portal: RouteGraphFocusedWorkspace['portals'][number]) => void;
    }) => (
      <div data-testid="focus-canvas">
        <span data-testid="focus-node-count">{graph.nodes.length}</span>
        <button
          data-testid="focus-add-node"
          type="button"
          onClick={() => void onCreateNode('entry', { x: 320, y: 180 })}
        >
          add focused node
        </button>
        {graph.nodes[0] && (
          <>
            <button
              data-testid="edit-resident"
              type="button"
              onClick={() => onGraphChange({
                ...graph,
                nodes: graph.nodes.map((node, index) => index === 0 ? { ...node, name: 'Edited resident' } : node),
              })}
            >
              edit
            </button>
            <button
              data-testid="select-resident"
              type="button"
              onClick={() => onSelect({ kind: 'node', item: graph.nodes[0]! })}
            >
              select
            </button>
          </>
        )}
        {workspace.portals.map((portal) => (
          <span key={portal.id}>
            <button data-testid={`portal-${portal.id}`} type="button" onClick={() => onOpenPortal(portal)}>{portal.label}</button>
            <button data-testid={`select-portal-${portal.id}`} type="button" onClick={() => onSelect({ kind: 'portal', item: portal })}>select portal</button>
          </span>
        ))}
      </div>
    ),
  };
});

import RouteGraphWorkspaceView from './RouteGraphWorkspaceView.js';
import RouteGraphFocusInspector from './RouteGraphFocusInspector.js';
import { FilterOperationsEditor } from './NodeForm.js';

function indexPage(label: string, nextCursor: string | null = null): RouteGraphWorkspaceIndexPage {
  return {
    revision: 'draft:1:0:2',
    summary: { nodes: 3, edges: 2, macros: 2, focuses: 2, errors: 0, warnings: 0 },
    items: [{
      focus: { kind: 'macro', id: `focus-${label}` },
      label,
      subtitle: 'candidate_selector',
      elementKind: 'macro',
      status: 'enabled',
      ownership: 'system',
      counts: { directConnections: 2, errors: 0, warnings: 0 },
    }],
    nextCursor,
    totalCount: 2,
  };
}

function focusedWorkspace(
  focusId: string,
  portals: RouteGraphFocusedWorkspace['portals'] = [],
  representation: RouteGraphFocusedWorkspace['representation'] = 'semantic',
  withResidentNode = false,
  primitiveAvailable = true,
  residentNodeType: 'entry' | 'filter' = 'entry',
  residentNodeId = 'resident-node',
): RouteGraphFocusedWorkspace {
  const residentNode = residentNodeType === 'filter'
    ? {
        id: residentNodeId,
        type: 'filter' as const,
        name: 'Resident filter',
        enabled: true,
        ownership: 'manual' as const,
        operations: [],
      }
    : {
        id: residentNodeId,
        type: 'entry' as const,
        name: 'Resident',
        enabled: true,
        ownership: 'manual' as const,
        match: {
          kind: 'model' as const,
          requestedModelPattern: 'resident',
          displayName: 'Resident',
          downstreamProtocol: null,
          upstreamProtocol: null,
          sitePlatform: null,
          accountId: null,
          tokenId: null,
          siteId: null,
        },
      };
  return {
    revision: 'draft:1:0:2',
    representation,
    focus: { kind: 'macro', id: focusId, label: focusId, subtitle: null },
    residentGraph: { nodes: withResidentNode ? [residentNode] : [], edges: [], macros: [], metadata: {} },
    residentElements: withResidentNode
      ? [{ element: { kind: 'node', id: residentNode.id }, graphElementId: residentNode.id }]
      : [],
    portals,
    diagnostics: [],
    totals: { nodes: 0, edges: 0, macros: 1 },
    capabilities: { editable: representation === 'semantic', primitiveAvailable },
  };
}

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : collectText(child)).join('');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createWorkspaceRouter(url: string) {
  return createMemoryRouter([{
    path: '*',
    element: (
      <ToastProvider>
        <RouteGraphWorkspaceView />
      </ToastProvider>
    ),
  }], { initialEntries: [url] });
}

function renderAt(url: string) {
  return create(<RouterProvider router={createWorkspaceRouter(url)} />);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function signalTransport() {
  return expect.objectContaining({ signal: expect.anything() });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.canvasModuleLoaded = false;
  state.forceTabsContent = false;
  state.nodeType = 'entry';
  state.api.getRuntimeSettings.mockResolvedValue({
    dispatchPolicyRegistry: {
      defaultPolicyId: 'platform-default',
      policies: [],
    },
  });
  state.api.getRouteGraphWorkspaceResume.mockResolvedValue({ revision: 'draft:1:0:2', focus: null });
  state.api.applyRouteGraphWorkspaceOperations.mockResolvedValue({ revision: 'draft:1:0:3', batchId: 1 });
  state.api.getRouteGraphWorkspaceOperationBatches.mockResolvedValue([]);
  state.api.replayRouteGraphWorkspaceOperationBatch.mockResolvedValue({ revision: 'draft:1:0:3', batchId: 2 });
  state.api.createRouteGraphWorkspaceNode.mockImplementation((payload: { node: Record<string, unknown> }) => ({
    revision: 'draft:1:0:3',
    node: { ...payload.node, id: `manual:${String(payload.node.type)}:server-issued` },
  }));
  state.api.getRouteGraphWorkspaceRemovalImpact.mockResolvedValue({
    revision: 'draft:1:0:2',
    element: { kind: 'node', id: 'resident-node' },
    elementLabel: 'Resident',
    incidentConnections: { total: 0, incoming: 0, outgoing: 0 },
  });
  state.api.reserveRouteGraphWorkspaceNode.mockImplementation((payload: { node: Record<string, unknown> }) => ({
    node: { ...payload.node, id: 'manual:entry:server-issued' },
  }));
  state.api.validateRouteGraphWorkspace.mockResolvedValue({ ok: true, diagnostics: [] });
  state.api.publishRouteGraphDraft.mockResolvedValue({ success: true });
  state.api.createRouteGraphWorkspaceConnection.mockResolvedValue({ success: true, revision: 'draft:1:0:3' });
  state.api.queryRouteGraphWorkspaceConnectionTargets.mockResolvedValue({
    revision: 'draft:1:0:2',
    source: {
      endpoint: { element: { kind: 'node', id: 'resident-node' }, portId: 'bidirect.out' },
      graphElementId: 'resident-node', elementLabel: 'Resident', elementKind: 'entry', elementSubtitle: 'entry',
      enabled: true, ownership: 'manual', port: { id: 'bidirect.out', label: 'Matched flow', direction: 'output', kind: 'bidirect' },
      focuses: [{ focus: { kind: 'node', id: 'resident-node' }, label: 'Resident' }],
    },
    items: [], nextCursor: null, totalCount: 0,
  });
});

describe('RouteGraphWorkspaceView lifecycle', () => {
  it('loads only the paged Index and does not mount the Focus canvas in Overview', async () => {
    state.api.getRouteGraphWorkspaceIndex.mockResolvedValue(indexPage('Macro A'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();

    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null, limit: 40 }),
      signalTransport(),
    );
    expect(state.api.getRouteGraphFocusedWorkspace).not.toHaveBeenCalled();
    expect(root.root.findAllByProps({ 'data-testid': 'focus-canvas' })).toHaveLength(0);
    expect(collectText(root.root)).toContain('Macro A');
  });

  it('continues the most recently saved draft Focus from the server resume read model', async () => {
    state.api.getRouteGraphWorkspaceIndex.mockResolvedValue(indexPage('Macro A'));
    state.api.getRouteGraphWorkspaceResume.mockResolvedValue({
      revision: 'draft:1:0:2',
      focus: { kind: 'node', id: 'manual:entry:resume' },
    });
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(focusedWorkspace('manual:entry:resume'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();
    const continueButton = root.root.findAllByType('button').find((button) => (
      collectText(button).includes('继续编辑草稿') || collectText(button).includes('Continue editing draft')
    ))!;
    await act(async () => { continueButton.props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ focus: { kind: 'node', id: 'manual:entry:resume' } }),
      signalTransport(),
    );
  });

  it.each([
    ['entry', { match: { kind: 'model', requestedModelPattern: '', currentModelPattern: '', displayName: null } }],
    ['filter', { operations: [] }],
    ['dispatcher', { mode: 'route', ordering: 'explicit', policy: { kind: 'inherit_default' } }],
    ['route_endpoint', {
      endpointKind: 'supply',
      backend: { kind: 'supply' },
      config: { targets: [], targetSelection: { kind: 'defer_to_router' } },
    }],
    ['synthetic_endpoint', { statusCode: 503, message: 'Route unavailable' }],
  ] as const)('creates a %s primitive from the Index and opens its node Focus', async (nodeType, expectedFields) => {
    state.nodeType = nodeType;
    state.api.getRouteGraphWorkspaceIndex.mockResolvedValue(indexPage('Macro A'));
    state.api.getRouteGraphFocusedWorkspace.mockImplementation((options: { focus: { id: string } }) => (
      Promise.resolve(focusedWorkspace(options.focus.id, [], 'semantic', true))
    ));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'route-graph-add-node' }).props.onClick(); });
    await flush();

    expect(state.api.createRouteGraphWorkspaceNode).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      node: expect.objectContaining({
        type: nodeType,
        enabled: true,
        ownership: 'manual',
        position: { x: 120, y: 120 },
        ...expectedFields,
      }),
    });
    const createdNode = { id: `manual:${nodeType}:server-issued` };
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ focus: { kind: 'node', id: createdNode.id }, representation: 'semantic' }),
      signalTransport(),
    );
    if (nodeType === 'route_endpoint') {
      expect(state.api.createRouteGraphWorkspaceNode.mock.calls[0]?.[0].node).not.toHaveProperty('routeEndpointId');
    }
  });

  it('keeps a server-created disconnected node resident in the current Focus', async () => {
    state.api.getRouteGraphFocusedWorkspace.mockImplementation((options: { focus: { id: string } }) => (
      Promise.resolve(focusedWorkspace(options.focus.id, [], 'semantic', true))
    ));

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=node&graphFocusId=resident-node');
    });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'focus-add-node' }).props.onClick(); });
    await flush();

    expect(state.api.reserveRouteGraphWorkspaceNode).toHaveBeenCalledWith({
      node: expect.objectContaining({ type: 'entry', position: { x: 320, y: 180 } }),
    });
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(1);
    expect(collectText(root.root.findByProps({ 'data-testid': 'focus-node-count' }))).toBe('2');
  });

  it('persists a filter operation edited through the real Inspector and Save action', async () => {
    state.forceTabsContent = true;
    const workspace = focusedWorkspace('filter-node', [], 'semantic', true, true, 'filter', 'filter-node');
    workspace.focus = { kind: 'node', id: 'filter-node', label: 'Resident filter', subtitle: 'filter' };
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(workspace);

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=node&graphFocusId=filter-node');
    });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'select-resident' }).props.onClick(); });

    const configTab = root.root.findAllByType('button').find((button) => (
      button.props.role === 'tab'
      && (collectText(button).includes('配置') || collectText(button).includes('Config'))
    ))!;
    await act(async () => {
      configTab.props.onMouseDown({ button: 0, ctrlKey: false, preventDefault: vi.fn() });
    });
    await flush();
    expect(configTab.props['data-state']).toBe('active');
    const filterEditor = root.root.findByType(FilterOperationsEditor);
    const addFilter = filterEditor.findAllByType(Button).find((button) => button.props.variant === 'outline')!;
    await act(async () => { addFilter.props.onClick(); });
    const typeSelect = root.root.findAllByType(Select).find((select) => select.props.value === 'rewrite_model')!;
    await act(async () => { typeSelect.props.onValueChange('set_payload'); });

    const saveButton = root.root.findAllByType('button').find((button) => (
      (collectText(button).includes('保存') || collectText(button).includes('Save')) && !button.props.disabled
    ))!;
    await act(async () => { await saveButton.props.onClick(); });
    await flush();

    expect(state.api.applyRouteGraphWorkspaceOperations).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      operations: [{
        kind: 'upsert_node',
        node: expect.objectContaining({
          id: 'filter-node',
          type: 'filter',
          operations: [{ type: 'set_payload', path: '', value: '', mode: 'default' }],
        }),
      }],
    });
  });

  it('commits removal of the active node Focus and returns to the Index without rendering an empty Focus', async () => {
    const workspace = focusedWorkspace('resident-node', [], 'semantic', true);
    workspace.focus = { kind: 'node', id: 'resident-node', label: 'Resident', subtitle: 'entry' };
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(workspace);
    state.api.getRouteGraphWorkspaceIndex.mockResolvedValue(indexPage('Remaining Macro'));

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=node&graphFocusId=resident-node');
    });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'select-resident' }).props.onClick(); });
    const deleteButton = root.root.findAllByType('button').find((button) => {
      const label = collectText(button);
      return label.includes('删除') || label.includes('Delete');
    })!;
    await act(async () => { deleteButton.props.onClick(); });
    await flush();
    const confirmDialog = root.root.findByProps({ role: 'alertdialog' });
    const confirmButton = confirmDialog.findAllByType('button').find((button) => {
      const label = collectText(button);
      return label.includes('删除') || label.includes('Delete');
    })!;
    await act(async () => { confirmButton.props.onClick(); });
    const saveButton = root.root.findAllByType('button').find((button) => (
      (collectText(button).includes('保存') || collectText(button).includes('Save')) && !button.props.disabled
    ))!;
    await act(async () => { await saveButton.props.onClick(); });
    await flush();

    expect(state.api.applyRouteGraphWorkspaceOperations).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      operations: [{ kind: 'remove_node', nodeId: 'resident-node' }],
    });
    expect(state.api.getRouteGraphWorkspaceRemovalImpact).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      element: { kind: 'node', id: 'resident-node' },
    });
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(1);
    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null, limit: 40 }),
      signalTransport(),
    );
    expect(collectText(root.root)).toContain('Remaining Macro');
  });

  it('replaces the Index page when following an opaque server cursor', async () => {
    state.api.getRouteGraphWorkspaceIndex
      .mockResolvedValueOnce(indexPage('Macro A', 'opaque-next'))
      .mockResolvedValueOnce(indexPage('Macro B', null));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();
    const nextButton = root.root.findAllByType('button').find((button) => {
      const label = collectText(button);
      return label.includes('common.next') || label.includes('下一') || label.includes('Next');
    })!;
    await act(async () => { nextButton.props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'opaque-next' }),
      signalTransport(),
    );
    expect(collectText(root.root)).toContain('Macro B');
    expect(collectText(root.root)).not.toContain('Macro A');
  });

  it('loads an explicit URL Focus without requesting the Index', async () => {
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(focusedWorkspace('macro-a'));

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a');
    });
    await flush();

    expect(state.api.getRouteGraphWorkspaceIndex).not.toHaveBeenCalled();
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledWith(
      {
        focus: { kind: 'macro', id: 'macro-a' },
        representation: 'semantic',
        windowToken: undefined,
      },
      signalTransport(),
    );
    expect(root.root.findByProps({ 'data-testid': 'focus-canvas' })).toBeTruthy();
    expect(root.root.findByProps({ 'data-testid': 'route-graph-inspector-empty' })).toBeTruthy();
  });

  it('locates a focused diagnostic and opens the complete resident Inspector', async () => {
    const workspace = focusedWorkspace('macro-a', [], 'semantic', true);
    workspace.diagnostics = [{
      severity: 'error',
      code: 'graph.test_error',
      message: 'Resident entry is invalid',
      nodeId: 'resident-node',
    }];
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(workspace);

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a');
    });
    await flush();

    expect(root.root.findByProps({ 'data-testid': 'route-graph-diagnostics-panel' })).toBeTruthy();
    const diagnosticButton = root.root.findAllByType('button').find((button) => collectText(button).includes('graph.test_error'))!;
    await act(async () => { diagnosticButton.props.onClick(); });

    const inspector = root.root.findByProps({ 'data-testid': 'route-graph-inspector' });
    const inspectorText = collectText(inspector);
    expect(inspectorText).toContain(tr('pages.tokenRoutes.routeGraphWorkspace.tab.overview'));
    expect(inspectorText).toContain(tr('pages.tokenRoutes.routeGraphWorkspace.tab.config'));
    expect(inspectorText).toContain(tr('pages.tokenRoutes.routeGraphWorkspace.tab.ports'));
    expect(inspectorText).toContain(tr('pages.tokenRoutes.routeGraphWorkspace.tab.connections'));
    expect(inspectorText).toContain(tr('pages.tokenRoutes.routeGraphWorkspace.tab.diagnostics'));
  });

  it('replaces focused diagnostics with the validate response', async () => {
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(focusedWorkspace('macro-a'));
    state.api.validateRouteGraphWorkspace.mockResolvedValue({
      ok: false,
      diagnostics: [{
        severity: 'warning',
        code: 'graph.validation_warning',
        message: 'Validation warning from the current draft',
      }],
    });

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a');
    });
    await flush();
    const validateButton = root.root.findAllByType('button').find((button) => (
      collectText(button).includes(tr('pages.tokenRoutes.routeGraphWorkspace.validate'))
    ))!;
    await act(async () => { await validateButton.props.onClick(); });
    await flush();

    expect(collectText(root.root.findByProps({ 'data-testid': 'route-graph-diagnostics-panel' }))).toContain('graph.validation_warning');
  });

  it('uses a Portal destination Focus exactly as returned by the server', async () => {
    const portal = {
      id: 'portal-neighbor',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'macro' as const, id: 'macro-a' }, portId: 'bidirect.out' },
      label: 'Macro B',
      connection: { edgeKind: 'bidirect_flow' as const, count: 1, portLabel: 'Matched flow', edges: [{ id: 'edge-neighbor', destinationPortId: 'bidirect.in', ownership: 'manual' as const }] },
      preview: { elementKind: 'macro' as const, subtitle: 'candidate_selector', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'macro' as const, id: 'server-macro-b' } },
    };
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('macro-a', [portal]))
      .mockResolvedValueOnce(focusedWorkspace('server-macro-b'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-neighbor' }).props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      {
        focus: { kind: 'macro', id: 'server-macro-b' },
        representation: 'semantic',
        windowToken: undefined,
      },
      signalTransport(),
    );
  });

  it('inspects, deletes, and starts atomic rewire for an exact boundary edge', async () => {
    const portal = {
      id: 'portal-managed-edge',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'node' as const, id: 'resident-node' }, portId: 'bidirect.out' },
      label: 'Remote filter',
      connection: {
        edgeKind: 'bidirect_flow' as const,
        count: 1,
        portLabel: 'Matched flow',
        edges: [{ id: 'edge-cross-focus', destinationPortId: 'bidirect.in', ownership: 'manual' as const }],
      },
      preview: { elementKind: 'filter' as const, subtitle: 'filter', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'node' as const, id: 'remote-filter' } },
    };
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('resident-node', [portal], 'semantic', true))
      .mockResolvedValue(focusedWorkspace('resident-node', [], 'semantic', true));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=node&graphFocusId=resident-node'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'select-portal-portal-managed-edge' }).props.onClick(); });
    const inspector = root.root.findByType(RouteGraphFocusInspector);
    await act(async () => { inspector.props.onRewirePortalEdge(portal.resident, 'edge-cross-focus'); });
    await flush();
    expect(state.api.queryRouteGraphWorkspaceConnectionTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        source: portal.resident,
        replacingEdgeId: 'edge-cross-focus',
      }),
      signalTransport(),
    );

    const closeDialog = root.root.findByProps({ 'data-slot': 'dialog-close' });
    await act(async () => { closeDialog.props.onClick(); });
    await act(async () => { inspector.props.onDeletePortalEdge('edge-cross-focus'); });
    await flush();
    expect(state.api.applyRouteGraphWorkspaceOperations).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      operations: [{ kind: 'remove_edge', edgeId: 'edge-cross-focus' }],
    });
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(2);
  });

  it('replaces a collection window using the opaque token without changing Focus', async () => {
    const portal = {
      id: 'portal-window',
      kind: 'collection' as const,
      direction: 'incoming' as const,
      resident: { element: { kind: 'macro' as const, id: 'macro-a' }, portId: 'candidates.in' },
      label: 'More endpoints',
      connection: { edgeKind: 'route_flow' as const, count: 76, portLabel: 'Candidate inputs' },
      collection: { action: 'next' as const, start: 24, end: 48, total: 100 },
      destination: { kind: 'window' as const, token: 'server-window-token' },
    };
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('macro-a', [portal]))
      .mockResolvedValueOnce(focusedWorkspace('macro-a'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-window' }).props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      {
        focus: { kind: 'macro', id: 'macro-a' },
        representation: 'semantic',
        windowToken: 'server-window-token',
      },
      signalTransport(),
    );
  });

  it('switches representation through URL state and requests primitive data lazily', async () => {
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('macro-a'))
      .mockResolvedValueOnce(focusedWorkspace('macro-a', [], 'primitive'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    const primitiveButton = root.root.findAllByType('button').find((button) => button.props.value === 'primitive')!;
    await act(async () => { primitiveButton.props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      {
        focus: { kind: 'macro', id: 'macro-a' },
        representation: 'primitive',
        windowToken: undefined,
      },
      signalTransport(),
    );
  });

  it('keeps dirty navigation in place when the user chooses Stay', async () => {
    const portal = {
      id: 'portal-dirty-stay',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'node' as const, id: 'resident-node' }, portId: 'bidirect.out' },
      label: 'Next Focus',
      connection: { edgeKind: 'bidirect_flow' as const, count: 1, portLabel: 'Matched flow', edges: [{ id: 'edge-dirty-stay', destinationPortId: 'bidirect.in', ownership: 'manual' as const }] },
      preview: { elementKind: 'macro' as const, subtitle: 'candidate_selector', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'macro' as const, id: 'macro-b' } },
    };
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(focusedWorkspace('macro-a', [portal], 'semantic', true));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'edit-resident' }).props.onClick(); });
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-dirty-stay' }).props.onClick(); });

    expect(collectText(root.root)).toContain('如何处理未保存的修改');
    const stay = root.root.findAllByType('button').find((button) => collectText(button).includes('留在此处'))!;
    await act(async () => { stay.props.onClick(); });

    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(1);
    expect(root.root.findByProps({ 'data-testid': 'focus-canvas' })).toBeTruthy();
  });

  it('discards resident edits before following a Portal when requested', async () => {
    const portal = {
      id: 'portal-dirty-discard',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'node' as const, id: 'resident-node' }, portId: 'bidirect.out' },
      label: 'Next Focus',
      connection: { edgeKind: 'bidirect_flow' as const, count: 1, portLabel: 'Matched flow', edges: [{ id: 'edge-dirty-discard', destinationPortId: 'bidirect.in', ownership: 'manual' as const }] },
      preview: { elementKind: 'macro' as const, subtitle: 'candidate_selector', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'macro' as const, id: 'macro-b' } },
    };
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('macro-a', [portal], 'semantic', true))
      .mockResolvedValueOnce(focusedWorkspace('macro-b'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'edit-resident' }).props.onClick(); });
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-dirty-discard' }).props.onClick(); });
    const discard = root.root.findAllByType('button').find((button) => collectText(button).includes('放弃并继续'))!;
    await act(async () => { discard.props.onClick(); });
    await flush();

    expect(state.api.applyRouteGraphWorkspaceOperations).not.toHaveBeenCalled();
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      {
        focus: { kind: 'macro', id: 'macro-b' },
        representation: 'semantic',
        windowToken: undefined,
      },
      signalTransport(),
    );
  });

  it('saves an exact resident operation batch before following a dirty Portal', async () => {
    const portal = {
      id: 'portal-dirty-save',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'node' as const, id: 'resident-node' }, portId: 'bidirect.out' },
      label: 'Next Focus',
      connection: { edgeKind: 'bidirect_flow' as const, count: 1, portLabel: 'Matched flow', edges: [{ id: 'edge-dirty-save', destinationPortId: 'bidirect.in', ownership: 'manual' as const }] },
      preview: { elementKind: 'macro' as const, subtitle: 'candidate_selector', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'macro' as const, id: 'macro-b' } },
    };
    state.api.getRouteGraphFocusedWorkspace
      .mockResolvedValueOnce(focusedWorkspace('macro-a', [portal], 'semantic', true))
      .mockResolvedValueOnce(focusedWorkspace('macro-b'));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'edit-resident' }).props.onClick(); });
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-dirty-save' }).props.onClick(); });
    const saveAndContinue = root.root.findAllByType('button').find((button) => collectText(button).includes('保存并继续'))!;
    await act(async () => { saveAndContinue.props.onClick(); });
    await flush();

    expect(state.api.applyRouteGraphWorkspaceOperations).toHaveBeenCalledWith({
      revision: 'draft:1:0:2',
      operations: [{
        kind: 'upsert_node',
        node: expect.objectContaining({ id: 'resident-node', name: 'Edited resident' }),
      }],
    });
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenLastCalledWith(
      {
        focus: { kind: 'macro', id: 'macro-b' },
        representation: 'semantic',
        windowToken: undefined,
      },
      signalTransport(),
    );
  });

  it('resets the opaque cursor after a debounced search changes', async () => {
    state.api.getRouteGraphWorkspaceIndex
      .mockResolvedValueOnce(indexPage('Macro A', 'opaque-next'))
      .mockResolvedValueOnce(indexPage('Macro B', 'opaque-after-b'))
      .mockResolvedValueOnce(indexPage('Needle result', null));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();
    const nextButton = root.root.findAllByType('button').find((button) => (
      collectText(button).includes('下一') || collectText(button).includes('Next')
    ))!;
    await act(async () => { nextButton.props.onClick(); });
    await flush();

    const searchInput = root.root.findByType('input');
    await act(async () => {
      searchInput.props.onChange({ target: { value: 'needle' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    await flush();

    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, query: 'needle' }),
      signalTransport(),
    );
    expect(collectText(root.root)).toContain('Needle result');
    expect(collectText(root.root)).not.toContain('Macro B');
  });

  it('resets the opaque cursor when an Index filter changes', async () => {
    state.api.getRouteGraphWorkspaceIndex
      .mockResolvedValueOnce(indexPage('Macro A', 'opaque-next'))
      .mockResolvedValueOnce(indexPage('Macro B', 'opaque-after-b'))
      .mockResolvedValueOnce(indexPage('Issue result', null));

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph'); });
    await flush();
    const nextButton = root.root.findAllByType('button').find((button) => (
      collectText(button).includes('下一') || collectText(button).includes('Next')
    ))!;
    await act(async () => { nextButton.props.onClick(); });
    await flush();
    const issuesButton = root.root.findAllByType('button').find((button) => (
      collectText(button).includes('仅显示有诊断项') || collectText(button).includes('Diagnostics only')
    ))!;
    await act(async () => { issuesButton.props.onClick(); });
    await flush();

    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: null, diagnosticState: 'issues' }),
      signalTransport(),
    );
    expect(collectText(root.root)).toContain('Issue result');
  });

  it('aborts an obsolete Focus request and never lets its late response replace the newer Focus', async () => {
    const pendingB = deferred<RouteGraphFocusedWorkspace>();
    const portal = {
      id: 'portal-to-b',
      kind: 'neighbor' as const,
      direction: 'outgoing' as const,
      resident: { element: { kind: 'macro' as const, id: 'macro-a' }, portId: 'bidirect.out' },
      label: 'Macro B',
      connection: { edgeKind: 'bidirect_flow' as const, count: 1, portLabel: 'Matched flow', edges: [{ id: 'edge-to-b', destinationPortId: 'bidirect.in', ownership: 'manual' as const }] },
      preview: { elementKind: 'macro' as const, subtitle: 'candidate_selector', enabled: true },
      destination: { kind: 'focus' as const, focus: { kind: 'macro' as const, id: 'macro-b' } },
    };
    state.api.getRouteGraphFocusedWorkspace.mockImplementation((options: { focus: { id: string } }) => {
      if (options.focus.id === 'macro-a') return Promise.resolve(focusedWorkspace('macro-a', [portal]));
      if (options.focus.id === 'macro-b') return pendingB.promise;
      return Promise.resolve(focusedWorkspace(options.focus.id));
    });

    const router = createWorkspaceRouter('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a');
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(<RouterProvider router={router} />); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'portal-portal-to-b' }).props.onClick(); });
    await flush();
    const requestB = state.api.getRouteGraphFocusedWorkspace.mock.calls.find((call) => call[0].focus.id === 'macro-b');
    expect(requestB).toBeTruthy();

    await act(async () => {
      await router.navigate('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-c');
    });
    await flush();
    expect((requestB?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(collectText(root.root)).toContain('macro-c');

    pendingB.resolve(focusedWorkspace('macro-b'));
    await flush();
    expect(collectText(root.root)).toContain('macro-c');
    expect(collectText(root.root)).not.toContain('macro-b');
  });

  it('keeps primitive representation disabled when the server marks it unavailable', async () => {
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(
      focusedWorkspace('macro-a', [], 'semantic', false, false),
    );

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();

    const primitiveButton = root.root.findAllByType('button').find((button) => button.props.value === 'primitive')!;
    expect(primitiveButton.props.disabled).toBe(true);
    expect(collectText(primitiveButton)).toContain('生成基础图');
    expect(primitiveButton.findByType('span').props.title).toContain('无法生成');
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(1);
  });

  it('routes dirty refresh through navigation confirmation and blocks operation undo until confirmed', async () => {
    state.api.getRouteGraphWorkspaceOperationBatches.mockResolvedValue([{
      id: 7,
      sourceRevision: 'draft:1:0:1',
      resultRevision: 'draft:1:0:2',
      forwardOperations: [],
      inverseOperations: [],
      createdAt: null,
    }]);
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(
      focusedWorkspace('macro-a', [], 'semantic', true),
    );

    let root!: ReturnType<typeof create>;
    await act(async () => { root = renderAt('/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a'); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'edit-resident' }).props.onClick(); });

    const refreshButton = root.root.findAllByType('button').find((button) => collectText(button).includes('刷新'))!;
    await act(async () => { refreshButton.props.onClick(); });
    expect(collectText(root.root)).toContain('如何处理未保存的修改');
    let stayButton = root.root.findAllByType('button').find((button) => collectText(button).includes('留在此处'))!;
    await act(async () => { stayButton.props.onClick(); });
    expect(state.api.getRouteGraphFocusedWorkspace).toHaveBeenCalledTimes(1);

    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const undo = root.root.findAllByType('button').find((button) => button.props.title === '撤销上次图编辑')!;
    await act(async () => { undo.props.onClick(); });
    expect(confirm).toHaveBeenCalled();
    expect(state.api.replayRouteGraphWorkspaceOperationBatch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(root.root.findByProps({ 'data-testid': 'focus-canvas' })).toBeTruthy();
  });

  it('blocks browser history navigation until dirty edits are explicitly discarded', async () => {
    state.api.getRouteGraphWorkspaceIndex.mockResolvedValue(indexPage('Macro A'));
    state.api.getRouteGraphFocusedWorkspace.mockResolvedValue(
      focusedWorkspace('macro-a', [], 'semantic', true),
    );
    const focusUrl = '/routes?routeMode=graph&graphFocusKind=macro&graphFocusId=macro-a';
    const router = createMemoryRouter([{
      path: '*',
      element: (
        <ToastProvider>
          <RouteGraphWorkspaceView />
        </ToastProvider>
      ),
    }], {
      initialEntries: ['/routes?routeMode=graph', focusUrl],
      initialIndex: 1,
    });

    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(<RouterProvider router={router} />); });
    await flush();
    await act(async () => { root.root.findByProps({ 'data-testid': 'edit-resident' }).props.onClick(); });

    await act(async () => { void router.navigate(-1); });
    await flush();
    expect(router.state.location.search).toContain('graphFocusId=macro-a');
    expect(collectText(root.root)).toContain('如何处理未保存的修改');

    const stay = root.root.findAllByType('button').find((button) => collectText(button).includes('留在此处'))!;
    await act(async () => { stay.props.onClick(); });
    expect(router.state.location.search).toContain('graphFocusId=macro-a');

    await act(async () => { void router.navigate(-1); });
    await flush();
    const discard = root.root.findAllByType('button').find((button) => collectText(button).includes('放弃并继续'))!;
    await act(async () => { discard.props.onClick(); });
    await flush();

    expect(router.state.location.search).not.toContain('graphFocusId');
    expect(state.api.getRouteGraphWorkspaceIndex).toHaveBeenCalled();
    expect(state.api.applyRouteGraphWorkspaceOperations).not.toHaveBeenCalled();
  });
});
