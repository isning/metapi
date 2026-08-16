import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { RouteGraphNode } from '../../../shared/routeGraph.js';
import { Select } from '../../components/ui/select/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Input } from '../../components/ui/input/index.js';
import { NodeForm } from './NodeForm.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';

describe('NodeForm native endpoint fields', () => {
  it('updates backend on the endpoint node without contaminating endpoint config', () => {
    const onChange = vi.fn();
    const node: Extract<RouteGraphNode, { type: 'route_endpoint' }> = {
      id: 'endpoint:manual:primary',
      type: 'route_endpoint',
      name: 'Primary endpoint',
      enabled: true,
      ownership: 'manual',
      routeEndpointId: 'endpoint:manual:primary',
      endpointKind: 'supply',
      exposure: 'internal',
      resolutionStatus: 'resolved',
      ownerKind: 'manual',
      sourceKind: 'inline',
      backend: { kind: 'supply' },
      config: {
        targets: [{ targetId: 'target:primary', model: 'gpt-4o-mini' }],
        targetSelection: { kind: 'inherit_default' },
      },
    };

    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const backend = root.root.findAllByType(Select).find((item) => item.props.value === 'supply');

    act(() => {
      backend!.props.onValueChange('route_endpoints');
    });

    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      backend: { kind: 'route_endpoints', endpointIds: [] },
    });
    expect(onChange.mock.calls.at(-1)?.[0].config).toEqual(node.config);
  });

  it('writes execution-attempt backoff to the native endpoint target', () => {
    const onChange = vi.fn();
    const node: Extract<RouteGraphNode, { type: 'route_endpoint' }> = {
      id: 'endpoint:manual:backoff', type: 'route_endpoint', enabled: true, ownership: 'manual',
      routeEndpointId: 'endpoint:manual:backoff', endpointKind: 'supply', exposure: 'internal',
      resolutionStatus: 'resolved', ownerKind: 'manual', sourceKind: 'inline', backend: { kind: 'supply' },
      config: { targets: [{ targetId: 'target:backoff', model: 'gpt-4o-mini' }] },
    };
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const editor = root.root.findByType(FailureBackoffEditor);
    act(() => editor.props.onChange({ mode: 'disabled' }));
    expect(onChange.mock.calls.at(-1)?.[0].config.targets[0].failureBackoff).toEqual({ mode: 'disabled' });
  });

  it('selects cross-focus endpoint references from a parent-owned catalog', () => {
    const onChange = vi.fn();
    const onQueryChange = vi.fn();
    const node: Extract<RouteGraphNode, { type: 'route_endpoint' }> = {
      id: 'endpoint:manual:aggregate',
      type: 'route_endpoint',
      name: 'Aggregate endpoint',
      enabled: true,
      ownership: 'manual',
      routeEndpointId: 'endpoint:manual:aggregate',
      endpointKind: 'supply',
      exposure: 'internal',
      resolutionStatus: 'resolved',
      ownerKind: 'manual',
      sourceKind: 'inline',
      backend: { kind: 'route_endpoints', endpointIds: [] },
      config: { targets: [], targetSelection: { kind: 'defer_to_router' } },
    };
    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        referenceEndpoints={[{ id: 'endpoint:remote', label: 'Remote endpoint' }]}
        referenceEndpointCatalog={{
          query: '',
          loading: false,
          hasMore: false,
          onQueryChange,
          onLoadMore: vi.fn(),
        }}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const search = root.root.findAllByType(Input).find((item) => item.props.placeholder);
    act(() => search!.props.onChange({ target: { value: 'remote' } }));
    expect(onQueryChange).toHaveBeenCalledWith('remote');

    const endpoint = root.root.findByType(Checkbox);
    act(() => endpoint.props.onCheckedChange(true));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      backend: { kind: 'route_endpoints', endpointIds: ['endpoint:remote'] },
    });
    expect(onChange.mock.calls.at(-1)?.[0].config).toEqual(node.config);
  });

  it('round-trips registry dispatcher policies and exposes registry choices', () => {
    const onChange = vi.fn();
    const node: Extract<RouteGraphNode, { type: 'dispatcher' }> = {
      id: 'dispatcher:manual', type: 'dispatcher', enabled: true, ownership: 'manual',
      mode: 'route', ordering: 'explicit', policy: { kind: 'registry', policyId: 'cost-aware' },
    };
    const registry = {
      defaultPolicyId: 'cost-aware',
      policies: [{ id: 'cost-aware', name: 'Cost aware', kind: 'cel' as const, selectionMode: 'weighted' as const, contributionExpression: '1.0' }],
    };
    const root = create(<NodeForm node={node} readonly={false} policyRegistry={registry} onChange={onChange} onDelete={vi.fn()} />);
    const policy = root.root.findAllByType(Select).find((item) => item.props.value === 'registry:cost-aware');
    expect(policy).toBeTruthy();
    act(() => policy!.props.onValueChange('builtin:stable_first'));
    expect(onChange).toHaveBeenLastCalledWith({ ...node, policy: { kind: 'builtin', builtin: 'stable_first' } });
  });

  it('preserves an existing inline dispatcher policy', () => {
    const onChange = vi.fn();
    const inline = { id: 'inline', name: 'Inline', kind: 'cel' as const, selectionMode: 'weighted' as const, contributionExpression: '0.5' };
    const node: Extract<RouteGraphNode, { type: 'dispatcher' }> = {
      id: 'dispatcher:inline', type: 'dispatcher', enabled: true, ownership: 'manual',
      mode: 'route', ordering: 'explicit', policy: { kind: 'inline', policy: inline },
    };
    const root = create(<NodeForm node={node} readonly={false} onChange={onChange} onDelete={vi.fn()} />);
    const policy = root.root.findAllByType(Select).find((item) => item.props.value === 'inline:current');
    act(() => policy!.props.onValueChange('inline:current'));
    expect(onChange).toHaveBeenLastCalledWith(node);
  });
});
