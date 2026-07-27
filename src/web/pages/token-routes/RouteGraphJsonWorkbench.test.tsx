import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast.js';

const state = vi.hoisted(() => ({
  api: {
    getRouteGraphDraft: vi.fn(),
    validateRouteGraph: vi.fn(),
    saveRouteGraphDraft: vi.fn(),
    publishRouteGraphDraft: vi.fn(),
  },
}));

vi.mock('../../api.js', () => ({ api: state.api }));

vi.mock('../../components/JsonCodeEditor.js', () => ({
  default: ({ value, onChange, ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      data-testid="json-editor"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import RouteGraphJsonWorkbench, { parseGraph } from './RouteGraphJsonWorkbench.js';

const emptyGraph = { nodes: [], edges: [], macros: [], metadata: {} };

function draftEnvelope(graph = emptyGraph) {
  return { draft: { workingGraph: graph, diagnostics: [] }, activeVersion: null };
}

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : collectText(child)).join('');
}

function findButton(root: ReactTestInstance, labels: string[]): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && labels.some((label) => collectText(node).includes(label))
  ));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createJsonRouter() {
  return createMemoryRouter([
    {
      path: '/routes',
      element: (
        <ToastProvider>
          <RouteGraphJsonWorkbench />
        </ToastProvider>
      ),
    },
    { path: '/elsewhere', element: <div data-testid="elsewhere">Elsewhere</div> },
  ], { initialEntries: ['/routes?routeMode=json'] });
}

async function renderJson() {
  const router = createJsonRouter();
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(<RouterProvider router={router} />);
  });
  await flush();
  return { root, router };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.api.getRouteGraphDraft.mockResolvedValue(draftEnvelope());
  state.api.validateRouteGraph.mockResolvedValue({ ok: true, diagnostics: [] });
  state.api.saveRouteGraphDraft.mockImplementation(async (graph) => draftEnvelope(graph));
  state.api.publishRouteGraphDraft.mockResolvedValue({ success: true });
});

describe('RouteGraphJsonWorkbench lifecycle', () => {
  it('loads only the full draft, validates the edited graph, and saves the same parsed shape', async () => {
    const { root } = await renderJson();

    expect(state.api.getRouteGraphDraft).toHaveBeenCalledTimes(1);
    const transport = state.api.getRouteGraphDraft.mock.calls[0]?.[0] as { signal: AbortSignal };
    expect(transport.signal).toBeInstanceOf(AbortSignal);
    const editor = root.root.findByProps({ 'data-testid': 'json-editor' });
    const editedGraph = { ...emptyGraph, metadata: { owner: 'workspace-test' } };
    await act(async () => {
      editor.props.onChange({ target: { value: JSON.stringify(editedGraph) } });
    });

    await act(async () => { findButton(root.root, ['校验', 'Validate']).props.onClick(); });
    await flush();
    expect(state.api.validateRouteGraph).toHaveBeenCalledWith(editedGraph);

    await act(async () => { findButton(root.root, ['保存', 'Save']).props.onClick(); });
    await flush();
    expect(state.api.saveRouteGraphDraft).toHaveBeenCalledWith(editedGraph);
    expect(collectText(root.root)).not.toContain('未保存');
  });

  it('saves dirty JSON before publishing and reloads the authoritative draft afterward', async () => {
    const { root } = await renderJson();

    const editedGraph = { ...emptyGraph, metadata: { release: 'next' } };
    await act(async () => {
      root.root.findByProps({ 'data-testid': 'json-editor' }).props.onChange({
        target: { value: JSON.stringify(editedGraph) },
      });
    });
    await act(async () => { findButton(root.root, ['发布', 'Publish']).props.onClick(); });
    await flush();

    expect(state.api.saveRouteGraphDraft).toHaveBeenCalledWith(editedGraph);
    expect(state.api.publishRouteGraphDraft).toHaveBeenCalledTimes(1);
    expect(state.api.saveRouteGraphDraft.mock.invocationCallOrder[0]).toBeLessThan(
      state.api.publishRouteGraphDraft.mock.invocationCallOrder[0]!,
    );
    expect(state.api.getRouteGraphDraft).toHaveBeenCalledTimes(2);
  });

  it('blocks SPA navigation until dirty JSON is kept or explicitly discarded', async () => {
    const { root, router } = await renderJson();
    await act(async () => {
      root.root.findByProps({ 'data-testid': 'json-editor' }).props.onChange({
        target: { value: JSON.stringify({ ...emptyGraph, metadata: { dirty: true } }) },
      });
    });

    await act(async () => { void router.navigate('/elsewhere'); });
    await flush();
    expect(router.state.location.pathname).toBe('/routes');
    expect(collectText(root.root)).toContain('如何处理未保存的修改');

    await act(async () => { findButton(root.root, ['留在此处', 'Stay']).props.onClick(); });
    expect(router.state.location.pathname).toBe('/routes');

    await act(async () => { void router.navigate('/elsewhere'); });
    await flush();
    await act(async () => { findButton(root.root, ['放弃并继续', 'Discard']).props.onClick(); });
    await flush();

    expect(router.state.location.pathname).toBe('/elsewhere');
    expect(state.api.saveRouteGraphDraft).not.toHaveBeenCalled();
  });

  it('rejects non-object roots and incomplete graph collections before normalization', () => {
    expect(() => parseGraph('[]')).toThrow();
    expect(() => parseGraph('{"nodes":[],"edges":[]}')).toThrow();
  });
});
