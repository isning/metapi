import { AlertTriangle, Link2, Plus, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import type {
  CrossScopeFallback,
  EntryAffinityConfig,
  RouteAffinityPolicy,
} from '../../../shared/routeAffinity.js';
import { DEFAULT_ROUTE_AFFINITY_TTL_SEC } from '../../../shared/routeAffinity.js';
import { Button } from '../../components/ui/button/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import { tr } from '../../i18n.js';

export type AffinityTargetOption = {
  sourceRef: string;
  label: string;
};

export type AffinityEditorValidationIssue = 'empty_pool' | 'duplicate_target';

export function affinityEditorValidationIssues(value: EntryAffinityConfig): AffinityEditorValidationIssue[] {
  const pools = value.pools || [];
  const assigned = new Set<string>();
  let duplicateTarget = false;
  for (const pool of pools) {
    for (const member of pool.members) {
      if (assigned.has(member.sourceRef)) duplicateTarget = true;
      assigned.add(member.sourceRef);
    }
  }
  return [
    ...(pools.some((pool) => pool.members.length === 0) ? ['empty_pool' as const] : []),
    ...(duplicateTarget ? ['duplicate_target' as const] : []),
  ];
}

function nextPoolId(pools: EntryAffinityConfig['pools']): string {
  const used = new Set((pools || []).map((pool) => pool.id));
  let index = 1;
  while (used.has(`pool-${index}`)) index += 1;
  return `pool-${index}`;
}

function modeDescriptionKey(kind: RouteAffinityPolicy['kind']): string {
  if (kind === 'inherit_default') return 'pages.tokenRoutes.affinity.inheritDescription';
  if (kind === 'disabled') return 'pages.tokenRoutes.affinity.disabledDescription';
  if (kind === 'pool') return 'pages.tokenRoutes.affinity.poolDescription';
  return 'pages.tokenRoutes.affinity.targetDescription';
}

function policyForKind(kind: RouteAffinityPolicy['kind']): RouteAffinityPolicy {
  if (kind === 'pool') return { kind, ttlSec: DEFAULT_ROUTE_AFFINITY_TTL_SEC, crossPoolFallback: 'temporary' };
  if (kind === 'target') return { kind, ttlSec: DEFAULT_ROUTE_AFFINITY_TTL_SEC, crossTargetFallback: 'temporary' };
  return { kind };
}

function fallbackForPolicy(policy: RouteAffinityPolicy): CrossScopeFallback {
  if (policy.kind === 'pool') return policy.crossPoolFallback;
  if (policy.kind === 'target') return policy.crossTargetFallback;
  return 'temporary';
}

export function AffinityEditor({
  value,
  onChange,
  allowInherit = true,
  showPools = true,
  showHeader = true,
  targetOptions = [],
  targetOptionsLoading = false,
  targetOptionsError = false,
  disabled = false,
}: {
  value: EntryAffinityConfig;
  onChange: (value: EntryAffinityConfig) => void;
  allowInherit?: boolean;
  showPools?: boolean;
  showHeader?: boolean;
  targetOptions?: AffinityTargetOption[];
  targetOptionsLoading?: boolean;
  targetOptionsError?: boolean;
  disabled?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const policy = value.policy;
  const setPolicy = (next: RouteAffinityPolicy) => onChange(next.kind === 'pool' || next.kind === 'inherit_default'
    ? { ...value, policy: next }
    : { policy: next });
  const setFallback = (fallback: CrossScopeFallback) => {
    if (policy.kind === 'pool') setPolicy({ ...policy, crossPoolFallback: fallback });
    if (policy.kind === 'target') setPolicy({ ...policy, crossTargetFallback: fallback });
  };
  const setTtl = (ttlSec: number) => {
    if (policy.kind === 'pool' || policy.kind === 'target') {
      setPolicy({ ...policy, ttlSec: Math.max(30, Math.trunc(ttlSec || 30)) });
    }
  };
  const pools = value.pools || [];
  const configuredRefs = new Set(pools.flatMap((pool) => pool.members.map((member) => member.sourceRef)));
  const targets = Array.from(new Map([
    ...Array.from(configuredRefs).map((sourceRef) => ({ sourceRef, label: sourceRef })),
    ...targetOptions,
  ].map((target) => [target.sourceRef, target])).values());
  const assignedPoolByTarget = new Map<string, string>();
  for (const pool of pools) {
    for (const member of pool.members) {
      if (!assignedPoolByTarget.has(member.sourceRef)) assignedPoolByTarget.set(member.sourceRef, pool.id);
    }
  }
  const validationIssues = affinityEditorValidationIssues(value);
  const errors = validationIssues.map((issue) => tr(issue === 'empty_pool'
    ? 'pages.tokenRoutes.affinity.emptyPoolError'
    : 'pages.tokenRoutes.affinity.duplicateTargetError'));
  const assignedCount = new Set(pools.flatMap((pool) => pool.members.map((member) => member.sourceRef))).size;
  const addPool = () => {
    const id = nextPoolId(pools);
    onChange({
      ...value,
      pools: [...pools, { id, members: [] }],
    });
    const reveal = () => {
      const pool = editorRef.current
        ?.querySelector<HTMLElement>(`[data-affinity-pool-id="${id}"]`);
      let scroller = pool?.parentElement || null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      if (scroller) scroller.scrollBy({ top: Math.min(140, Math.max(0, pool!.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 24)), behavior: 'smooth' });
    };
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(reveal);
  };

  return (
    <div ref={editorRef} className="grid gap-4" data-testid="affinity-editor">
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4 text-primary" aria-hidden="true" />
              {tr('pages.tokenRoutes.affinity.title')}
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {tr('pages.tokenRoutes.affinity.description')}
            </p>
          </div>
          <ToneBadge tone={policy.kind === 'disabled' ? '-muted' : policy.kind === 'inherit_default' ? '-info' : '-success'}>
            {policy.kind === 'inherit_default'
              ? tr('pages.tokenRoutes.affinity.inherit')
              : policy.kind === 'disabled'
                ? tr('pages.tokenRoutes.affinity.disabled')
                : policy.kind === 'pool'
                  ? tr('pages.tokenRoutes.affinity.pool')
                  : tr('pages.tokenRoutes.affinity.target')}
          </ToneBadge>
        </div>
      ) : null}
      <label className="grid gap-1.5 text-sm font-medium">
        <span>{tr('pages.tokenRoutes.affinity.mode')}</span>
        <Select
          disabled={disabled}
          value={policy.kind}
          onValueChange={(kind) => setPolicy(policyForKind(kind as RouteAffinityPolicy['kind']))}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {allowInherit ? <SelectItem value="inherit_default">{tr('pages.tokenRoutes.affinity.inherit')}</SelectItem> : null}
            <SelectItem value="disabled">{tr('pages.tokenRoutes.affinity.disabled')}</SelectItem>
            <SelectItem value="pool">{tr('pages.tokenRoutes.affinity.pool')}</SelectItem>
            <SelectItem value="target">{tr('pages.tokenRoutes.affinity.target')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs font-normal leading-relaxed text-muted-foreground">
          {tr(modeDescriptionKey(policy.kind))}
        </span>
      </label>

      {(policy.kind === 'pool' || policy.kind === 'target') ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{tr('pages.tokenRoutes.affinity.ttl')}</span>
            <Input
              disabled={disabled}
              type="number"
              min={30}
              value={policy.ttlSec}
              onChange={(event) => setTtl(Number(event.target.value))}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{tr('pages.tokenRoutes.affinity.fallback')}</span>
            <Select disabled={disabled} value={fallbackForPolicy(policy)} onValueChange={(next) => setFallback(next as CrossScopeFallback)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deny">{tr('pages.tokenRoutes.affinity.fallbackDeny')}</SelectItem>
                <SelectItem value="temporary">{tr('pages.tokenRoutes.affinity.fallbackTemporary')}</SelectItem>
                <SelectItem value="promote_on_success">{tr('pages.tokenRoutes.affinity.fallbackPromote')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}

      {showPools && (policy.kind === 'pool' || policy.kind === 'inherit_default') ? (
        <div className="grid gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{tr('pages.tokenRoutes.affinity.pools')}</span>
                <ToneBadge tone="-muted">
                  {tr('pages.tokenRoutes.affinity.assignmentSummary')
                    .replace('{assigned}', String(assignedCount))
                    .replace('{total}', String(targets.length))}
                </ToneBadge>
              </div>
              <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.affinity.poolsHint')}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={addPool}
            >
              <Plus className="size-4" />
              {tr('pages.tokenRoutes.affinity.addPool')}
            </Button>
          </div>
          {pools.map((pool, poolIndex) => {
            const selected = new Set(pool.members.map((member) => member.sourceRef));
            return (
              <div
                key={pool.id}
                data-affinity-pool-id={pool.id}
                className={`grid gap-3 rounded-lg border bg-background/60 p-3 ${pool.members.length === 0 ? 'border-warning/45' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <Input
                      disabled={disabled}
                      value={pool.label || ''}
                      placeholder={tr('pages.tokenRoutes.affinity.poolName')}
                      aria-label={tr('pages.tokenRoutes.affinity.poolName')}
                      onChange={(event) => onChange({
                        ...value,
                        pools: pools.map((item, index) => index === poolIndex
                          ? { ...item, label: event.target.value || undefined }
                          : item),
                      })}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <code>{pool.id}</code>
                      <span>·</span>
                      <span>{tr('pages.tokenRoutes.affinity.memberCount').replace('{count}', String(pool.members.length))}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={tr('pages.tokenRoutes.affinity.removePool')}
                    onClick={() => onChange({ ...value, pools: pools.filter((_, index) => index !== poolIndex) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border bg-muted/10 p-2">
                  {targets.map((target) => {
                    const assignedPool = assignedPoolByTarget.get(target.sourceRef);
                    const assignedElsewhere = !!assignedPool && assignedPool !== pool.id;
                    return (
                    <label key={target.sourceRef} className={`flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs ${assignedElsewhere ? 'opacity-55' : 'hover:bg-muted/45'}`}>
                      <Checkbox
                        disabled={disabled || assignedElsewhere}
                        checked={selected.has(target.sourceRef)}
                        onCheckedChange={(checked) => onChange({
                          ...value,
                          pools: pools.map((item, index) => index === poolIndex
                            ? {
                                ...item,
                                members: checked
                                  ? [...item.members, { kind: 'execution_target', sourceRef: target.sourceRef }]
                                  : item.members.filter((member) => member.sourceRef !== target.sourceRef),
                              }
                            : item),
                        })}
                      />
                      <span className="min-w-0 flex-1 truncate" title={target.sourceRef}>{target.label}</span>
                      {assignedElsewhere ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {tr('pages.tokenRoutes.affinity.assignedTo').replace('{pool}', assignedPool)}
                        </span>
                      ) : null}
                    </label>
                  );})}
                  {targetOptionsLoading ? (
                    <span className="p-2 text-xs text-muted-foreground">{tr('pages.tokenRoutes.affinity.loadingTargets')}</span>
                  ) : targetOptionsError ? (
                    <span className="p-2 text-xs text-destructive">{tr('pages.tokenRoutes.affinity.targetsLoadFailed')}</span>
                  ) : targets.length === 0 ? (
                    <span className="p-2 text-xs text-muted-foreground">{tr('pages.tokenRoutes.affinity.noTargets')}</span>
                  ) : null}
                </div>
                {pool.members.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-warning">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {tr('pages.tokenRoutes.affinity.emptyPool')}
                  </div>
                ) : null}
              </div>
            );
          })}
          {pools.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/10 p-4 text-xs leading-relaxed text-muted-foreground">
              {tr('pages.tokenRoutes.affinity.noPools')}
            </div>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-destructive/35 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          {errors.map((error) => <span key={error}>{error}</span>)}
        </div>
      ) : null}
    </div>
  );
}
