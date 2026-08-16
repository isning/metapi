import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { normalizeRouteGraphMacro } from '../../../shared/routeGraph.js';
import { Select } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { CandidateSelectorMacroForm } from './CandidateSelectorMacroForm.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';

function macroWithCandidateSource(enabled = false) {
  return normalizeRouteGraphMacro({
    id: 'route:managed:editor-fixture',
    kind: 'candidate_selector',
    ownership: 'manual',
    enabled: true,
    config: {
      surface: { entry: { kind: 'none' }, output: 'route' },
      candidateSource: enabled
        ? { kind: 'model_pattern', pattern: 'deepseek-*' }
        : undefined,
      groups: [{
        id: 'fallback-stage:managed:editor-primary',
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:managed:editor-endpoint'] },
        members: [{
          memberId: 'dispatcher-member:managed:editor-endpoint',
          endpointId: 'route-endpoint:managed:editor-endpoint',
          weight: 7,
        }],
      }],
    },
  });
}

describe('CandidateSelectorMacroForm', () => {
  it('authors the candidate universe on the macro rather than a fallback stage input', () => {
    const onChange = vi.fn();
    const macro = macroWithCandidateSource(false);
    const root = create(
      <CandidateSelectorMacroForm
        macro={macro}
        readonly={false}
        endpoints={[]}
        macros={[]}
        onChange={onChange}
      />,
    );
    const source = root.root.findByProps({ 'data-testid': 'macro-candidate-source' });

    act(() => source!.props.onValueChange('model_pattern'));

    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.config.candidateSource).toEqual({ kind: 'model_pattern', pattern: '' });
    expect(next.config.groups[0].input).toEqual(macro.config.groups[0]?.input);
  });

  it('authors unassigned-candidate ownership on the selected fallback stage', () => {
    const onChange = vi.fn();
    const macro = macroWithCandidateSource(true);
    const root = create(
      <CandidateSelectorMacroForm
        macro={macro}
        readonly={false}
        endpoints={[{ id: 'route-endpoint:managed:editor-endpoint', label: 'Editor endpoint' }]}
        macros={[]}
        onChange={onChange}
      />,
    );
    const acceptUnassigned = root.root.findByProps({ 'data-testid': 'stage-accept-unassigned-0' });

    act(() => acceptUnassigned.props.onCheckedChange(true));

    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.config.groups[0].acceptUnassigned).toBe(true);
    expect(next.config.candidateSource).toEqual(macro.config.candidateSource);
    expect(next.config.groups[0].members).toEqual(macro.config.groups[0]?.members);
  });

  it('updates manual-edge policy on the selected surface port only', () => {
    const onChange = vi.fn();
    const macro = macroWithCandidateSource(false);
    const root = create(
      <CandidateSelectorMacroForm
        macro={macro}
        readonly={false}
        endpoints={[]}
        macros={[]}
        onChange={onChange}
      />,
    );
    const policySwitch = root.root.findByProps({ 'data-testid': 'macro-port-manual-edge-route.out' });

    act(() => policySwitch.props.onCheckedChange(false));

    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.config.surface.ports.find((port: { id: string }) => port.id === 'route.out')?.manualEdgePolicy).toBe('deny');
    expect(next.config.surface.ports.find((port: { id: string }) => port.id === 'candidates.in')?.manualEdgePolicy).toBe('allow');
  });

  it('authors macro, fallback-stage, and member backoff overrides in the Graph config', () => {
    const onChange = vi.fn();
    const macro = macroWithCandidateSource(false);
    const root = create(<CandidateSelectorMacroForm
      macro={macro}
      readonly={false}
      endpoints={[{ id: 'route-endpoint:managed:editor-endpoint', label: 'Editor endpoint' }]}
      macros={[]}
      onChange={onChange}
    />);
    const editors = root.root.findAllByType(FailureBackoffEditor);
    expect(editors).toHaveLength(3);

    act(() => editors[0]!.props.onChange({ mode: 'disabled' }));
    expect(onChange.mock.calls.at(-1)?.[0].config.failureBackoff).toEqual({ mode: 'disabled' });

    act(() => editors[1]!.props.onChange({ mode: 'disabled' }));
    expect(onChange.mock.calls.at(-1)?.[0].config.groups[0].failureBackoff).toEqual({ mode: 'disabled' });

    act(() => editors[2]!.props.onChange({ mode: 'disabled' }));
    expect(onChange.mock.calls.at(-1)?.[0].config.groups[0].members[0].failureBackoff).toEqual({ mode: 'disabled' });
  });
});
