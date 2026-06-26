import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { Badge } from '../../components/ui/badge/index.js';
import * as DropdownMenu from '../../components/ui/dropdown-menu/index.js';
import { Braces, ChevronDown, GitBranch, Heading, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import type { RouteFilter, RouteGraphNode, RouteGraphNodeType } from './routeGraphTypes.js';
import { UpstreamCompatibilityPolicyEditor } from '../../components/UpstreamCompatibilityPolicyEditor.js';
import {
  policyFormFromStoredValue,
  serializeCompatibilityPolicyForm,
} from '../../lib/upstreamCompatibilityPolicyEditor.js';
import { tr } from '../../i18n.js';

function SelectField<TValue extends string>({
  value,
  disabled,
  placeholder,
  options,
  onChange,
}: {
  value: TValue;
  disabled?: boolean;
  placeholder?: string;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={(next) => onChange(next as TValue)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NodeForm({ node, readonly, onChange, onDelete }: {
  node: RouteGraphNode;
  readonly: boolean;
  onChange: (node: RouteGraphNode) => void;
  onDelete: () => void;
}) {
  const update = (patch: Partial<RouteGraphNode>) => onChange({ ...node, ...patch });
  const TypeEditor = NODE_EDITOR_BY_TYPE[node.type] || null;
  return (
    <div className="grid gap-3">
      <label>
        {tr('pages.tokenRoutes.nodeForm.name')}
        <Input disabled={readonly} value={String(node.name || '')} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.visibility')}
        <SelectField
          disabled={readonly}
          value={node.visibility}
          options={[
            { value: 'public', label: 'public' },
            { value: 'internal', label: 'internal' },
          ]}
          onChange={(visibility) => update({ visibility })}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span>{tr('pages.tokenRoutes.nodeForm.enabled')}</span>
        <Switch disabled={readonly} checked={node.enabled} onCheckedChange={(enabled) => update({ enabled })} aria-label={tr('pages.tokenRoutes.nodeForm.enabled')} />
      </div>
      {TypeEditor && <TypeEditor readonly={readonly} node={node} onChange={update} />}
      <Button variant="destructive" size="sm" type="button" disabled={readonly} onClick={readonly ? undefined : onDelete}>{tr('pages.tokenRoutes.nodeForm.delete')}</Button>
    </div>
  );
}

type NodeEditorProps = {
  readonly: boolean;
  node: RouteGraphNode;
  onChange: (patch: Partial<RouteGraphNode>) => void;
};

const NODE_EDITOR_BY_TYPE: Partial<Record<RouteGraphNodeType, (props: NodeEditorProps) => ReactNode>> = {
  entry: EntryNodeEditor,
  filter: FilterNodeEditor,
  dispatcher: DispatcherEditor,
  route_endpoint: RouteEndpointEditor,
  auto_node: AutoNodeEditor,
  synthetic_endpoint: SyntheticEndpointEditor,
};

function EntryNodeEditor({ readonly, node, onChange }: NodeEditorProps) {
  const match = (node.match || {}) as any;
  return (
    <>
      <label>
        {tr('pages.tokenRoutes.nodeForm.requestedModelPattern')}
        <Input disabled={readonly} value={String(match.requestedModelPattern || '')} onChange={(event) => onChange({ match: { ...match, kind: 'model', requestedModelPattern: event.target.value } })} />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.publicDisplayName')}
        <Input disabled={readonly} value={String(match.displayName || '')} onChange={(event) => onChange({ match: { ...match, kind: 'model', displayName: event.target.value || null } })} />
      </label>
    </>
  );
}

function FilterNodeEditor({ readonly, node, onChange }: NodeEditorProps) {
  return (
    <FilterOperationsEditor
      readonly={readonly}
      operations={(Array.isArray(node.operations) ? node.operations : []) as RouteFilter[]}
      onChange={(operations) => onChange({ operations })}
    />
  );
}

function AutoNodeEditor({ readonly, node, onChange }: NodeEditorProps) {
  return (
    <>
      <label>
        {tr('pages.tokenRoutes.nodeForm.legacyRouteId')}
        <Input disabled={readonly} value={String(node.legacyRouteId || '')} onChange={(event) => onChange({ legacyRouteId: Number(event.target.value) || null })} />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.routeNodeId')}
        <Input disabled={readonly} value={String(node.routeNodeId || '')} onChange={(event) => onChange({ routeNodeId: event.target.value })} />
      </label>
    </>
  );
}

function SyntheticEndpointEditor({ readonly, node, onChange }: NodeEditorProps) {
  return (
    <>
      <label>
        {tr('pages.tokenRoutes.nodeForm.status')}
        <SelectField
          disabled={readonly}
          value={String(node.statusCode || 503)}
          options={[
            { value: '503', label: '503 Service Unavailable' },
            { value: '429', label: '429 Rate Limited' },
          ]}
          onChange={(statusCode) => onChange({ statusCode: Number(statusCode) as 429 | 503 })}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.message')}
        <Input disabled={readonly} value={String(node.message || '')} onChange={(event) => onChange({ message: event.target.value })} />
      </label>
    </>
  );
}

function defaultOperation(type: RouteFilter['type']): RouteFilter {
  if (type === 'rewrite_model') return { type, source: 'current_model', operation: 'strip_suffix', suffix: '-max' };
  if (type === 'set_payload') return { type, path: 'reasoning_effort', value: 'high', mode: 'default' };
  if (type === 'remove_payload') return { type, path: 'reasoning_effort' };
  if (type === 'set_header') return { type, name: 'x-metapi-route', value: 'manual', mode: 'override' };
  if (type === 'remove_header') return { type, name: 'x-metapi-route' };
  return { type, endpoint: 'responses' };
}

function parseJsonField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyJsonInput(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

type FilterOperationTemplate = {
  type: RouteFilter['type'];
  title: string;
  description: string;
  stage: 'pre_selection' | 'post_build';
  icon: ReactNode;
};

const FILTER_OPERATION_TEMPLATES: FilterOperationTemplate[] = [
  {
    type: 'rewrite_model',
    title: tr('pages.tokenRoutes.nodeForm.filterRewriteModel'),
    description: tr('pages.tokenRoutes.nodeForm.filterRewriteModelDescription'),
    stage: 'pre_selection',
    icon: <GitBranch className="size-3.5" />,
  },
  {
    type: 'set_payload',
    title: tr('pages.tokenRoutes.nodeForm.filterSetPayload'),
    description: tr('pages.tokenRoutes.nodeForm.filterSetPayloadDescription'),
    stage: 'post_build',
    icon: <Braces className="size-3.5" />,
  },
  {
    type: 'remove_payload',
    title: tr('pages.tokenRoutes.nodeForm.filterRemovePayload'),
    description: tr('pages.tokenRoutes.nodeForm.filterRemovePayloadDescription'),
    stage: 'post_build',
    icon: <Trash2 className="size-3.5" />,
  },
  {
    type: 'set_header',
    title: tr('pages.tokenRoutes.nodeForm.filterSetHeader'),
    description: tr('pages.tokenRoutes.nodeForm.filterSetHeaderDescription'),
    stage: 'post_build',
    icon: <Heading className="size-3.5" />,
  },
  {
    type: 'remove_header',
    title: tr('pages.tokenRoutes.nodeForm.filterRemoveHeader'),
    description: tr('pages.tokenRoutes.nodeForm.filterRemoveHeaderDescription'),
    stage: 'post_build',
    icon: <Trash2 className="size-3.5" />,
  },
  {
    type: 'set_endpoint_preference',
    title: tr('pages.tokenRoutes.nodeForm.filterEndpointPreference'),
    description: tr('pages.tokenRoutes.nodeForm.filterEndpointPreferenceDescription'),
    stage: 'post_build',
    icon: <Wand2 className="size-3.5" />,
  },
];

function getFilterOperationTemplate(type: RouteFilter['type']): FilterOperationTemplate {
  return FILTER_OPERATION_TEMPLATES.find((item) => item.type === type) || FILTER_OPERATION_TEMPLATES[1]!;
}

function getFilterOperationStage(operation: RouteFilter): 'pre_selection' | 'post_build' {
  return operation.type === 'rewrite_model' ? 'pre_selection' : 'post_build';
}

function getFilterOperationSummary(operation: RouteFilter): string {
  if (operation.type === 'rewrite_model') {
    const source = operation.source === 'upstream_model'
      ? tr('pages.tokenRoutes.nodeForm.upstreamModel')
      : tr('pages.tokenRoutes.nodeForm.currentModel');
    if (operation.operation === 'set') {
      return tr('pages.tokenRoutes.nodeForm.filterSummarySetModel')
        .replace('{source}', source)
        .replace('{value}', String(operation.value || '-'));
    }
    return tr('pages.tokenRoutes.nodeForm.filterSummaryStripSuffix')
      .replace('{source}', source)
      .replace('{suffix}', String(operation.suffix || '-'));
  }
  if (operation.type === 'set_payload') {
    return tr('pages.tokenRoutes.nodeForm.filterSummarySetPayload')
      .replace('{path}', operation.path || '-')
      .replace('{mode}', operation.mode || 'default');
  }
  if (operation.type === 'remove_payload') {
    return tr('pages.tokenRoutes.nodeForm.filterSummaryRemovePayload')
      .replace('{path}', operation.path || '-');
  }
  if (operation.type === 'set_header') {
    return tr('pages.tokenRoutes.nodeForm.filterSummarySetHeader')
      .replace('{name}', operation.name || '-')
      .replace('{mode}', operation.mode || 'default');
  }
  if (operation.type === 'remove_header') {
    return tr('pages.tokenRoutes.nodeForm.filterSummaryRemoveHeader')
      .replace('{name}', operation.name || '-');
  }
  return tr('pages.tokenRoutes.nodeForm.filterSummaryEndpointPreference')
    .replace('{endpoint}', operation.endpoint || '-');
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DispatcherEditor({ readonly, node, onChange }: NodeEditorProps) {
  const mode = node.mode === 'flow' ? 'flow' : 'route';
  const policy = (node.policy && typeof node.policy === 'object' ? node.policy : { strategy: 'weighted' }) as Record<string, unknown>;
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('pages.tokenRoutes.nodeForm.bidirectDispatch')}</div>
      <label>
        {tr('pages.tokenRoutes.nodeForm.mode')}
        <SelectField
          disabled={readonly}
          value={mode}
          options={[
            { value: 'route', label: 'route' },
            { value: 'flow', label: 'flow' },
          ]}
          onChange={(nextMode) => onChange({ mode: nextMode })}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.ordering')}
        <SelectField
          disabled={readonly}
          value={String(node.ordering || 'explicit')}
          options={[{ value: 'explicit', label: 'explicit' }]}
          onChange={(ordering) => onChange({ ordering })}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.strategy')}
        <SelectField
          disabled={readonly}
          value={String(policy.strategy || 'weighted')}
          options={[
            { value: 'priority_order', label: 'priority_order' },
            { value: 'weighted', label: 'weighted' },
            { value: 'round_robin', label: 'round_robin' },
            { value: 'stable_first', label: 'stable_first' },
            { value: 'direct', label: 'direct' },
          ]}
          onChange={(strategy) => onChange({ policy: { ...policy, strategy } })}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.policyJson')}
        <JsonCodeEditor disabled={readonly} value={stringifyJsonInput(node.policy || {})} minHeight={180} onChange={(value) => {
          try { onChange({ policy: JSON.parse(value) }); } catch { onChange({ policy: value }); }
        }} />
      </label>
    </div>
  );
}

function RouteEndpointEditor({ readonly, node, onChange }: NodeEditorProps) {
  const config = (node.config && typeof node.config === 'object' ? node.config : { targets: [{ targetId: node.id, model: node.id }], targetSelection: { strategy: 'weighted' } }) as Record<string, unknown>;
  const metadata = (node.metadata && typeof node.metadata === 'object' ? node.metadata : {}) as Record<string, unknown>;
  const targetSelection = (config.targetSelection && typeof config.targetSelection === 'object' ? config.targetSelection : { strategy: 'weighted' }) as Record<string, unknown>;
  const policyForm = policyFormFromStoredValue(config.compatibilityPolicy);
  const updateCompatibilityPolicy = (nextForm: ReturnType<typeof policyFormFromStoredValue>) => {
    const serialized = serializeCompatibilityPolicyForm(nextForm);
    if (!serialized.ok) return;
    onChange({ config: { ...config, compatibilityPolicy: serialized.policy } });
  };
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('pages.tokenRoutes.nodeForm.routeEndpoint')}</div>
      <label>
        {tr('pages.tokenRoutes.nodeForm.targetSelection')}
        <SelectField
          disabled={readonly}
          value={String(targetSelection.strategy || 'weighted')}
          options={[
            { value: 'defer_to_router', label: 'defer_to_router' },
            { value: 'priority_order', label: 'priority_order' },
            { value: 'weighted', label: 'weighted' },
            { value: 'round_robin', label: 'round_robin' },
            { value: 'stable_first', label: 'stable_first' },
            { value: 'direct', label: 'direct' },
          ]}
          onChange={(strategy) => onChange({ config: { ...config, targetSelection: { ...targetSelection, strategy } } })}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.nodeForm.metadataJson')}
        <JsonCodeEditor disabled={readonly} value={stringifyJsonInput(metadata)} minHeight={180} onChange={(value) => {
          try { onChange({ metadata: JSON.parse(value) }); } catch { onChange({ metadata: value }); }
        }} />
      </label>
      <UpstreamCompatibilityPolicyEditor
        compact
        disabled={readonly}
        value={policyForm}
        inheritFrom={tr('upstreamCompatibility.inheritSource.routeEndpointChain')}
        onChange={updateCompatibilityPolicy}
      />
      <label>
        {tr('pages.tokenRoutes.nodeForm.configJson')}
        <JsonCodeEditor disabled={readonly} value={stringifyJsonInput(config)} minHeight={220} onChange={(value) => {
          try { onChange({ config: JSON.parse(value) }); } catch { onChange({ config: value }); }
        }} />
      </label>
    </div>
  );
}

export function FilterOperationsEditor({
  readonly,
  operations,
  onChange,
}: {
  readonly: boolean;
  operations: RouteFilter[];
  onChange: (operations: RouteFilter[]) => void;
}) {
  const updateOperation = (index: number, operation: RouteFilter) => {
    onChange(operations.map((item, itemIndex) => (itemIndex === index ? operation : item)));
  };
  const addOperation = (type: RouteFilter['type']) => onChange([...operations, defaultOperation(type)]);
  return (
    <div className="grid gap-3 min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="route-graph-config-title">{tr('pages.tokenRoutes.nodeForm.requestFilterRules')}</div>
          <div className="route-graph-config-description mt-0.5">
            {tr('pages.tokenRoutes.nodeForm.requestFilterRulesDescription')}
          </div>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={readonly}>
              <Plus className="size-4" />
              {tr('pages.tokenRoutes.nodeForm.addFilter')}
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" className="w-80">
            <DropdownMenu.Label>{tr('pages.tokenRoutes.nodeForm.preSelectionStage')}</DropdownMenu.Label>
            {FILTER_OPERATION_TEMPLATES.filter((item) => item.stage === 'pre_selection').map((item) => (
              <DropdownMenu.Item key={item.type} onSelect={() => addOperation(item.type)} className="items-start gap-2">
                <span className="mt-0.5 text-muted-foreground">{item.icon}</span>
                <span className="grid gap-0.5">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator />
            <DropdownMenu.Label>{tr('pages.tokenRoutes.nodeForm.postBuildStage')}</DropdownMenu.Label>
            {FILTER_OPERATION_TEMPLATES.filter((item) => item.stage === 'post_build').map((item) => (
              <DropdownMenu.Item key={item.type} onSelect={() => addOperation(item.type)} className="items-start gap-2">
                <span className="mt-0.5 text-muted-foreground">{item.icon}</span>
                <span className="grid gap-0.5">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {operations.length === 0 ? (
        <div className="grid gap-2 rounded-md border border-dashed bg-muted/20 p-4 text-xs">
          <div className="font-medium text-foreground">{tr('pages.tokenRoutes.nodeForm.noFiltersConfigured')}</div>
          <div className="leading-relaxed text-muted-foreground">
            {tr('pages.tokenRoutes.nodeForm.noFiltersConfiguredDescription')}
          </div>
        </div>
      ) : null}

      {operations.map((operation, index) => {
        const template = getFilterOperationTemplate(operation.type);
        const stage = getFilterOperationStage(operation);
        return (
        <div key={`${operation.type}-${index}`} className="grid min-w-0 gap-3 rounded-md border bg-card p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 gap-2">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                {template.icon}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-foreground">{template.title}</span>
                  <Badge variant="outline" className="shrink-0">
                    {stage === 'pre_selection' ? tr('pages.tokenRoutes.nodeForm.preSelectionStageShort') : tr('pages.tokenRoutes.nodeForm.postBuildStageShort')}
                  </Badge>
                </div>
                <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                  {getFilterOperationSummary(operation)}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              disabled={readonly}
              aria-label={tr('pages.tokenRoutes.nodeForm.removeOperation')}
              onClick={() => onChange(operations.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FilterField label={tr('pages.tokenRoutes.nodeForm.type')}>
              <SelectField
                disabled={readonly}
                value={operation.type}
                options={FILTER_OPERATION_TEMPLATES.map((item) => ({ value: item.type, label: item.title }))}
                onChange={(type) => updateOperation(index, defaultOperation(type))}
              />
            </FilterField>
          {operation.type === 'rewrite_model' && (
            <>
              <FilterField label={tr('pages.tokenRoutes.nodeForm.source')}>
                <SelectField
                  disabled={readonly}
                  value={operation.source}
                  options={[
                    { value: 'current_model', label: tr('pages.tokenRoutes.nodeForm.currentModel') },
                    { value: 'upstream_model', label: tr('pages.tokenRoutes.nodeForm.upstreamModel') },
                  ]}
                  onChange={(source) => updateOperation(index, { ...operation, source })}
                />
              </FilterField>
              <FilterField label={tr('pages.tokenRoutes.nodeForm.operation')}>
                <SelectField
                  disabled={readonly}
                  value={operation.operation}
                  options={[
                    { value: 'strip_suffix', label: tr('pages.tokenRoutes.nodeForm.stripSuffix') },
                    { value: 'set', label: tr('pages.tokenRoutes.nodeForm.setModel') },
                  ]}
                  onChange={(operationValue) => updateOperation(index, { ...operation, operation: operationValue })}
                />
              </FilterField>
              <FilterField label={operation.operation === 'set' ? tr('pages.tokenRoutes.nodeForm.modelValue') : tr('pages.tokenRoutes.nodeForm.suffix')}>
                <Input disabled={readonly} value={operation.operation === 'set' ? String(operation.value || '') : String(operation.suffix || '')} onChange={(event) => updateOperation(index, operation.operation === 'set' ? { ...operation, value: event.target.value } : { ...operation, suffix: event.target.value })} />
              </FilterField>
            </>
          )}
          {(operation.type === 'set_payload' || operation.type === 'remove_payload') && (
            <>
              <FilterField label={tr('pages.tokenRoutes.nodeForm.payloadPath')}>
                <Input disabled={readonly} value={operation.path} onChange={(event) => updateOperation(index, { ...operation, path: event.target.value } as RouteFilter)} />
              </FilterField>
              {operation.type === 'set_payload' && (
                <>
                  <FilterField label={tr('pages.tokenRoutes.nodeForm.mode')}>
                    <SelectField
                      disabled={readonly}
                      value={operation.mode || 'default'}
                      options={[
                        { value: 'default', label: tr('pages.tokenRoutes.nodeForm.defaultMode') },
                        { value: 'override', label: tr('pages.tokenRoutes.nodeForm.overrideMode') },
                      ]}
                      onChange={(mode) => updateOperation(index, { ...operation, mode })}
                    />
                  </FilterField>
                  <FilterField label={tr('pages.tokenRoutes.nodeForm.valueJson')}>
                    <Input disabled={readonly} value={typeof operation.value === 'string' ? operation.value : JSON.stringify(operation.value)} onChange={(event) => updateOperation(index, { ...operation, value: parseJsonField(event.target.value) })} />
                  </FilterField>
                </>
              )}
            </>
          )}
          {(operation.type === 'set_header' || operation.type === 'remove_header') && (
            <>
              <FilterField label={tr('pages.tokenRoutes.nodeForm.headerName')}>
                <Input disabled={readonly} value={operation.name} onChange={(event) => updateOperation(index, { ...operation, name: event.target.value } as RouteFilter)} />
              </FilterField>
              {operation.type === 'set_header' && (
                <FilterField label={tr('pages.tokenRoutes.nodeForm.headerValue')}>
                  <Input disabled={readonly} value={operation.value} onChange={(event) => updateOperation(index, { ...operation, value: event.target.value })} />
                </FilterField>
              )}
            </>
          )}
          {operation.type === 'set_endpoint_preference' && (
            <FilterField label={tr('pages.tokenRoutes.nodeForm.endpoint')}>
              <SelectField
                disabled={readonly}
                value={operation.endpoint}
                options={[
                  { value: 'responses', label: 'responses' },
                  { value: 'chat', label: 'chat' },
                  { value: 'messages', label: 'messages' },
                ]}
                onChange={(endpoint) => updateOperation(index, { ...operation, endpoint })}
              />
            </FilterField>
          )}
          </div>
        </div>
      );})}
    </div>
  );
}
