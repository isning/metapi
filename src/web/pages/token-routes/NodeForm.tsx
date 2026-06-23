import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
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

function FilterOperationsEditor({
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
  return (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('pages.tokenRoutes.nodeForm.operations')}</div>
      {operations.map((operation, index) => (
        <div key={`${operation.type}-${index}`} className="grid gap-3 rounded-lg border p-3">
          <label>
            {tr('pages.tokenRoutes.nodeForm.type')}
            <SelectField
              disabled={readonly}
              value={operation.type}
              options={[
                { value: 'rewrite_model', label: 'rewrite_model' },
                { value: 'set_payload', label: 'set_payload' },
                { value: 'remove_payload', label: 'remove_payload' },
                { value: 'set_header', label: 'set_header' },
                { value: 'remove_header', label: 'remove_header' },
                { value: 'set_endpoint_preference', label: 'set_endpoint_preference' },
              ]}
              onChange={(type) => updateOperation(index, defaultOperation(type))}
            />
          </label>
          {operation.type === 'rewrite_model' && (
            <>
              <label>
                {tr('pages.tokenRoutes.nodeForm.source')}
                <SelectField
                  disabled={readonly}
                  value={operation.source}
                  options={[
                    { value: 'current_model', label: 'current_model' },
                    { value: 'upstream_model', label: 'upstream_model' },
                  ]}
                  onChange={(source) => updateOperation(index, { ...operation, source })}
                />
              </label>
              <label>
                {tr('pages.tokenRoutes.nodeForm.operation')}
                <SelectField
                  disabled={readonly}
                  value={operation.operation}
                  options={[
                    { value: 'strip_suffix', label: 'strip_suffix' },
                    { value: 'set', label: 'set' },
                  ]}
                  onChange={(operationValue) => updateOperation(index, { ...operation, operation: operationValue })}
                />
              </label>
              <label>
                {tr('pages.tokenRoutes.nodeForm.valueOrSuffix')}
                <Input disabled={readonly} value={operation.operation === 'set' ? String(operation.value || '') : String(operation.suffix || '')} onChange={(event) => updateOperation(index, operation.operation === 'set' ? { ...operation, value: event.target.value } : { ...operation, suffix: event.target.value })} />
              </label>
            </>
          )}
          {(operation.type === 'set_payload' || operation.type === 'remove_payload') && (
            <>
              <label>
                {tr('pages.tokenRoutes.nodeForm.payloadPath')}
                <Input disabled={readonly} value={operation.path} onChange={(event) => updateOperation(index, { ...operation, path: event.target.value } as RouteFilter)} />
              </label>
              {operation.type === 'set_payload' && (
                <>
                  <label>
                    {tr('pages.tokenRoutes.nodeForm.mode')}
                    <SelectField
                      disabled={readonly}
                      value={operation.mode || 'default'}
                      options={[
                        { value: 'default', label: 'default' },
                        { value: 'override', label: 'override' },
                      ]}
                      onChange={(mode) => updateOperation(index, { ...operation, mode })}
                    />
                  </label>
                  <label>
                    {tr('pages.tokenRoutes.nodeForm.valueJson')}
                    <Input disabled={readonly} value={typeof operation.value === 'string' ? operation.value : JSON.stringify(operation.value)} onChange={(event) => updateOperation(index, { ...operation, value: parseJsonField(event.target.value) })} />
                  </label>
                </>
              )}
            </>
          )}
          {(operation.type === 'set_header' || operation.type === 'remove_header') && (
            <>
              <label>
                {tr('pages.tokenRoutes.nodeForm.headerName')}
                <Input disabled={readonly} value={operation.name} onChange={(event) => updateOperation(index, { ...operation, name: event.target.value } as RouteFilter)} />
              </label>
              {operation.type === 'set_header' && (
                <label>
                  {tr('pages.tokenRoutes.nodeForm.headerValue')}
                  <Input disabled={readonly} value={operation.value} onChange={(event) => updateOperation(index, { ...operation, value: event.target.value })} />
                </label>
              )}
            </>
          )}
          {operation.type === 'set_endpoint_preference' && (
            <label>
              {tr('pages.tokenRoutes.nodeForm.endpoint')}
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
            </label>
          )}
          <Button variant="secondary" size="sm" type="button" disabled={readonly} onClick={() => onChange(operations.filter((_, itemIndex) => itemIndex !== index))}>{tr('pages.tokenRoutes.nodeForm.removeOperation')}</Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(['rewrite_model', 'set_payload', 'set_header', 'set_endpoint_preference'] as RouteFilter['type'][]).map((type) => (
          <Button key={type} variant="outline" size="sm" type="button" disabled={readonly} onClick={() => onChange([...operations, defaultOperation(type)])}>{type}</Button>
        ))}
      </div>
    </div>
  );
}
