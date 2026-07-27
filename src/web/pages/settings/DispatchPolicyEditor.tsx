import { useMemo, useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { api, type DispatchPolicyDefinitionPayload, type DispatchPolicyRegistryPayload } from '../../api.js';
import { tr } from '../../i18n.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table/index.js';
import ModernSelect from '../../components/ModernSelect.js';

const modes = ['weighted', 'ordered', 'round_robin', 'direct'] as const;
const builtinModes = ['weighted', 'round_robin', 'stable_first'] as const;
const exampleOptions = [
  { id: 'option-a', label: 'Option A', runtime: { routingSignals: { normalizedCostScore: 0.3, normalizedBalanceScore: 0.8, normalizedUsageScore: 0.6 } } },
  { id: 'option-b', label: 'Option B', runtime: { routingSignals: { normalizedCostScore: 0.8, normalizedBalanceScore: 0.3, normalizedUsageScore: 0.5 } } },
];

function emptyPolicy(index: number): DispatchPolicyDefinitionPayload {
  return { id: `policy-${index}`, name: '', kind: 'cel', selectionMode: 'weighted', contributionExpression: '1.0' };
}

export default function DispatchPolicyEditor({ value, onChange, disabled = false }: { value: DispatchPolicyRegistryPayload; onChange: (value: DispatchPolicyRegistryPayload) => void; disabled?: boolean }) {
  const [selectedId, setSelectedId] = useState(value.defaultPolicyId);
  const [errors, setErrors] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<any>(null);
  const [model, setModel] = useState('');
  const [simulationScopes, setSimulationScopes] = useState<Array<{ selectorId: string; mode: string; optionCount: number }>>([]);
  const [selectorId, setSelectorId] = useState('');
  const policy = useMemo(() => value.policies.find((item) => item.id === selectedId) || value.policies[0] || null, [selectedId, value]);
  const update = (patch: Partial<DispatchPolicyDefinitionPayload>) => {
    if (!policy) return;
    onChange({ ...value, policies: value.policies.map((item) => item.id === policy.id ? { ...item, ...patch } : item) });
  };
  const validate = async () => {
    if (!policy) return;
    try { const result = await api.validateDispatchPolicy(policy); setErrors(result.errors || []); } catch (error: any) { setErrors([error?.message || tr('pages.settings.dispatchPolicyValidationFailed')]); }
  };
  const simulate = async () => {
    if (!policy) return;
    try {
      if (model.trim()) {
        let selectedSelectorId = selectorId;
        if (!selectedSelectorId) {
          const inspected = await api.simulateDispatchPolicy({ mode: 'compiled_runtime', inspectOnly: true, policy: { kind: 'inline', policy }, model: model.trim() });
          const scopes = inspected.scopes || [];
          setSimulationScopes(scopes);
          if (scopes.length !== 1) {
            setSimulation(null);
            setErrors(scopes.length === 0 ? [tr('pages.settings.dispatchPolicyNoScopes')] : []);
            return;
          }
          selectedSelectorId = scopes[0]!.selectorId;
          setSelectorId(selectedSelectorId);
        }
        const result = await api.simulateDispatchPolicy({ mode: 'compiled_runtime', policy: { kind: 'inline', policy }, model: model.trim(), selectorId: selectedSelectorId });
        setSimulation(result.simulation || null);
      } else {
        const result = await api.simulateDispatchPolicy({ mode: 'synthetic', policy: { kind: 'inline', policy }, options: exampleOptions });
        setSimulation(result.simulation || null);
      }
      setErrors([]);
    } catch (error: any) { setErrors([error?.message || tr('pages.settings.dispatchPolicySimulationFailed')]); }
  };
  if (!policy) return null;

  const removeSelectedPolicy = () => {
    const policies = value.policies.filter((item) => item.id !== policy.id);
    onChange({
      defaultPolicyId: value.defaultPolicyId === policy.id ? policies[0]!.id : value.defaultPolicyId,
      policies,
    });
    setSelectedId(policies[0]!.id);
  };

  return (
    <div className="grid gap-4">
      <section className="border-b pb-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">{tr('pages.settings.dispatchPolicyDefault')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{tr('pages.settings.dispatchPolicyDefaultHint')}</p>
        </div>
        <div className="max-w-sm">
          <ModernSelect
            value={value.defaultPolicyId}
            onChange={(defaultPolicyId) => onChange({ ...value, defaultPolicyId })}
            options={value.policies.map((item) => ({ value: item.id, label: item.name || item.id }))}
            placeholder={tr('pages.settings.dispatchPolicyDefault')}
            disabled={disabled}
          />
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="grid content-start gap-2">
          <div className="text-xs font-medium text-muted-foreground">{tr('pages.settings.dispatchPolicyLibrary')}</div>
          {value.policies.map((item) => {
            const selected = item.id === selectedId;
            return (
              <Button
                key={item.id}
                type="button"
                variant={selected ? 'outline' : 'ghost'}
                aria-pressed={selected}
                className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="grid w-full gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name || item.id}</span>
                    {item.id === value.defaultPolicyId ? (
                      <span className="text-xs text-primary">{tr('pages.settings.dispatchPolicyDefaultTag')}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.selectionMode}</span>
                </span>
              </Button>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const next = emptyPolicy(value.policies.length + 1);
              onChange({ defaultPolicyId: value.defaultPolicyId, policies: [...value.policies, next] });
              setSelectedId(next.id);
            }}
          >
            <Plus className="size-4" />
            {tr('pages.settings.dispatchPolicyAdd')}
          </Button>
        </aside>

        <div className="grid gap-3 rounded-md border p-3">
          <div>
            <h3 className="text-sm font-semibold">{tr('pages.settings.dispatchPolicyEditor')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{tr('pages.settings.dispatchPolicyEditorHint')}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              disabled={disabled}
              value={policy.name}
              placeholder={tr('pages.settings.dispatchPolicyName')}
              onChange={(event) => update({ name: event.target.value })}
            />
            <Input
              disabled={disabled}
              value={policy.id}
              placeholder={tr('pages.settings.dispatchPolicyId')}
              onChange={(event) => update({ id: event.target.value })}
            />
          </div>

          <div className={`grid gap-3 ${policy.kind === 'builtin' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>{tr('pages.settings.dispatchPolicyKind')}</span>
              <ModernSelect
                value={policy.kind}
                onChange={(kind) => update({ kind: kind as DispatchPolicyDefinitionPayload['kind'] })}
                options={[
                  { value: 'cel', label: tr('pages.settings.dispatchPolicyKindCel') },
                  { value: 'builtin', label: tr('pages.settings.dispatchPolicyKindBuiltin') },
                ]}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>{tr('pages.settings.dispatchPolicyMode')}</span>
              <ModernSelect
                value={policy.selectionMode}
                onChange={(selectionMode) => update({ selectionMode: selectionMode as DispatchPolicyDefinitionPayload['selectionMode'] })}
                options={modes.map((mode) => ({ value: mode, label: tr(`pages.settings.dispatchPolicyMode.${mode}`) }))}
                disabled={disabled}
              />
            </label>
            {policy.kind === 'builtin' ? (
              <label className="grid gap-1.5 text-sm font-medium">
                <span>{tr('pages.settings.dispatchPolicyBuiltin')}</span>
                <ModernSelect
                  value={policy.builtin || 'weighted'}
                  onChange={(builtin) => update({ builtin: builtin as DispatchPolicyDefinitionPayload['builtin'] })}
                  options={builtinModes.map((builtin) => ({ value: builtin, label: tr(`pages.settings.dispatchPolicyBuiltin.${builtin}`) }))}
                  disabled={disabled}
                />
              </label>
            ) : null}
          </div>

          {policy.kind === 'cel' ? (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">{tr('pages.settings.dispatchPolicyVariables')}</div>
                <code className="block break-all">runtime.routingSignals.normalizedCostScore</code>
                <code className="block break-all">runtime.routingSignals.normalizedBalanceScore</code>
                <code className="block break-all">runtime.routingSignals.normalizedUsageScore</code>
                <code className="block break-all">request.payload · request.headers · selection.runtime · endpoint.runtime · executionAttempt.runtime · plan.runtime</code>
              </div>
              <Textarea
                disabled={disabled}
                value={policy.eligibilityExpression || ''}
                placeholder={tr('pages.settings.dispatchPolicyEligibility')}
                onChange={(event) => update({ eligibilityExpression: event.target.value || undefined })}
              />
              {policy.selectionMode === 'weighted' ? (
                <Textarea
                  disabled={disabled}
                  value={policy.contributionExpression || ''}
                  placeholder={tr('pages.settings.dispatchPolicyContribution')}
                  onChange={(event) => update({ contributionExpression: event.target.value || undefined })}
                />
              ) : null}
              {policy.selectionMode === 'ordered' ? (
                <Textarea
                  disabled={disabled}
                  value={policy.orderExpression || ''}
                  placeholder={tr('pages.settings.dispatchPolicyOrder')}
                  onChange={(event) => update({ orderExpression: event.target.value || undefined })}
                />
              ) : null}
              {policy.selectionMode === 'direct' ? (
                <Textarea
                  disabled={disabled}
                  value={policy.selectExpression || ''}
                  placeholder={tr('pages.settings.dispatchPolicyDirect')}
                  onChange={(event) => update({ selectExpression: event.target.value || undefined })}
                />
              ) : null}
            </>
          ) : null}

          <div className="border-t pt-3">
            <div className="mb-2 text-sm font-medium">{tr('pages.settings.dispatchPolicyCheck')}</div>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-56 flex-1"
                value={model}
                placeholder={tr('pages.settings.dispatchPolicyModel')}
                onChange={(event) => {
                  setModel(event.target.value);
                  setSimulationScopes([]);
                  setSelectorId('');
                  setSimulation(null);
                }}
              />
              {simulationScopes.length > 1 ? (
                <ModernSelect
                  value={selectorId}
                  onChange={setSelectorId}
                  options={simulationScopes.map((scope) => ({
                    value: scope.selectorId,
                    label: `${scope.mode} · ${scope.optionCount}`,
                  }))}
                />
              ) : null}
              <Button type="button" variant="outline" onClick={validate}>
                {tr('pages.settings.dispatchPolicyValidate')}
              </Button>
              <Button type="button" variant="outline" onClick={simulate}>
                <Play className="size-4" />
                {tr('pages.settings.dispatchPolicySimulate')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || value.policies.length < 2}
                onClick={removeSelectedPolicy}
              >
                <Trash2 className="size-4" />
                {tr('pages.settings.dispatchPolicyRemove')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {model.trim() ? tr('pages.settings.dispatchPolicyModelHint') : tr('pages.settings.dispatchPolicyExampleHint')}
            </p>
          </div>

          {errors.length > 0 ? <div className="text-sm text-destructive">{errors.join(' ')}</div> : null}

          {simulation ? (
            <div className="overflow-x-auto border-t pt-3">
              <div className="mb-2 text-sm font-medium">{tr('pages.settings.dispatchPolicySimulationResult')}</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('pages.settings.dispatchPolicyOption')}</TableHead>
                    <TableHead className="text-center">{tr('pages.settings.dispatchPolicyEligible')}</TableHead>
                    <TableHead className="text-center">{tr('pages.settings.dispatchPolicyContribution')}</TableHead>
                    <TableHead className="text-center">{tr('pages.settings.dispatchPolicyProbability')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simulation.options.map((item: any) => (
                    <TableRow key={item.id} className={item.id === simulation.selectedOptionId ? 'bg-primary/5' : ''}>
                      <TableCell>{item.label}</TableCell>
                      <TableCell className="text-center">{item.eligible ? tr('pages.settings.yes') : tr('pages.settings.no')}</TableCell>
                      <TableCell className="text-center">{item.contribution}</TableCell>
                      <TableCell className="text-center">
                        {item.probability == null ? '-' : `${(item.probability * 100).toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
