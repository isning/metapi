import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync('src/web/pages/token-routes/RouteGraphWorkbench.tsx', 'utf8');

describe('RouteGraphWorkbench large graph performance guardrails', () => {
  it('uses React Flow viewport virtualization for expanded generated graphs', () => {
    const text = source();

    expect(text).toContain('onlyRenderVisibleElements');
    expect(text).toContain('elevateNodesOnSelect={false}');
    expect(text).toContain('elevateEdgesOnSelect={false}');
    expect(text).toContain('nodesFocusable={false}');
    expect(text).toContain('edgesFocusable={false}');
    expect(text).toContain('disableKeyboardA11y');
  });

  it('keeps the minimap out of very large graph renders', () => {
    const text = source();

    expect(text).toContain('ROUTE_GRAPH_MINIMAP_NODE_LIMIT');
    expect(text).toContain('flowNodes.length <= ROUTE_GRAPH_MINIMAP_NODE_LIMIT');
    expect(text).toContain('{minimapEnabled && <MiniMap');
  });

  it('keeps route endpoint catalog and JSON serialization behind explicit demand', () => {
    const text = source();
    const refreshBlock = text.slice(text.indexOf('const refresh = useCallback'), text.indexOf('const expandMacroOnCanvas'));
    const applyGraphBlock = text.slice(text.indexOf('const applyGraph = useCallback'), text.indexOf('const updateMacro = useCallback'));

    expect(text).toContain('routeEndpointCatalogLoadedRef');
    expect(text).toContain('loadRouteEndpointCatalog');
    expect(refreshBlock).not.toContain('api.getRouteEndpoints');
    expect(refreshBlock).toContain("if (mode === 'json') syncWholeJsonFromGraph(nextGraph)");
    expect(applyGraphBlock).toContain("if (mode === 'json') syncWholeJsonFromGraph(normalized)");
  });

  it('limits large sidebar DOM output while search still uses full collections', () => {
    const text = source();

    expect(text).toContain('ROUTE_GRAPH_SIDEBAR_RENDER_LIMIT');
    expect(text).toContain('visibleSidebarItems(filteredNodes)');
    expect(text).toContain('visibleSidebarItems(sortedMacros)');
    expect(text).toContain('visibleSidebarItems(nodes)');
  });

  it('renders generated compact ports without per-port tooltip providers', () => {
    const text = source();
    const portRowBlock = text.slice(text.indexOf('const PortRow = memo'), text.indexOf('const RouteGraphEdgeView = memo'));

    expect(portRowBlock).toContain("node?.ownership !== 'manual'");
    expect(portRowBlock).toContain('lightweightLabel ?');
    expect(portRowBlock).toContain('<Tooltip.Root>');
  });

  it('keeps macro generated views behind explicit macro-level debug actions', () => {
    const text = source();
    const macroPanelBlock = text.slice(text.indexOf('function MacrosPanel'), text.indexOf('function NodesPanel'));
    const contextMenuBlock = text.slice(text.indexOf('function RouteGraphPointMenu'), text.indexOf('function Inspector'));
    const inspectorBlock = text.slice(text.indexOf('function Inspector'), text.indexOf('function InspectorHeader'));

    expect(text).toContain('pages.tokenRoutes.routeGraphWorkbench.showCompiledGraph');
    expect(text).toContain('pages.tokenRoutes.routeGraphWorkbench.showCompiledGraphDescription');
    expect(contextMenuBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.expandGeneratedView');
    expect(contextMenuBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.collapseGeneratedView');
    expect(contextMenuBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.collapseToMacro');
    expect(text).not.toContain('ROUTE_GRAPH_CONTEXT_MENU_REPLAY_FLAG');
    expect(inspectorBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.previewInInspector');
    expect(inspectorBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.expandOnCanvas');
    expect(inspectorBlock).toContain('pages.tokenRoutes.routeGraphWorkbench.collapseToMacro');
    expect(macroPanelBlock).not.toContain('Expand');
    expect(macroPanelBlock).not.toContain('Collapse');
  });

  it('does not attach custom node drag lifecycle handlers around the inspector', () => {
    const text = source();
    const reactFlowBlock = text.slice(text.indexOf('<ReactFlow<RouteFlowNode, RouteFlowEdge>'), text.indexOf('<Background gap={22} />'));
    const inspectorBlock = text.slice(text.indexOf('{(selectedNode || selectedEdge || selectedMacro) && inspectorAnchor && ('), text.indexOf('<Command.CommandDialog'));

    expect(reactFlowBlock).not.toContain('onNodeDragStop');
    expect(reactFlowBlock).not.toContain('onNodeDragStart');
    expect(text).not.toContain('persistNodePositions');
    expect(text).not.toContain('isNodeDragging');
    expect(inspectorBlock).toContain('absolute z-[80]');
    expect(inspectorBlock).not.toContain('pointer-events-none');
    expect(inspectorBlock).not.toContain('invisible');
  });

  it('does not synchronize graph coordinates manually during node drags', () => {
    const text = source();

    expect(text).not.toContain('flowInstanceToGraphPositions');
    expect(text).not.toContain('reactFlow.getNodes()');
  });
});
