import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import { NodeForm } from './NodeForm.js';
import type { RouteGraphNode } from './routeGraphTypes.js';

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function findInputByValue(root: ReactTestInstance, value: string): ReactTestInstance {
  return root.findAllByType(Input).find((node) => node.props.value === value)!;
}

function findButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.findAllByType(Button).find((node) => textOf(node) === text)!;
}

describe('NodeForm', () => {
  it('edits entry display fields without changing unrelated node config', () => {
    const onChange = vi.fn();
    const node: RouteGraphNode = {
      id: 'entry.public',
      type: 'entry',
      name: 'Public GPT',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      match: {
        kind: 'model',
        requestedModelPattern: 'gpt-*',
        displayName: 'GPT Public',
      },
      selectionStrategy: 'weighted',
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    act(() => {
      findInputByValue(root.root, 'Public GPT').props.onChange({ target: { value: 'Public GPT Updated' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      name: 'Public GPT Updated',
    });

    act(() => {
      findInputByValue(root.root, 'gpt-*').props.onChange({ target: { value: 'gpt-4o*' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      match: {
        kind: 'model',
        requestedModelPattern: 'gpt-4o*',
        displayName: 'GPT Public',
      },
    });

    act(() => {
      findInputByValue(root.root, 'GPT Public').props.onChange({ target: { value: '' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      match: {
        kind: 'model',
        requestedModelPattern: 'gpt-*',
        displayName: null,
      },
    });
  });

  it('edits filter operations as graph-native request mutations', () => {
    const onChange = vi.fn();
    const node: RouteGraphNode = {
      id: 'filter.reasoning',
      type: 'filter',
      name: 'Reasoning filter',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      operations: [
        { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
      ],
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    act(() => {
      findInputByValue(root.root, 'reasoning_effort').props.onChange({ target: { value: 'reasoning.effort' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'set_payload', path: 'reasoning.effort', value: 'high', mode: 'default' },
      ],
    });

    act(() => {
      findInputByValue(root.root, 'high').props.onChange({ target: { value: '{"level":"medium"}' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'set_payload', path: 'reasoning_effort', value: { level: 'medium' }, mode: 'default' },
      ],
    });

    act(() => {
      findButtonByText(root.root, 'set_header').props.onClick();
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
        { type: 'set_header', name: 'x-metapi-route', value: 'manual', mode: 'override' },
      ],
    });

    act(() => {
      findButtonByText(root.root, 'Remove Operation').props.onClick();
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [],
    });
  });

  it('edits dispatcher and endpoint JSON through one source of truth', () => {
    const dispatcherChange = vi.fn();
    const dispatcher: RouteGraphNode = {
      id: 'dispatcher.route',
      type: 'dispatcher',
      name: 'Primary dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: 'weighted' },
    };
    const dispatcherRoot = create(
      <NodeForm
        node={dispatcher}
        readonly={false}
        onChange={dispatcherChange}
        onDelete={vi.fn()}
      />,
    );

    act(() => {
      dispatcherRoot.root.findByType(Textarea).props.onChange({
        target: { value: '{"strategy":"priority_order","weights":[3,1]}' },
      });
    });
    expect(dispatcherChange).toHaveBeenLastCalledWith({
      ...dispatcher,
      policy: { strategy: 'priority_order', weights: [3, 1] },
    });

    const endpointChange = vi.fn();
    const endpoint: RouteGraphNode = {
      id: 'endpoint.primary',
      type: 'model_endpoint',
      name: 'Endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      metadata: { tier: 'fast' },
      config: {
        targets: [{ channelId: 'channel-a', model: 'gpt-a' }],
        targetSelection: { strategy: 'weighted' },
      },
    };
    const endpointRoot = create(
      <NodeForm
        node={endpoint}
        readonly={false}
        onChange={endpointChange}
        onDelete={vi.fn()}
      />,
    );
    const [metadataEditor, configEditor] = endpointRoot.root.findAllByType(Textarea);

    act(() => {
      metadataEditor!.props.onChange({ target: { value: '{"tier":"cheap","score":7}' } });
    });
    expect(endpointChange).toHaveBeenLastCalledWith({
      ...endpoint,
      metadata: { tier: 'cheap', score: 7 },
    });

    act(() => {
      configEditor!.props.onChange({
        target: {
          value: '{"targets":[{"channelId":"channel-b","model":"gpt-b","metadata":{"region":"us"}}],"targetSelection":{"strategy":"stable_first"}}',
        },
      });
    });
    expect(endpointChange).toHaveBeenLastCalledWith({
      ...endpoint,
      config: {
        targets: [{ channelId: 'channel-b', model: 'gpt-b', metadata: { region: 'us' } }],
        targetSelection: { strategy: 'stable_first' },
      },
    });
  });

  it('disables all direct mutations in readonly mode', () => {
    const onDelete = vi.fn();
    const node: RouteGraphNode = {
      id: 'synthetic.unavailable',
      type: 'synthetic_endpoint',
      name: 'No backend',
      enabled: false,
      visibility: 'internal',
      ownership: 'derived',
      statusCode: 503,
      message: 'No backend',
    };

    const root = create(
      <NodeForm
        node={node}
        readonly
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    for (const input of root.root.findAllByType(Input)) {
      expect(input.props.disabled).toBe(true);
    }
    for (const select of root.root.findAllByType(Select)) {
      expect(select.props.disabled).toBe(true);
    }
    for (const button of root.root.findAllByType(Button)) {
      expect(button.props.disabled).toBe(true);
    }
    const deleteButton = findButtonByText(root.root, 'Delete');
    expect(deleteButton.props.disabled).toBe(true);

    act(() => {
      deleteButton.props.onClick?.();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('edits dispatcher mode through the shadcn select controls', () => {
    const onChange = vi.fn();
    const node: RouteGraphNode = {
      id: 'dispatcher.route',
      type: 'dispatcher',
      name: 'Primary dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: 'weighted' },
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const modeSelect = root.root.findAllByType(Select).find((item) => item.props.value === 'route');
    expect(modeSelect).toBeTruthy();
    act(() => {
      modeSelect!.props.onValueChange('flow');
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      mode: 'flow',
    });

    const enabledSwitch = root.root.findByType(Switch);
    act(() => {
      enabledSwitch.props.onCheckedChange(false);
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      enabled: false,
    });
  });

  it('edits synthetic endpoint status through the select control', () => {
    const onChange = vi.fn();
    const node: RouteGraphNode = {
      id: 'synthetic.unavailable',
      type: 'synthetic_endpoint',
      name: 'No backend',
      enabled: false,
      visibility: 'internal',
      ownership: 'derived',
      statusCode: 503,
      message: 'No backend',
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const statusSelect = root.root.findAllByType(Select).find((item) => String(item.props.value) === '503');
    expect(statusSelect).toBeTruthy();
    act(() => {
      statusSelect!.props.onValueChange('429');
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      statusCode: 429,
    });

    act(() => {
      root.root.findAllByType(Input)[1]!.props.onChange({ target: { value: 'Rate limited' } });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      message: 'Rate limited',
    });
  });

  it('switches every filter operation type to the graph-native default shape', () => {
    const onChange = vi.fn();
    const node: RouteGraphNode = {
      id: 'filter.rules',
      type: 'filter',
      name: 'Rules',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      operations: [
        { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
      ],
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );
    const operationTypeSelect = root.root.findAllByType(Select)
      .find((item) => item.props.value === 'set_payload');

    expect(operationTypeSelect).toBeTruthy();

    act(() => operationTypeSelect!.props.onValueChange('rewrite_model'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
      ],
    });

    act(() => operationTypeSelect!.props.onValueChange('remove_payload'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'remove_payload', path: 'reasoning_effort' },
      ],
    });

    act(() => operationTypeSelect!.props.onValueChange('set_header'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'set_header', name: 'x-metapi-route', value: 'manual', mode: 'override' },
      ],
    });

    act(() => operationTypeSelect!.props.onValueChange('remove_header'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'remove_header', name: 'x-metapi-route' },
      ],
    });

    act(() => operationTypeSelect!.props.onValueChange('set_endpoint_preference'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'set_endpoint_preference', endpoint: 'responses' },
      ],
    });
  });

  it('edits specialized filter operation fields without corrupting sibling operations', () => {
    const onChange = vi.fn();
    const operations = [
      { type: 'rewrite_model' as const, source: 'current_model' as const, operation: 'strip_suffix' as const, suffix: '-max' },
      { type: 'remove_payload' as const, path: 'debug.trace' },
      { type: 'remove_header' as const, name: 'x-debug' },
      { type: 'set_endpoint_preference' as const, endpoint: 'responses' as const },
    ];
    const node: RouteGraphNode = {
      id: 'filter.specialized',
      type: 'filter',
      name: 'Specialized filters',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      operations,
    };

    const root = create(
      <NodeForm
        node={node}
        readonly={false}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const sourceSelect = root.root.findAllByType(Select).find((item) => item.props.value === 'current_model');
    const rewriteModeSelect = root.root.findAllByType(Select).find((item) => item.props.value === 'strip_suffix');
    const endpointSelect = root.root.findAllByType(Select).find((item) => item.props.value === 'responses');

    act(() => sourceSelect!.props.onValueChange('upstream_model'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'rewrite_model', source: 'upstream_model', operation: 'strip_suffix', suffix: '-max' },
        operations[1],
        operations[2],
        operations[3],
      ],
    });

    act(() => rewriteModeSelect!.props.onValueChange('set'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        { type: 'rewrite_model', source: 'current_model', operation: 'set', suffix: '-max' },
        operations[1],
        operations[2],
        operations[3],
      ],
    });

    act(() => findInputByValue(root.root, 'debug.trace').props.onChange({ target: { value: 'debug' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        operations[0],
        { type: 'remove_payload', path: 'debug' },
        operations[2],
        operations[3],
      ],
    });

    act(() => findInputByValue(root.root, 'x-debug').props.onChange({ target: { value: 'x-metapi-debug' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        operations[0],
        operations[1],
        { type: 'remove_header', name: 'x-metapi-debug' },
        operations[3],
      ],
    });

    act(() => endpointSelect!.props.onValueChange('messages'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...node,
      operations: [
        operations[0],
        operations[1],
        operations[2],
        { type: 'set_endpoint_preference', endpoint: 'messages' },
      ],
    });
  });
});
