import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { RouteGraphNode } from '../../../shared/routeGraph.js';
import { Button } from '../../components/ui/button/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { makeNodeDraft } from './routeGraphRegistry.js';
import { FilterOperationsEditor, NodeForm } from './NodeForm.js';

function nodeWithId(type: RouteGraphNode['type']): RouteGraphNode {
  return { ...makeNodeDraft(type, 0), id: `manual:${type}:test` } as RouteGraphNode;
}

describe('NodeForm graph node types', () => {
  it.each(['entry', 'filter', 'dispatcher', 'route_endpoint', 'synthetic_endpoint'] as const)(
    'renders editable controls for %s',
    (type) => {
      const onChange = vi.fn();
      const onDelete = vi.fn();
      const node = nodeWithId(type);
      const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={onDelete} />);
      try {
        expect(root.root.findAllByType(Input).length).toBeGreaterThan(0);
        const enabled = root.root.findByType(Switch);
        const remove = root.root.findAllByType(Button).find((button) => button.props.variant === 'destructive')!;
        act(() => enabled.props.onCheckedChange(false));
        expect(onChange).toHaveBeenLastCalledWith({ ...node, enabled: false });
        act(() => remove.props.onClick());
        expect(onDelete).toHaveBeenCalledOnce();
      } finally {
        root.unmount();
      }
    },
  );

  it('updates entry matching fields without replacing the rest of the match contract', () => {
    const node = nodeWithId('entry') as Extract<RouteGraphNode, { type: 'entry' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const requested = root.root.findAllByType(Input).find((input) => input.props.value === '')!;

    act(() => requested.props.onChange({ target: { value: 'gpt-5*' } }));

    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      match: { ...node.match, requestedModelPattern: 'gpt-5*' },
    });
    root.unmount();
  });

  it.each([
    ['rewrite_model', { type: 'rewrite_model', source: 'current_model', operation: 'set', value: '' }],
    ['set_payload', { type: 'set_payload', path: '', value: '', mode: 'default' }],
    ['remove_payload', { type: 'remove_payload', path: '' }],
    ['set_header', { type: 'set_header', name: '', value: '', mode: 'override' }],
    ['remove_header', { type: 'remove_header', name: '' }],
    ['set_endpoint_preference', { type: 'set_endpoint_preference', endpoint: 'responses' }],
  ] as const)('switches a filter rule to %s with its canonical payload', (type, expectedOperation) => {
    const onChange = vi.fn();
    const root = create(
      <FilterOperationsEditor
        value={[{ type: 'rewrite_model', source: 'current_model', operation: 'set', value: '' }]}
        onChange={onChange}
      />,
    );
    const typeSelect = root.root.findAllByType(Select).find((select) => select.props.value === 'rewrite_model')!;

    act(() => typeSelect.props.onValueChange(type));

    expect(onChange).toHaveBeenLastCalledWith([expectedOperation]);
    root.unmount();
  });

  it('adds a filter operation with the canonical default payload', () => {
    const node = nodeWithId('filter') as Extract<RouteGraphNode, { type: 'filter' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const add = root.root.findAllByType(Button).find((button) => (
      button.props.variant === 'outline' && button.props.size === 'sm'
    ));

    act(() => add!.props.onClick());

    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [{ type: 'rewrite_model', source: 'current_model', operation: 'set', value: '' }],
    });
    root.unmount();
  });

  it('updates filter payload path and parses JSON values before emitting the node', () => {
    const node = {
      ...nodeWithId('filter'),
      operations: [{ type: 'set_payload' as const, path: '', value: '', mode: 'default' as const }],
    } as Extract<RouteGraphNode, { type: 'filter' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const operationInputs = root.root.findAllByType(Input).filter((input) => input.props.value === '');

    act(() => operationInputs[0]!.props.onChange({ target: { value: 'metadata.trace_id' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [{ ...node.operations[0], path: 'metadata.trace_id' }],
    });
    act(() => operationInputs[1]!.props.onChange({ target: { value: '{"enabled":true}' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [{ ...node.operations[0], value: { enabled: true } }],
    });
    root.unmount();
  });

  it('updates dispatcher mode through its node-specific control', () => {
    const node = nodeWithId('dispatcher') as Extract<RouteGraphNode, { type: 'dispatcher' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const mode = root.root.findAllByType(Select).find((select) => select.props.value === 'route')!;

    act(() => mode.props.onValueChange('flow'));

    expect(onChange).toHaveBeenLastCalledWith({ ...node, mode: 'flow' });
    root.unmount();
  });

  it('updates dispatcher policy through the policy selector', () => {
    const node = nodeWithId('dispatcher') as Extract<RouteGraphNode, { type: 'dispatcher' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const policy = root.root.findAllByType(Select).find((select) => select.props.value === 'inherit_default')!;

    act(() => policy.props.onValueChange('builtin:round_robin'));

    expect(onChange).toHaveBeenLastCalledWith({ ...node, policy: { kind: 'builtin', builtin: 'round_robin' } });
    root.unmount();
  });

  it('updates route endpoint backend and selected endpoint ids', () => {
    const node = nodeWithId('route_endpoint') as Extract<RouteGraphNode, { type: 'route_endpoint' }>;
    const onChange = vi.fn();
    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
        referenceEndpoints={[{ id: 'endpoint-a', label: 'Endpoint A' }]}
      />,
    );
    const backend = root.root.findAllByType(Select).find((select) => select.props.value === 'supply')!;

    act(() => backend.props.onValueChange('route_endpoints'));
    expect(onChange).toHaveBeenLastCalledWith({ ...node, backend: { kind: 'route_endpoints', endpointIds: [] } });

    const routeEndpointNode = { ...node, backend: { kind: 'route_endpoints' as const, endpointIds: [] } };
    root.update(
      <NodeForm
        node={routeEndpointNode}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
        referenceEndpoints={[{ id: 'endpoint-a', label: 'Endpoint A' }]}
      />,
    );
    const endpoint = root.root.findByType(Checkbox);
    act(() => endpoint.props.onCheckedChange(true));

    expect(onChange).toHaveBeenLastCalledWith({
      ...routeEndpointNode,
      backend: { kind: 'route_endpoints', endpointIds: ['endpoint-a'] },
    });
    root.unmount();
  });

  it('updates route endpoint target policy without dropping endpoint config', () => {
    const node = nodeWithId('route_endpoint') as Extract<RouteGraphNode, { type: 'route_endpoint' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const targetPolicy = root.root.findAllByType(Select).find((select) => select.props.value === 'defer_to_router')!;

    act(() => targetPolicy.props.onValueChange('builtin:weighted'));

    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      config: { ...node.config, targetSelection: { kind: 'builtin', builtin: 'weighted' } },
    });
    root.unmount();
  });

  it('updates synthetic endpoint status and message independently', () => {
    const node = nodeWithId('synthetic_endpoint') as Extract<RouteGraphNode, { type: 'synthetic_endpoint' }>;
    const onChange = vi.fn();
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const status = root.root.findAllByType(Select).find((select) => select.props.value === '503')!;
    const message = root.root.findAllByType(Input).find((input) => input.props.value === 'Route unavailable')!;

    act(() => status.props.onValueChange('429'));
    expect(onChange).toHaveBeenLastCalledWith({ ...node, statusCode: 429 });
    act(() => message.props.onChange({ target: { value: 'Rate limited' } }));
    expect(onChange).toHaveBeenLastCalledWith({ ...node, message: 'Rate limited' });
    root.unmount();
  });
});
