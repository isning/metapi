import { Plus, Trash2 } from 'lucide-react';
import { buildCandidateSelectorSurfacePorts, type CandidateSelectorMacroConfig, type RouteExecutableTarget, type RouteGraphMacro } from '../../../shared/routeGraph.js';
import type { DispatchPolicyRegistryPayload } from '../../api.js';
import { Button } from '../../components/ui/button/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import { tr } from '../../i18n.js';
import { DispatcherPolicySelect } from './DispatcherPolicySelect.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';
import { FilterOperationsEditor } from './NodeForm.js';

type Group = CandidateSelectorMacroConfig['groups'][number];
type GroupInput = Group['input'];

function inputForKind(kind: GroupInput['kind']): GroupInput {
  if (kind === 'route_endpoints') return { kind, endpointIds: [] };
  if (kind === 'graph_references') return { kind, endpointIds: [], macroIds: [] };
  if (kind === 'model_pattern') return { kind, pattern: '' };
  if (kind === 'metadata_query' || kind === 'endpoint_query') return { kind, cel: '' };
  if (kind === 'inline_endpoints') return { kind, endpoints: [] };
  return { kind: 'synthetic', statusCode: 503, message: 'No route is available.' };
}

type GroupMember = NonNullable<Group['members']>[number];

function reconcileSurfacePorts(surface: CandidateSelectorMacroConfig['surface']): CandidateSelectorMacroConfig['surface']['ports'] {
  const existingPolicyByPortId = new Map(surface.ports.map((port) => [port.id, port.manualEdgePolicy]));
  return buildCandidateSelectorSurfacePorts(surface).map((port) => ({
    ...port,
    manualEdgePolicy: existingPolicyByPortId.get(port.id) || port.manualEdgePolicy,
  }));
}

function patchSurface(
  surface: CandidateSelectorMacroConfig['surface'],
  patch: Partial<Pick<CandidateSelectorMacroConfig['surface'], 'entry' | 'output'>>,
): CandidateSelectorMacroConfig['surface'] {
  const next = { ...surface, ...patch };
  return { ...next, ports: reconcileSurfacePorts(next) };
}

function selectedReferences(input: GroupInput): Array<{ endpointId?: string; macroId?: string }> {
  if (input.kind === 'route_endpoints') return input.endpointIds.map((endpointId) => ({ endpointId }));
  if (input.kind === 'graph_references') return [
    ...input.endpointIds.map((endpointId) => ({ endpointId })),
    ...input.macroIds.map((macroId) => ({ macroId })),
  ];
  return [];
}

function reconcileMembers(input: GroupInput, members: Group['members']): GroupMember[] | undefined {
  const selected = selectedReferences(input);
  if (selected.length === 0) return undefined;
  return selected.map((reference) => {
    const existing = (members || []).find((member) => (
      reference.endpointId ? member.endpointId === reference.endpointId : member.macroId === reference.macroId
    ));
    return existing ? { ...existing, ...reference } : reference;
  });
}

