import type { DispatcherPolicy } from '../../../shared/routeGraph.js';
import type { DispatchPolicyRegistryPayload } from '../../api.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { tr } from '../../i18n.js';

function label(policy: DispatcherPolicy | null | undefined, registry?: DispatchPolicyRegistryPayload | null): string {
  if (!policy || policy.kind === 'inherit_default') return tr('pages.tokenRoutes.routeGroupPolicy.inheritDefault');
  if (policy.kind === 'builtin') {
    if (policy.builtin === 'weighted') return tr('pages.tokenRoutes.weight');
    if (policy.builtin === 'round_robin') return tr('pages.oAuthManagement.roundRobin');
    return tr('pages.tokenRoutes.stableFirst');
  }
  if (policy.kind === 'registry') return registry?.policies.find((item) => item.id === policy.policyId)?.name || policy.policyId;
  return String(policy.policy.name || policy.policy.id);
}

function valueFor(policy: DispatcherPolicy | null | undefined, inheritMode: 'default' | 'group' | 'defer'): string {
  if (!policy) return inheritMode === 'group' ? 'inherit_group' : inheritMode === 'defer' ? 'defer_to_router' : 'inherit_default';
  if (policy.kind === 'inherit_default') return 'inherit_default';
  if (policy.kind === 'builtin') return `builtin:${policy.builtin}`;
  if (policy.kind === 'registry') return `registry:${policy.policyId}`;
  return 'inline:current';
}

function policyFor(value: string, current: DispatcherPolicy | null): DispatcherPolicy | null {
  if (value === 'inherit_group') return null;
  if (value === 'defer_to_router') return null;
  if (value === 'inherit_default') return { kind: 'inherit_default' };
  if (value === 'inline:current') return current?.kind === 'inline' ? current : null;
  if (value.startsWith('registry:')) return { kind: 'registry', policyId: value.slice('registry:'.length) };
  if (value === 'builtin:weighted') return { kind: 'builtin', builtin: 'weighted' };
  if (value === 'builtin:round_robin') return { kind: 'builtin', builtin: 'round_robin' };
  if (value === 'builtin:stable_first') return { kind: 'builtin', builtin: 'stable_first' };
  return current;
}

export function DispatcherPolicySelect({
  value,
  registry,
  disabled,
  className,
  inheritMode = 'default',
  onChange,
}: {
  value: DispatcherPolicy | null;
  registry?: DispatchPolicyRegistryPayload | null;
  disabled?: boolean;
  className?: string;
  inheritMode?: 'default' | 'group' | 'defer';
  onChange: (value: DispatcherPolicy | null) => void;
}) {
  const defaultPolicy = registry?.policies.find((policy) => policy.id === registry.defaultPolicyId);
  return <Select value={valueFor(value, inheritMode)} disabled={disabled} onValueChange={(next) => onChange(policyFor(next, value))}>
    <SelectTrigger className={className}><SelectValue>{label(value, registry)}</SelectValue></SelectTrigger>
    <SelectContent>
      {inheritMode === 'group' && <SelectItem value="inherit_group">{tr('pages.tokenRoutes.routeGroupPolicy.inheritGroup')}</SelectItem>}
      {inheritMode === 'defer' && <SelectItem value="defer_to_router">{tr('pages.tokenRoutes.nodeForm.deferToRouter')}</SelectItem>}
      <SelectItem value="inherit_default">{tr('pages.tokenRoutes.routeGroupPolicy.inheritDefault')}{defaultPolicy ? ` · ${defaultPolicy.name || defaultPolicy.id}` : ''}</SelectItem>
      {(registry?.policies || []).map((policy) => <SelectItem key={policy.id} value={`registry:${policy.id}`}>{policy.name || policy.id}</SelectItem>)}
      <SelectItem value="builtin:weighted">{tr('pages.tokenRoutes.weight')}</SelectItem>
      <SelectItem value="builtin:round_robin">{tr('pages.oAuthManagement.roundRobin')}</SelectItem>
      <SelectItem value="builtin:stable_first">{tr('pages.tokenRoutes.stableFirst')}</SelectItem>
      {value?.kind === 'inline' && <SelectItem value="inline:current">{tr('pages.tokenRoutes.routeGroupPolicy.inlineCurrent')} · {String(value.policy.name || value.policy.id)}</SelectItem>}
    </SelectContent>
  </Select>;
}
