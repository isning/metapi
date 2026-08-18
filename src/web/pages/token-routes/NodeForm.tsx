import { LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';
import type {
  RouteEndpointConfig,
  RouteFilter,
  RouteGraphNode,
} from '../../../shared/routeGraph.js';
import type { DispatchPolicyRegistryPayload } from '../../api.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { tr } from '../../i18n.js';
import { DispatcherPolicySelect } from './DispatcherPolicySelect.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';
import { AffinityEditor, type AffinityTargetOption } from './AffinityEditor.js';

const FILTER_TYPES: Array<{ value: RouteFilter['type']; label: string }> = [
  { value: 'rewrite_model', label: tr('pages.tokenRoutes.nodeForm.filterRewriteModel') },
  { value: 'set_payload', label: tr('pages.tokenRoutes.nodeForm.filterSetPayload') },
  { value: 'remove_payload', label: tr('pages.tokenRoutes.nodeForm.filterRemovePayload') },
  { value: 'set_header', label: tr('pages.tokenRoutes.nodeForm.filterSetHeader') },
  { value: 'remove_header', label: tr('pages.tokenRoutes.nodeForm.filterRemoveHeader') },
  { value: 'set_endpoint_preference', label: tr('pages.tokenRoutes.nodeForm.filterEndpointPreference') },
];

function defaultFilter(type: RouteFilter['type']): RouteFilter {
  switch (type) {
    case 'rewrite_model': return { type, source: 'current_model', operation: 'set', value: '' };
    case 'set_payload': return { type, path: '', value: '', mode: 'default' };
    case 'remove_payload': return { type, path: '' };
    case 'set_header': return { type, name: '', value: '', mode: 'override' };
    case 'remove_header': return { type, name: '' };
    case 'set_endpoint_preference': return { type, endpoint: 'responses' };
  }
}

function parseFilterValue(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function stringFilterValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</label>;
}

export function FilterOperationsEditor({
  value,
  disabled = false,
  onChange,
}: {
  value: RouteFilter[];
  disabled?: boolean;
  onChange: (operations: RouteFilter[]) => void;
}) {
  const update = (index: number, operation: RouteFilter) => onChange(value.map((item, itemIndex) => itemIndex === index ? operation : item));
  return <div className="grid min-w-0 gap-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-medium">{tr('pages.tokenRoutes.nodeForm.requestFilterRules')}</div><div className="mt-0.5 text-xs text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.requestFilterRulesDescription')}</div></div><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...value, defaultFilter('rewrite_model')])}><Plus className="size-4" />{tr('pages.tokenRoutes.nodeForm.addFilter')}</Button></div>
    {value.length === 0 ? <div className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.noFiltersConfigured')}</div> : null}
    {value.map((operation, index) => <div key={`${operation.type}-${index}`} className="grid min-w-0 gap-3 rounded-md border bg-card p-3"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="truncate text-xs font-semibold text-foreground">{FILTER_TYPES.find((item) => item.value === operation.type)?.label || operation.type}</span><Badge variant="outline">{operation.type === 'rewrite_model' ? tr('pages.tokenRoutes.nodeForm.preSelectionStageShort') : tr('pages.tokenRoutes.nodeForm.postBuildStageShort')}</Badge></div></div><Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={tr('pages.tokenRoutes.nodeForm.removeOperation')} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button></div><div className="grid gap-3 sm:grid-cols-2"><Field label={tr('pages.tokenRoutes.nodeForm.type')}><Select disabled={disabled} value={operation.type} onValueChange={(next) => update(index, defaultFilter(next as RouteFilter['type']))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FILTER_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>{operation.type === 'rewrite_model' && <><Field label={tr('pages.tokenRoutes.nodeForm.source')}><Select disabled={disabled} value={operation.source} onValueChange={(source) => update(index, { ...operation, source: source as 'current_model' | 'upstream_model' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current_model">{tr('pages.tokenRoutes.nodeForm.currentModel')}</SelectItem><SelectItem value="upstream_model">{tr('pages.tokenRoutes.nodeForm.upstreamModel')}</SelectItem></SelectContent></Select></Field><Field label={tr('pages.tokenRoutes.nodeForm.operation')}><Select disabled={disabled} value={operation.operation} onValueChange={(next) => update(index, { ...operation, operation: next as 'set' | 'strip_suffix' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="set">{tr('pages.tokenRoutes.nodeForm.setModel')}</SelectItem><SelectItem value="strip_suffix">{tr('pages.tokenRoutes.nodeForm.stripSuffix')}</SelectItem></SelectContent></Select></Field><Field label={operation.operation === 'set' ? tr('pages.tokenRoutes.nodeForm.modelValue') : tr('pages.tokenRoutes.nodeForm.suffix')}><Input disabled={disabled} value={operation.operation === 'set' ? operation.value || '' : operation.suffix || ''} onChange={(event) => update(index, operation.operation === 'set' ? { ...operation, value: event.target.value } : { ...operation, suffix: event.target.value })} /></Field></>}{operation.type === 'set_payload' && <><Field label={tr('pages.tokenRoutes.nodeForm.payloadPath')}><Input disabled={disabled} value={operation.path} onChange={(event) => update(index, { ...operation, path: event.target.value })} /></Field><Field label={tr('pages.tokenRoutes.nodeForm.mode')}><Select disabled={disabled} value={operation.mode || 'default'} onValueChange={(mode) => update(index, { ...operation, mode: mode as 'default' | 'override' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">{tr('pages.tokenRoutes.nodeForm.defaultMode')}</SelectItem><SelectItem value="override">{tr('pages.tokenRoutes.nodeForm.overrideMode')}</SelectItem></SelectContent></Select></Field><Field label={tr('pages.tokenRoutes.nodeForm.valueJson')}><Input disabled={disabled} value={stringFilterValue(operation.value)} onChange={(event) => update(index, { ...operation, value: parseFilterValue(event.target.value) })} /></Field></>}{operation.type === 'remove_payload' && <Field label={tr('pages.tokenRoutes.nodeForm.payloadPath')}><Input disabled={disabled} value={operation.path} onChange={(event) => update(index, { ...operation, path: event.target.value })} /></Field>}{operation.type === 'set_header' && <><Field label={tr('pages.tokenRoutes.nodeForm.headerName')}><Input disabled={disabled} value={operation.name} onChange={(event) => update(index, { ...operation, name: event.target.value })} /></Field><Field label={tr('pages.tokenRoutes.nodeForm.headerValue')}><Input disabled={disabled} value={operation.value} onChange={(event) => update(index, { ...operation, value: event.target.value })} /></Field></>}{operation.type === 'remove_header' && <Field label={tr('pages.tokenRoutes.nodeForm.headerName')}><Input disabled={disabled} value={operation.name} onChange={(event) => update(index, { ...operation, name: event.target.value })} /></Field>}{operation.type === 'set_endpoint_preference' && <Field label={tr('pages.tokenRoutes.nodeForm.endpoint')}><Select disabled={disabled} value={operation.endpoint} onValueChange={(endpoint) => update(index, { ...operation, endpoint: endpoint as 'chat' | 'messages' | 'responses' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="responses">responses</SelectItem><SelectItem value="chat">chat</SelectItem><SelectItem value="messages">messages</SelectItem></SelectContent></Select></Field>}</div></div>)}
  </div>;
}

export function NodeForm({
  node,
  readonly,
  onChange,
  onDelete,
  policyRegistry,
  referenceEndpoints = [],
  affinityTargets = [],
  referenceEndpointCatalog,
}: {
  node: RouteGraphNode;
  readonly: boolean;
  onChange: (node: RouteGraphNode) => void;
  onDelete: () => void;
  policyRegistry?: DispatchPolicyRegistryPayload | null;
  referenceEndpoints?: Array<{ id: string; label: string }>;
  affinityTargets?: AffinityTargetOption[];
  referenceEndpointCatalog?: {
    query: string;
    loading: boolean;
    hasMore: boolean;
    onQueryChange: (query: string) => void;
    onLoadMore: () => void;
  };
}) {
  const patch = (data: Partial<RouteGraphNode>) => onChange({ ...node, ...data } as RouteGraphNode);
  return <div className="grid gap-4 text-sm"><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.name')}<Input disabled={readonly} value={node.name || ''} onChange={(event) => patch({ name: event.target.value })} /></label><label className="flex items-center justify-between gap-3 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.enabled')}<Switch disabled={readonly} checked={node.enabled} onCheckedChange={(enabled) => patch({ enabled })} /></label>{node.type === 'entry' && <EntryNodeForm node={node} readonly={readonly} affinityTargets={affinityTargets || []} onChange={patch} />}{node.type === 'filter' && <FilterOperationsEditor value={node.operations} disabled={readonly} onChange={(operations) => patch({ operations } as Partial<RouteGraphNode>)} />}{node.type === 'dispatcher' && <DispatcherNodeForm node={node} readonly={readonly} registry={policyRegistry} onChange={patch} />}{node.type === 'route_endpoint' && <RouteEndpointNodeForm node={node} readonly={readonly} registry={policyRegistry} referenceEndpoints={referenceEndpoints.filter((item) => item.id !== node.routeEndpointId)} referenceEndpointCatalog={referenceEndpointCatalog} onChange={patch} />}{node.type === 'synthetic_endpoint' && <SyntheticEndpointNodeForm node={node} readonly={readonly} onChange={patch} />}{!readonly && <Button type="button" variant="destructive" size="sm" onClick={onDelete}><Trash2 className="size-4" />{tr('pages.tokenRoutes.nodeForm.delete')}</Button>}</div>;
}

function EntryNodeForm({ node, readonly, affinityTargets, onChange }: { node: Extract<RouteGraphNode, { type: 'entry' }>; readonly: boolean; affinityTargets: AffinityTargetOption[]; onChange: (patch: Partial<RouteGraphNode>) => void }) {
  return <div className="grid gap-3"><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.requestedModelPattern')}<Input disabled={readonly} value={node.match.requestedModelPattern || ''} onChange={(event) => onChange({ match: { ...node.match, requestedModelPattern: event.target.value } } as Partial<RouteGraphNode>)} /></label><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.upstreamModel')}<Input disabled={readonly} value={node.match.currentModelPattern || ''} onChange={(event) => onChange({ match: { ...node.match, currentModelPattern: event.target.value || undefined } } as Partial<RouteGraphNode>)} /></label><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.publicDisplayName')}<Input disabled={readonly} value={node.match.displayName || ''} onChange={(event) => onChange({ match: { ...node.match, displayName: event.target.value || null } } as Partial<RouteGraphNode>)} /></label><div className="rounded-lg border bg-muted/10 p-3"><AffinityEditor disabled={readonly} value={node.affinity || { policy: { kind: 'inherit_default' }, pools: [] }} targetOptions={affinityTargets} onChange={(affinity) => onChange({ affinity } as Partial<RouteGraphNode>)} /></div></div>;
}

function DispatcherNodeForm({ node, readonly, registry, onChange }: { node: Extract<RouteGraphNode, { type: 'dispatcher' }>; readonly: boolean; registry?: DispatchPolicyRegistryPayload | null; onChange: (patch: Partial<RouteGraphNode>) => void }) {
  return <div className="grid gap-3"><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.mode')}<Select disabled={readonly} value={node.mode} onValueChange={(mode) => onChange({ mode: mode as 'route' | 'flow' } as Partial<RouteGraphNode>)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="route">route</SelectItem><SelectItem value="flow">flow</SelectItem></SelectContent></Select></label><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.dispatchPolicy')}<DispatcherPolicySelect disabled={readonly} value={node.policy} registry={registry} onChange={(policy) => policy && onChange({ policy } as Partial<RouteGraphNode>)} /></label></div>;
}

function RouteEndpointNodeForm({ node, readonly, registry, referenceEndpoints, referenceEndpointCatalog, onChange }: { node: Extract<RouteGraphNode, { type: 'route_endpoint' }>; readonly: boolean; registry?: DispatchPolicyRegistryPayload | null; referenceEndpoints: Array<{ id: string; label: string }>; referenceEndpointCatalog?: { query: string; loading: boolean; hasMore: boolean; onQueryChange: (query: string) => void; onLoadMore: () => void }; onChange: (patch: Partial<RouteGraphNode>) => void }) {
  const config = (node.config && typeof node.config === 'object' && !Array.isArray(node.config) ? node.config : { targets: [] }) as RouteEndpointConfig;
  const endpointIds = node.backend.kind === 'route_endpoints' ? node.backend.endpointIds : [];
  const patchConfig = (next: RouteEndpointConfig) => onChange({ config: next } as Partial<RouteGraphNode>);
  const patchBackend = (backend: Extract<RouteGraphNode, { type: 'route_endpoint' }>['backend']) => onChange({ backend } as Partial<RouteGraphNode>);
  const targetPolicy = config.targetSelection?.kind === 'defer_to_router' ? null : config.targetSelection || { kind: 'inherit_default' as const };
  return <div className="grid gap-3"><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.routeEndpoint')}<Input disabled value={node.routeEndpointId} /></label><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.backend')}<Select disabled={readonly} value={node.backend.kind} onValueChange={(kind) => patchBackend(kind === 'route_endpoints' ? { kind, endpointIds } : { kind: 'supply' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supply">supply</SelectItem><SelectItem value="route_endpoints">route_endpoints</SelectItem></SelectContent></Select></label>{node.backend.kind === 'route_endpoints' && <div className="grid gap-1.5 text-muted-foreground"><span>{tr('pages.tokenRoutes.nodeForm.endpointIds')}</span>{referenceEndpointCatalog && <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8" value={referenceEndpointCatalog.query} placeholder={tr('pages.tokenRoutes.nodeForm.searchEndpoints')} onChange={(event) => referenceEndpointCatalog.onQueryChange(event.target.value)} /></div>}<div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2">{referenceEndpoints.map((endpoint) => <label key={endpoint.id} className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs text-foreground"><Checkbox disabled={readonly} checked={endpointIds.includes(endpoint.id)} onCheckedChange={(checked) => patchBackend({ kind: 'route_endpoints', endpointIds: checked ? [...endpointIds, endpoint.id] : endpointIds.filter((id) => id !== endpoint.id) })} /><span className="min-w-0 truncate" title={endpoint.id}>{endpoint.label}</span></label>)}{referenceEndpoints.length === 0 && !referenceEndpointCatalog?.loading && <span className="px-1 py-2 text-xs text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.noEndpoints')}</span>}{referenceEndpointCatalog?.loading && <span className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{tr('common.loading')}</span>}{referenceEndpointCatalog?.hasMore && !referenceEndpointCatalog.loading && <Button type="button" variant="ghost" size="sm" onClick={referenceEndpointCatalog.onLoadMore}>{tr('common.loadMore')}</Button>}</div></div>}<label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.targetSelection')}<DispatcherPolicySelect disabled={readonly} value={targetPolicy} registry={registry} inheritMode="defer" onChange={(policy) => patchConfig({ ...config, targetSelection: policy || { kind: 'defer_to_router' } })} /></label>{config.targets.map((target, index) => <div key={target.targetId} className="grid gap-2 rounded-md border p-3"><span className="truncate text-xs font-medium" title={target.targetId}>{target.targetId}</span><FailureBackoffEditor disabled={readonly} value={target.failureBackoff || null} onChange={(failureBackoff) => patchConfig({ ...config, targets: config.targets.map((item, current) => current === index ? { ...item, failureBackoff: failureBackoff || undefined } : item) })} /></div>)}</div>;
}

function SyntheticEndpointNodeForm({ node, readonly, onChange }: { node: Extract<RouteGraphNode, { type: 'synthetic_endpoint' }>; readonly: boolean; onChange: (patch: Partial<RouteGraphNode>) => void }) {
  return <div className="grid gap-3"><label className="grid gap-1.5 text-muted-foreground">HTTP<Select disabled={readonly} value={String(node.statusCode)} onValueChange={(statusCode) => onChange({ statusCode: Number(statusCode) as Extract<RouteGraphNode, { type: 'synthetic_endpoint' }>['statusCode'] } as Partial<RouteGraphNode>)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[400, 401, 403, 404, 409, 429, 500, 502, 503].map((statusCode) => <SelectItem key={statusCode} value={String(statusCode)}>{statusCode}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-1.5 text-muted-foreground">{tr('pages.tokenRoutes.nodeForm.message')}<Input disabled={readonly} value={node.message} onChange={(event) => onChange({ message: event.target.value } as Partial<RouteGraphNode>)} /></label></div>;
}
