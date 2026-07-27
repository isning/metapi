import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getRouteGraphDraft: vi.fn(),
    getRouteGraphWorkspaceIndex: vi.fn(),
    getRouteEndpointPage: vi.fn(),
  },
}));

vi.mock('../../api.js', () => ({
  api: apiMock,
}));

vi.mock('@xyflow/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const useState = React.useState;
  return {
    Background: () => null,
    Controls: () => null,
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Handle: () => null,
    MiniMap: () => null,
    NodeToolbar: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Panel: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
    Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
    ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="react-flow">{children}</div>,
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    getBezierPath: () => [''],
    getConnectedEdges: () => [],
    useEdgesState: (initial: unknown[]) => {
      const [items, setItems] = useState(initial);
      return [items, setItems, vi.fn()];
    },
    useNodesState: (initial: unknown[]) => {
      const [items, setItems] = useState(initial);
      return [items, setItems, vi.fn()];
    },
    useReactFlow: () => ({
      fitView: vi.fn(),
      flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    }),
  };
});

vi.mock('../../components/JsonCodeEditor.js', () => ({
  default: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <textarea data-testid="json-editor" aria-label={ariaLabel} value={value} readOnly />
  ),
}));

import RouteGraphWorkbench from './RouteGraphWorkbench.js';

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function workbenchRouter(mode: 'graph' | 'json') {
  return createMemoryRouter([{
    path: '*',
    element: <ToastProvider><RouteGraphWorkbench mode={mode} /></ToastProvider>,
  }], { initialEntries: ['/routes'] });
}

describe('RouteGraphWorkbench loading states', () => {
  it('shows an index skeleton instead of mounting a blank canvas while graph mode loads', async () => {
    apiMock.getRouteGraphWorkspaceIndex.mockReturnValue(new Promise(() => {}));

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<RouterProvider router={workbenchRouter('graph')} />);
    });

    expect(root.root.findByProps({ 'data-testid': 'route-graph-index-loading' })).toBeTruthy();
    expect(root.root.findAllByProps({ 'data-testid': 'react-flow' })).toHaveLength(0);
  });

  it('shows a structured skeleton instead of a blank editor while advanced JSON loads', async () => {
    apiMock.getRouteGraphDraft.mockReturnValue(new Promise(() => {}));

    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<RouterProvider router={workbenchRouter('json')} />);
    });

    expect(root.root.findByProps({ 'data-testid': 'route-graph-json-loading' })).toBeTruthy();
    expect(root.root.findAllByProps({ 'data-testid': 'json-editor' })).toHaveLength(0);
    expect(collectText(root.root)).toContain('高级 JSON');
  });
});
