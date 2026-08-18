import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_ROUTE_AFFINITY_TTL_SEC } from '../../../shared/routeAffinity.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Select } from '../../components/ui/select/index.js';
import { AffinityEditor, affinityEditorValidationIssues } from './AffinityEditor.js';

describe('AffinityEditor', () => {
  it('authors every affinity mode with protocol defaults', () => {
    const onChange = vi.fn();
    const root = create(
      <AffinityEditor
        value={{ policy: { kind: 'inherit_default' } }}
        onChange={onChange}
      />,
    );
    const mode = root.root.findByType(Select);

    act(() => mode.props.onValueChange('disabled'));
    expect(onChange).toHaveBeenLastCalledWith({ policy: { kind: 'disabled' } });

    act(() => mode.props.onValueChange('pool'));
    expect(onChange).toHaveBeenLastCalledWith({
      policy: {
        kind: 'pool',
        ttlSec: DEFAULT_ROUTE_AFFINITY_TTL_SEC,
        crossPoolFallback: 'temporary',
      },
    });

    act(() => mode.props.onValueChange('target'));
    expect(onChange).toHaveBeenLastCalledWith({
      policy: {
        kind: 'target',
        ttlSec: DEFAULT_ROUTE_AFFINITY_TTL_SEC,
        crossTargetFallback: 'temporary',
      },
    });

    act(() => mode.props.onValueChange('inherit_default'));
    expect(onChange).toHaveBeenLastCalledWith({ policy: { kind: 'inherit_default' } });
    root.unmount();
  });

  it.each([
    ['deny', 'deny'],
    ['temporary', 'temporary'],
    ['promote_on_success', 'promote_on_success'],
  ] as const)('authors the %s cross-pool fallback', (_label, fallback) => {
    const onChange = vi.fn();
    const root = create(
      <AffinityEditor
        value={{ policy: { kind: 'pool', ttlSec: 900, crossPoolFallback: 'temporary' } }}
        onChange={onChange}
      />,
    );
    const [, fallbackSelect] = root.root.findAllByType(Select);

    act(() => fallbackSelect!.props.onValueChange(fallback));

    expect(onChange).toHaveBeenLastCalledWith({
      policy: { kind: 'pool', ttlSec: 900, crossPoolFallback: fallback },
    });
    root.unmount();
  });

  it('authors target fallback and TTL without changing the selected mode', () => {
    const onChange = vi.fn();
    const value = { policy: { kind: 'target' as const, ttlSec: 900, crossTargetFallback: 'deny' as const } };
    const root = create(<AffinityEditor value={value} onChange={onChange} />);
    const [, fallbackSelect] = root.root.findAllByType(Select);
    const ttlInput = root.root.findByProps({ type: 'number' });

    act(() => fallbackSelect!.props.onValueChange('promote_on_success'));
    expect(onChange).toHaveBeenLastCalledWith({
      policy: { kind: 'target', ttlSec: 900, crossTargetFallback: 'promote_on_success' },
    });

    act(() => ttlInput.props.onChange({ target: { value: '1200' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      policy: { kind: 'target', ttlSec: 1200, crossTargetFallback: 'deny' },
    });
    root.unmount();
  });

  it('authors stable execution-target membership in an Entry-local pool', () => {
    const onChange = vi.fn();
    const value = {
      policy: { kind: 'pool' as const, ttlSec: 900, crossPoolFallback: 'temporary' as const },
      pools: [{
        id: 'pool:primary',
        members: [{ kind: 'execution_target' as const, sourceRef: 'target:a' }],
      }],
    };
    const root = create(
      <AffinityEditor
        value={value}
        targetOptions={[
          { sourceRef: 'target:a', label: 'Target A' },
          { sourceRef: 'target:b', label: 'Target B' },
        ]}
        onChange={onChange}
      />,
    );
    const [targetA, targetB] = root.root.findAllByType(Checkbox);

    expect(targetA!.props.checked).toBe(true);
    expect(targetB!.props.checked).toBe(false);
    act(() => targetB!.props.onCheckedChange(true));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      pools: [{
        id: 'pool:primary',
        members: [
          { kind: 'execution_target', sourceRef: 'target:a' },
          { kind: 'execution_target', sourceRef: 'target:b' },
        ],
      }],
    });

    act(() => targetA!.props.onCheckedChange(false));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      pools: [{
        id: 'pool:primary',
        members: [],
      }],
    });
    root.unmount();
  });

  it('keeps pool membership when an Entry switches to inherited policy', () => {
    const onChange = vi.fn();
    const value = {
      policy: { kind: 'pool' as const, ttlSec: 900, crossPoolFallback: 'temporary' as const },
      pools: [{ id: 'pool-1', members: [{ kind: 'execution_target' as const, sourceRef: 'target:a' }] }],
    };
    const root = create(<AffinityEditor value={value} onChange={onChange} />);
    act(() => root.root.findAllByType(Select)[0]!.props.onValueChange('inherit_default'));
    expect(onChange).toHaveBeenLastCalledWith({
      policy: { kind: 'inherit_default' },
      pools: value.pools,
    });
  });

  it('prevents empty pools and duplicate target membership before save', () => {
    expect(affinityEditorValidationIssues({
      policy: { kind: 'pool', ttlSec: 900, crossPoolFallback: 'temporary' },
      pools: [
        { id: 'pool-1', members: [] },
        { id: 'pool-2', members: [{ kind: 'execution_target', sourceRef: 'target:a' }] },
        { id: 'pool-3', members: [{ kind: 'execution_target', sourceRef: 'target:a' }] },
      ],
    })).toEqual(['empty_pool', 'duplicate_target']);
  });
});