function InlineEndpointsEditor({ endpoints, readonly, onChange }: {
  endpoints: RouteExecutableTarget[];
  readonly: boolean;
  onChange: (endpoints: RouteExecutableTarget[]) => void;
}) {
  const patch = (index: number, value: Partial<RouteExecutableTarget>) => onChange(
    endpoints.map((endpoint, current) => current === index ? { ...endpoint, ...value } : endpoint),
  );
  return <div className="grid gap-2">
    {endpoints.length === 0 && <p className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.inlineEndpointsEmpty')}</p>}
    {endpoints.map((endpoint, index) => <div key={endpoint.targetId} className="grid gap-2 rounded border p-2">
      <Input value={endpoint.targetId} disabled title={endpoint.targetId} />
      <div className="grid grid-cols-2 gap-2">
        <Input disabled={readonly || endpoint.modelSource === 'request'} value={endpoint.model} placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.targetModel')} onChange={(event) => patch(index, { model: event.target.value })} />
        <Input disabled={readonly} type="number" value={endpoint.weight ?? ''} placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.memberWeight')} onChange={(event) => patch(index, { weight: event.target.value === '' ? null : Number(event.target.value) })} />
      </div>
      <label className="flex items-center gap-2 text-muted-foreground"><Switch disabled={readonly} checked={endpoint.enabled !== false} onCheckedChange={(enabled) => patch(index, { enabled })} />{tr('pages.tokenRoutes.routeGraphWorkspace.memberEnabled')}</label>
      <FailureBackoffEditor disabled={readonly} value={endpoint.failureBackoff || null} onChange={(failureBackoff) => patch(index, { failureBackoff: failureBackoff || undefined })} />
    </div>)}
  </div>;
}

function MemberOverridesEditor({ input, members, macroCandidateSource, readonly, endpointLabels, macroLabels, onChange }: {
  input: GroupInput;
  members: Group['members'];
  macroCandidateSource: boolean;
  readonly: boolean;
  endpointLabels: Map<string, string>;
  macroLabels: Map<string, string>;
  onChange: (members: GroupMember[]) => void;
}) {
  const resolved = macroCandidateSource ? members || [] : reconcileMembers(input, members) || [];
  if (resolved.length === 0) return null;
  const patch = (index: number, value: Partial<GroupMember>) => onChange(
    resolved.map((member, current) => current === index ? { ...member, ...value } : member),
  );
  return <div className="grid gap-2">
    <span className="font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.memberOverrides')}</span>
    {resolved.map((member, index) => {
      const identity = member.endpointId || member.macroId || '';
      const label = member.endpointId ? endpointLabels.get(member.endpointId) : member.macroId ? macroLabels.get(member.macroId) : null;
      return <div key={identity} className="grid gap-2 rounded border p-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-center gap-2">
          <span className="truncate" title={identity}>{label || identity}</span>
          <Switch disabled={readonly} checked={member.enabled !== false} onCheckedChange={(enabled) => patch(index, { enabled })} />
          <Input disabled={readonly} type="number" value={member.weight ?? ''} placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.memberWeight')} onChange={(event) => patch(index, { weight: event.target.value === '' ? undefined : Number(event.target.value) })} />
        </div>
        <FailureBackoffEditor disabled={readonly} value={member.failureBackoff || null} onChange={(failureBackoff) => patch(index, { failureBackoff: failureBackoff || undefined })} />
      </div>;
    })}
  </div>;
}

function GroupInputEditor({ input, readonly, endpoints, macros, currentMacroId, onChange }: {
  input: GroupInput;
  readonly: boolean;
  endpoints: Array<{ id: string; label: string }>;
  macros: Array<{ id: string; label: string }>;
  currentMacroId: string;
  onChange: (input: GroupInput) => void;
}) {
  if (input.kind === 'route_endpoints') return <div className="grid max-h-44 gap-1 overflow-y-auto rounded border p-2">{endpoints.map((endpoint) => <label key={endpoint.id} className="flex items-center gap-2"><Checkbox disabled={readonly} checked={input.endpointIds.includes(endpoint.id)} onCheckedChange={(next) => onChange({ ...input, endpointIds: next ? [...input.endpointIds, endpoint.id] : input.endpointIds.filter((id) => id !== endpoint.id) })} /><span className="truncate" title={endpoint.id}>{endpoint.label}</span></label>)}</div>;
  if (input.kind === 'graph_references') return <div className="grid max-h-44 gap-1 overflow-y-auto rounded border p-2">
    {endpoints.map((endpoint) => <label key={endpoint.id} className="flex items-center gap-2"><Checkbox disabled={readonly} checked={input.endpointIds.includes(endpoint.id)} onCheckedChange={(next) => onChange({ ...input, endpointIds: next ? [...input.endpointIds, endpoint.id] : input.endpointIds.filter((id) => id !== endpoint.id) })} /><span className="truncate" title={endpoint.id}>{endpoint.label}</span></label>)}
    {macros.filter((item) => item.id !== currentMacroId).map((item) => <label key={item.id} className="flex items-center gap-2"><Checkbox disabled={readonly} checked={input.macroIds.includes(item.id)} onCheckedChange={(next) => onChange({ ...input, macroIds: next ? [...input.macroIds, item.id] : input.macroIds.filter((id) => id !== item.id) })} /><span className="truncate" title={item.id}>{item.label}</span></label>)}
  </div>;
  if (input.kind === 'model_pattern') return <Input disabled={readonly} value={input.pattern} onChange={(event) => onChange({ ...input, pattern: event.target.value })} />;
  if (input.kind === 'metadata_query' || input.kind === 'endpoint_query') return <Textarea disabled={readonly} className="font-mono" value={input.cel} onChange={(event) => onChange({ ...input, cel: event.target.value })} />;
  if (input.kind === 'synthetic') return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"><Input disabled={readonly} type="number" value={input.statusCode} onChange={(event) => onChange({ ...input, statusCode: Number(event.target.value) as 503 })} /><Input disabled={readonly} value={input.message} onChange={(event) => onChange({ ...input, message: event.target.value })} /></div>;
  return <InlineEndpointsEditor endpoints={input.endpoints} readonly={readonly} onChange={(endpoints) => onChange({ ...input, endpoints })} />;
}

export function CandidateSelectorMacroForm({
  macro,
  readonly,
  registry,
  endpoints,
  macros,
  onChange,
}: {
  macro: RouteGraphMacro;
  readonly: boolean;
  registry?: DispatchPolicyRegistryPayload | null;
  endpoints: Array<{ id: string; label: string }>;
  macros: Array<{ id: string; label: string }>;
  onChange: (macro: RouteGraphMacro) => void;
}) {
  const patchConfig = (patch: Partial<CandidateSelectorMacroConfig>) => onChange({
    ...macro,
    config: { ...macro.config, ...patch },
  });
  const patchGroup = (index: number, patch: Partial<Group>) => patchConfig({
    groups: macro.config.groups.map((group, current) => current === index ? { ...group, ...patch } : group),
  });
  const entry = macro.config.surface.entry;
  const endpointLabels = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.label]));
  const macroLabels = new Map(macros.map((item) => [item.id, item.label]));
  const candidateSourceKind = macro.config.candidateSource?.kind || 'none';
  return <div className="grid gap-4 text-xs">
    <div className="grid gap-3 border-b pb-4">
      <label className="grid gap-1.5 text-muted-foreground">
        {tr('pages.tokenRoutes.routeGraphWorkspace.macroEntry')}
        <Select disabled={readonly} value={entry.kind} onValueChange={(kind) => patchConfig({
          surface: patchSurface(macro.config.surface, {
            entry: kind === 'external'
              ? { kind, match: { kind: 'model', requestedModelPattern: '', displayName: null } }
              : kind === 'embedded' ? { kind, input: 'bidirect' } : { kind: 'none' },
          }),
        })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr('pages.tokenRoutes.routeGraphWorkspace.macroEntryNone')}</SelectItem>
            <SelectItem value="embedded">{tr('pages.tokenRoutes.routeGraphWorkspace.macroEntryEmbedded')}</SelectItem>
            <SelectItem value="external">{tr('pages.tokenRoutes.routeGraphWorkspace.macroEntryExternal')}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {entry.kind === 'external' && <Input disabled={readonly} value={entry.match.requestedModelPattern} placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.modelPattern')} onChange={(event) => patchConfig({ surface: patchSurface(macro.config.surface, { entry: { ...entry, match: { ...entry.match, requestedModelPattern: event.target.value } } }) })} />}
      {entry.kind === 'embedded' && <Select disabled={readonly} value={entry.input} onValueChange={(input) => patchConfig({ surface: patchSurface(macro.config.surface, { entry: { kind: 'embedded', input: input as 'request' | 'bidirect' } }) })}>
        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="request">request</SelectItem><SelectItem value="bidirect">bidirect</SelectItem></SelectContent>
      </Select>}
      <label className="grid gap-1.5 text-muted-foreground">
        {tr('pages.tokenRoutes.routeGraphWorkspace.macroOutput')}
        <Select disabled={readonly} value={macro.config.surface.output} onValueChange={(output) => patchConfig({ surface: patchSurface(macro.config.surface, { output: output as 'route' | 'bidirect' })})}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="route">route</SelectItem><SelectItem value="bidirect">bidirect</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5 text-muted-foreground">
        {tr('pages.tokenRoutes.routeGraphWorkspace.macroPolicy')}
        <DispatcherPolicySelect disabled={readonly} value={macro.config.policy} registry={registry} onChange={(policy) => patchConfig({ policy: policy || { kind: 'inherit_default' } })} />
      </label>
      <FailureBackoffEditor disabled={readonly} value={macro.config.failureBackoff || null} onChange={(failureBackoff) => patchConfig({ failureBackoff: failureBackoff || undefined })} />
      <div className="grid gap-2 rounded-md border p-3">
        <label className="grid gap-1.5 text-muted-foreground">
          {tr('pages.tokenRoutes.routeGraphWorkspace.macroCandidateSource')}
          <Select data-testid="macro-candidate-source" disabled={readonly} value={candidateSourceKind} onValueChange={(kind) => patchConfig({
            candidateSource: kind === 'model_pattern'
              ? { kind: 'model_pattern', pattern: '' }
              : undefined,
            groups: macro.config.groups.map((group) => ({
              ...group,
              acceptUnassigned: kind === 'model_pattern' ? group.acceptUnassigned : undefined,
            })),
          })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tr('pages.tokenRoutes.routeGraphWorkspace.candidateSourceNone')}</SelectItem>
              <SelectItem value="model_pattern">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.modelPattern')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {macro.config.candidateSource?.kind === 'model_pattern' && <Input
          disabled={readonly}
          value={macro.config.candidateSource.pattern}
          placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.modelPattern')}
          onChange={(event) => patchConfig({ candidateSource: { kind: 'model_pattern', pattern: event.target.value } })}
        />}
        <p className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.macroCandidateSourceDescription')}</p>
      </div>
      <FilterOperationsEditor disabled={readonly} value={macro.config.filters?.operations || []} onChange={(operations) => patchConfig({ filters: { operations } })} />
    </div>
    <div className="grid gap-2 rounded-md border p-3">
      <span className="font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.manualEdgePolicy')}</span>
      {macro.config.surface.ports.map((port) => (
        <label key={port.id} className="flex min-w-0 items-center justify-between gap-3 text-muted-foreground">
          <span className="min-w-0 truncate" title={port.id}>{port.label}</span>
          <Switch
            data-testid={`macro-port-manual-edge-${port.id}`}
            disabled={readonly}
            checked={port.manualEdgePolicy === 'allow'}
            onCheckedChange={(allowed) => patchConfig({
              surface: {
                ...macro.config.surface,
                ports: macro.config.surface.ports.map((item) => item.id === port.id
                  ? { ...item, manualEdgePolicy: allowed ? 'allow' : 'deny' }
                  : item),
              },
            })}
          />
        </label>
      ))}
    </div>
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.macroStages')}</span>
      <Button type="button" size="sm" variant="outline" disabled={readonly} onClick={() => patchConfig({ groups: [...macro.config.groups, { id: '', enabled: true, input: { kind: 'route_endpoints', endpointIds: [] }, members: [] }] })}>
        <Plus size={14} />{tr('pages.tokenRoutes.routeGraphWorkspace.addStage')}
      </Button>
    </div>
    {macro.config.groups.map((group, index) => <div key={group.id || index} className="grid gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input disabled={readonly} value={group.label || ''} placeholder={`${tr('pages.tokenRoutes.routeGraphWorkspace.stage')} ${index + 1}`} onChange={(event) => patchGroup(index, { label: event.target.value })} />
        <Switch disabled={readonly} checked={group.enabled} onCheckedChange={(enabled) => patchGroup(index, { enabled })} />
        <Button type="button" size="icon" variant="ghost" disabled={readonly} title={tr('common.delete')} onClick={() => patchConfig({ groups: macro.config.groups.filter((_, current) => current !== index) })}><Trash2 size={14} /></Button>
      </div>
      <DispatcherPolicySelect disabled={readonly} value={group.policy || null} registry={registry} inheritMode="group" onChange={(policy) => patchGroup(index, { policy: policy || undefined })} />
      <FailureBackoffEditor disabled={readonly} value={group.failureBackoff || null} onChange={(failureBackoff) => patchGroup(index, { failureBackoff: failureBackoff || undefined })} />
      {macro.config.candidateSource && <label className="flex items-center justify-between gap-3 text-muted-foreground">
        <span>{tr('pages.tokenRoutes.routeGraphWorkspace.acceptUnassigned')}</span>
        <Switch data-testid={`stage-accept-unassigned-${index}`} disabled={readonly} checked={group.acceptUnassigned === true} onCheckedChange={(acceptUnassigned) => patchGroup(index, { acceptUnassigned: acceptUnassigned || undefined })} />
      </label>}
      <Select disabled={readonly} value={group.input.kind} onValueChange={(kind) => patchGroup(index, { input: inputForKind(kind as GroupInput['kind']), members: [] })}>
        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="route_endpoints">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.routeEndpoints')}</SelectItem>
          <SelectItem value="graph_references">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.graphReferences')}</SelectItem>
          <SelectItem value="model_pattern">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.modelPattern')}</SelectItem>
          <SelectItem value="metadata_query">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.metadataQuery')}</SelectItem>
          <SelectItem value="endpoint_query">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.endpointQuery')}</SelectItem>
          {group.input.kind === 'inline_endpoints' && <SelectItem value="inline_endpoints">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.inlineEndpoints')}</SelectItem>}
          <SelectItem value="synthetic">{tr('pages.tokenRoutes.routeGraphWorkspace.inputKind.synthetic')}</SelectItem>
        </SelectContent>
      </Select>
      <GroupInputEditor input={group.input} readonly={readonly} endpoints={endpoints} macros={macros} currentMacroId={macro.id} onChange={(input) => patchGroup(index, { input, members: reconcileMembers(input, group.members) })} />
      <MemberOverridesEditor input={group.input} members={group.members} macroCandidateSource={!!macro.config.candidateSource} readonly={readonly} endpointLabels={endpointLabels} macroLabels={macroLabels} onChange={(members) => patchGroup(index, { members })} />
    </div>)}
  </div>;
}
