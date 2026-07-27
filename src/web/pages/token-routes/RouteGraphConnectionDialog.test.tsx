import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { ToastProvider } from '../../components/Toast.js';

const state = vi.hoisted(() => ({
  api: {
    queryRouteGraphWorkspaceConnectionTargets: vi.fn(),
    draftRouteGraphWorkspaceConnection: vi.fn(),
  },
}));

vi.mock('../../api.js', () => ({ api: state.api }));

import RouteGraphConnectionDialog from './RouteGraphConnectionDialog.js';

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const source = { element: { kind: 'node' as const, id: 'entry:a' }, portId: 'bidirect.out' };
const target = {
  endpoint: { element: { kind: 'node' as const, id: 'filter:b' }, portId: 'bidirect.in' },
  graphElementId: 'filter:b',
  elementLabel: 'Filter B',
  elementKind: 'filter' as const,
  elementSubtitle: 'filter',
  enabled: true,
  ownership: 'manual' as const,
  port: { id: 'bidirect.in', label: 'Matched flow', direction: 'input' as const, kind: 'bidirect' as const },
  focuses: [{ focus: { kind: 'node' as const, id: 'entry:remote' }, label: 'Remote entry' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.api.draftRouteGraphWorkspaceConnection.mockResolvedValue({ edge: { id: 'edge:new', sourceNodeId: 'entry:a', sourcePortId: 'bidirect.out', targetNodeId: 'filter:b', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' } });
  state.api.queryRouteGraphWorkspaceConnectionTargets.mockResolvedValue({
    revision: 'draft:1',
    source: {
      ...target,
      endpoint: source,
      graphElementId: 'entry:a',
      elementLabel: 'Entry A',
      elementKind: 'entry',
      port: { ...target.port, id: 'bidirect.out', direction: 'output' },
    },
    items: [target],
    nextCursor: 'cursor:next',
    totalCount: 2,
  });
});

describe('RouteGraphConnectionDialog', () => {
  it('loads one bounded page and creates a connection through an explicit command', async () => {
    const onClose = vi.fn();
    const onConnected = vi.fn();
    const onInspectFocus = vi.fn();
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<ToastProvider><RouteGraphConnectionDialog open revision="draft:1" source={source} operations={[]} onClose={onClose} onConnected={onConnected} onInvalidated={() => {}} onInspectFocus={onInspectFocus} /></ToastProvider>);
    });
    await flush();

    expect(state.api.queryRouteGraphWorkspaceConnectionTargets).toHaveBeenCalledWith(
      { revision: 'draft:1', operations: [], source, replacingEdgeId: undefined, cursor: null, limit: 24, query: '' },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(text(root.root)).toContain('Filter B');
    expect(text(root.root)).toContain('Remote entry');
    const inspect = root.root.findAllByType('button').find((button) => button.props['aria-label']?.includes('Remote entry'))!;
    act(() => inspect.props.onClick());
    expect(onInspectFocus).toHaveBeenCalledWith({ kind: 'node', id: 'entry:remote' });
    const connect = root.root.findAllByType('button').find((button) => text(button).includes('连接'))!;
    await act(async () => { await connect.props.onClick(); });
    expect(state.api.draftRouteGraphWorkspaceConnection).toHaveBeenCalledWith({
      revision: 'draft:1', operations: [],
      first: source,
      second: target.endpoint,
      replacingEdgeId: undefined,
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('binds discovery and mutation to the edge being atomically replaced', async () => {
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<ToastProvider><RouteGraphConnectionDialog open revision="draft:1" source={source} replacingEdgeId="edge:old" operations={[]} onClose={() => {}} onConnected={() => {}} onInvalidated={() => {}} onInspectFocus={() => {}} /></ToastProvider>);
    });
    await flush();
    expect(state.api.queryRouteGraphWorkspaceConnectionTargets).toHaveBeenCalledWith(
      expect.objectContaining({ source, replacingEdgeId: 'edge:old' }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    const reconnect = root.root.findAllByType('button').find((button) => text(button).includes('重连'))!;
    await act(async () => { await reconnect.props.onClick(); });
    expect(state.api.draftRouteGraphWorkspaceConnection).toHaveBeenCalledWith(expect.objectContaining({
      replacingEdgeId: 'edge:old',
      second: target.endpoint,
    }));
  });

  it('closes an invalid revision-bound session and requests an authoritative reload', async () => {
    state.api.draftRouteGraphWorkspaceConnection.mockRejectedValueOnce(new Error('stale_revision'));
    const onClose = vi.fn();
    const onInvalidated = vi.fn();
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<ToastProvider><RouteGraphConnectionDialog open revision="draft:1" source={source} operations={[]} onClose={onClose} onConnected={() => {}} onInvalidated={onInvalidated} onInspectFocus={() => {}} /></ToastProvider>);
    });
    await flush();

    const connect = root.root.findAllByType('button').find((button) => text(button).includes('连接'))!;
    await act(async () => { await connect.props.onClick(); });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onInvalidated).toHaveBeenCalledOnce();
  });
});
