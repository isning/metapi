import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { CircleDollarSign, Coins, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  api,
  type FxRateSnapshot,
  type FxRateSnapshotPayload,
  type PlatformPricingConfig,
} from '../../api.js';
import { useToast } from '../../components/Toast.js';
import ToneBadge from '../../components/ToneBadge.js';
import { tr } from '../../i18n.js';
import { Alert, AlertDescription } from '../../components/ui/alert/index.js';
import { Button } from '../../components/ui/button/index.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle } from '../../components/ui/empty/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Label } from '../../components/ui/label/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import { SettingsCard, SettingsToggleRow } from './SettingsLayout.js';

type FxForm = {
  id: number | null;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: FxRateSnapshot['source'];
  capturedAt: string;
  notes: string;
};

const EMPTY_FX_FORM: FxForm = {
  id: null,
  fromCurrency: 'USD',
  toCurrency: 'USD',
  rate: '1',
  source: 'manual',
  capturedAt: '',
  notes: '',
};

function updatePlatformConfigState(
  current: PlatformPricingConfig | null,
  patch: Partial<PlatformPricingConfig>,
): PlatformPricingConfig | null {
  if (!current) return current;
  return {
    ...current,
    ...patch,
    upstreamDefaultPricing: patch.upstreamDefaultPricing
      ? { ...current.upstreamDefaultPricing, ...patch.upstreamDefaultPricing }
      : current.upstreamDefaultPricing,
    walletDefaultValuation: patch.walletDefaultValuation
      ? { ...current.walletDefaultValuation, ...patch.walletDefaultValuation }
      : current.walletDefaultValuation,
    driftCheck: patch.driftCheck ? { ...current.driftCheck, ...patch.driftCheck } : current.driftCheck,
  };
}

function numberOrNull(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function requiredNumber(value: string, label: string): number {
  const numeric = numberOrNull(value);
  if (numeric == null || numeric <= 0) throw new Error(`${label} must be a positive number.`);
  return numeric;
}

function fxPayloadFromForm(form: FxForm): FxRateSnapshotPayload {
  return {
    fromCurrency: form.fromCurrency.trim() || 'USD',
    toCurrency: form.toCurrency.trim() || 'USD',
    rate: requiredNumber(form.rate, 'rate'),
    source: form.source,
    capturedAt: form.capturedAt.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function fxFormFromRecord(record: FxRateSnapshot): FxForm {
  return {
    id: record.id,
    fromCurrency: record.fromCurrency,
    toCurrency: record.toCurrency,
    rate: String(record.rate),
    source: record.source,
    capturedAt: record.capturedAt,
    notes: record.notes || '',
  };
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(6).replace(/\.?0+$/, '');
}

function fxSourceText(value: FxRateSnapshot['source']): string {
  if (value === 'provider') return tr('upstreamCostPricing.costCatalog.fxSource.provider');
  if (value === 'system_default') return tr('upstreamCostPricing.costCatalog.fxSource.systemDefault');
  return tr('upstreamCostPricing.costCatalog.fxSource.manual');
}

function currencyPair(record: FxRateSnapshot): string {
  return `${record.fromCurrency} -> ${record.toCurrency}`;
}

function normalizeFxUnit(value: string): string {
  return value.trim().toUpperCase();
}

function canonicalizeFxFormPair(form: FxForm) {
  const fromCurrency = normalizeFxUnit(form.fromCurrency);
  const toCurrency = normalizeFxUnit(form.toCurrency);
  const rate = numberOrNull(form.rate);
  if (!fromCurrency || !toCurrency || rate == null || rate <= 0) {
    return {
      fromCurrency,
      toCurrency,
      rate,
      flipped: false,
    };
  }
  if (fromCurrency <= toCurrency) {
    return {
      fromCurrency,
      toCurrency,
      rate,
      flipped: false,
    };
  }
  return {
    fromCurrency: toCurrency,
    toCurrency: fromCurrency,
    rate: 1 / rate,
    flipped: true,
  };
}

function resolveFxRateFormError(form: FxForm, records: FxRateSnapshot[]): string | null {
  const { fromCurrency, toCurrency } = canonicalizeFxFormPair(form);
  if (!fromCurrency || !toCurrency) return null;
  if (fromCurrency === toCurrency) {
    return tr('upstreamCostPricing.costCatalog.fxValidation.sameUnit');
  }
  const duplicate = records.find((record) => (
    record.id !== form.id
    && normalizeFxUnit(record.fromCurrency) === fromCurrency
    && normalizeFxUnit(record.toCurrency) === toCurrency
  ));
  if (duplicate) {
    return tr('upstreamCostPricing.costCatalog.fxValidation.duplicatePair')
      .replace('{pair}', `${fromCurrency} -> ${toCurrency}`);
  }
  return null;
}

function resolveFxRateFormNotice(form: FxForm): string | null {
  const pair = canonicalizeFxFormPair(form);
  if (!pair.flipped || !pair.fromCurrency || !pair.toCurrency || pair.rate == null || pair.rate <= 0) return null;
  return tr('upstreamCostPricing.costCatalog.fxValidation.canonicalizedPair')
    .replace('{from}', pair.fromCurrency)
    .replace('{to}', pair.toCurrency)
    .replace('{rate}', formatCompactNumber(pair.rate));
}

export default function CostPolicySettingsSection() {
  const toast = useToast();
  const [platformConfig, setPlatformConfig] = useState<PlatformPricingConfig | null>(null);
  const [fxRates, setFxRates] = useState<FxRateSnapshot[]>([]);
  const [fxForm, setFxForm] = useState<FxForm>(EMPTY_FX_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPlatformConfig, nextFxRates] = await Promise.all([
        api.getPlatformPricingConfig(),
        api.listFxRateSnapshots(),
      ]);
      setPlatformConfig(nextPlatformConfig);
      setFxRates(nextFxRates);
    } catch (error: any) {
      toast.error(error?.message || tr('upstreamCostPricing.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSavePlatformConfig = async () => {
    if (!platformConfig) return;
    setSaving(true);
    try {
      const saved = await api.updatePlatformPricingConfig(platformConfig);
      setPlatformConfig(saved);
      toast.success(tr('upstreamCostPricing.costCatalog.platformConfigSaved'));
    } catch (error: any) {
      toast.error(error?.message || tr('upstreamCostPricing.costCatalog.platformConfigSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFxRate = async () => {
    setSaving(true);
    try {
      const payload = fxPayloadFromForm(fxForm);
      const saved = fxForm.id == null
        ? await api.createFxRateSnapshot(payload)
        : await api.updateFxRateSnapshot(fxForm.id, payload);
      setFxForm(fxFormFromRecord(saved));
      setFxRates(await api.listFxRateSnapshots());
      toast.success(tr('upstreamCostPricing.costCatalog.fxSaved'));
    } catch (error: any) {
      toast.error(error?.message || tr('upstreamCostPricing.costCatalog.fxSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFxRate = async (record: FxRateSnapshot) => {
    setSaving(true);
    try {
      await api.deleteFxRateSnapshot(record.id);
      setFxRates(await api.listFxRateSnapshots());
      if (fxForm.id === record.id) setFxForm(EMPTY_FX_FORM);
      toast.success(tr('upstreamCostPricing.costCatalog.fxDeleted'));
    } catch (error: any) {
      toast.error(error?.message || tr('upstreamCostPricing.costCatalog.fxDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      dataSettingsCard="cost-policy"
      title={tr('upstreamCostPricing.settings.title')}
      description={tr('upstreamCostPricing.settings.description')}
      actions={platformConfig ? <ToneBadge tone="-info">{platformConfig.baseCostUnit}</ToneBadge> : null}
      footer={platformConfig ? (
        <div className="flex w-full justify-end border-t pt-4">
          <Button type="button" onClick={() => void handleSavePlatformConfig()} disabled={saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tr('common.save')}
          </Button>
        </div>
      ) : null}
    >
      <PlatformPricingEditor
        config={platformConfig}
        loading={loading}
        onChange={(patch) => setPlatformConfig((current) => updatePlatformConfigState(current, patch))}
      />
      <FxRateEditor
        records={fxRates}
        form={fxForm}
        loading={loading}
        saving={saving}
        onChange={(patch) => setFxForm((current) => ({ ...current, ...patch }))}
        onNew={() => setFxForm(EMPTY_FX_FORM)}
        onSelect={(record) => setFxForm(fxFormFromRecord(record))}
        onSave={() => void handleSaveFxRate()}
        onDelete={(record) => void handleDeleteFxRate(record)}
      />
    </SettingsCard>
  );
}

function PlatformPricingEditor({
  config,
  loading,
  onChange,
}: {
  config: PlatformPricingConfig | null;
  loading: boolean;
  onChange: (patch: Partial<PlatformPricingConfig>) => void;
}) {
  if (loading && !config) {
    return (
      <div className="grid gap-3 rounded-md border p-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!config) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        {tr('upstreamCostPricing.costCatalog.upstreamDefaultUnavailable')}
      </div>
    );
  }

  const pricing = config.upstreamDefaultPricing;
  const walletDefault = config.walletDefaultValuation ?? {
    enabled: true,
    walletUnit: null,
    faceValuePrice: 1,
    rechargeDiscount: 1,
    confidence: 'estimated' as const,
  };
  const derivedRoutingFallbackUnitCost = Math.max(
    0.000001,
    pricing.inputPerMillion * 0.5 + pricing.outputPerMillion * 0.5 + (pricing.requestUsd ?? 0),
  );

  return (
    <div className="grid gap-3">
      <section className="grid gap-3 rounded-md border p-3" aria-label={tr('upstreamCostPricing.costCatalog.upstreamDefaultPricing')}>
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="size-4 text-muted-foreground" />
            {tr('upstreamCostPricing.costCatalog.upstreamDefaultPricing')}
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {tr('upstreamCostPricing.costCatalog.upstreamDefaultDescription')}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <NumberField
              label={tr('upstreamCostPricing.price.input')}
              value={pricing.inputPerMillion}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, inputPerMillion: value ?? 0 } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.price.output')}
              value={pricing.outputPerMillion}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, outputPerMillion: value ?? 0 } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.price.cacheRead')}
              value={pricing.cacheReadPerMillion}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, cacheReadPerMillion: value } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.price.cacheWrite')}
              value={pricing.cacheWritePerMillion}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, cacheWritePerMillion: value } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.price.reasoning')}
              value={pricing.reasoningPerMillion}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, reasoningPerMillion: value } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.price.requestFee')}
              value={pricing.requestUsd}
              onChange={(value) => onChange({ upstreamDefaultPricing: { ...pricing, requestUsd: value } })}
            />
          </div>

          <div className="grid content-start gap-3">
            <Field label={tr('upstreamCostPricing.costCatalog.baseCostUnit')}>
              <Input
                value={config.baseCostUnit}
                onChange={(event) => onChange({ baseCostUnit: event.target.value.toUpperCase() })}
              />
            </Field>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">{tr('upstreamCostPricing.costCatalog.routingFallbackUnitCost')}</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{formatCompactNumber(derivedRoutingFallbackUnitCost)}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {tr('upstreamCostPricing.costCatalog.routingFallbackUnitCostHelp')}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-md border p-3" aria-label={tr('upstreamCostPricing.costCatalog.walletDefaultValuation')}>
        <div className="grid gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CircleDollarSign className="size-4 text-muted-foreground" />
              {tr('upstreamCostPricing.costCatalog.walletDefaultValuation')}
              <ToneBadge tone={walletDefault.enabled ? '-info' : '-muted'}>
                {walletDefault.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
              </ToneBadge>
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {tr('upstreamCostPricing.costCatalog.walletDefaultValuationDescription')}
            </div>
          </div>
          <SettingsToggleRow
            control="switch"
            title={tr('upstreamCostPricing.costCatalog.walletDefaultValuationEnabled')}
            checked={walletDefault.enabled}
            onCheckedChange={(enabled) => onChange({ walletDefaultValuation: { ...walletDefault, enabled } })}
            className="bg-background p-3"
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Field label={tr('upstreamCostPricing.costCatalog.walletDefaultUnit')}>
            <Input
              value={walletDefault.walletUnit ?? ''}
              placeholder={config.baseCostUnit}
              onChange={(event) => onChange({
                walletDefaultValuation: {
                  ...walletDefault,
                  walletUnit: event.target.value.trim() ? event.target.value.toUpperCase() : null,
                },
              })}
            />
          </Field>
          <NumberField
            label={tr('upstreamCostPricing.costCatalog.walletDefaultFaceValuePrice')}
            value={walletDefault.faceValuePrice}
            onChange={(value) => onChange({ walletDefaultValuation: { ...walletDefault, faceValuePrice: value ?? 0 } })}
          />
          <NumberField
            label={tr('upstreamCostPricing.costCatalog.walletDefaultRechargeDiscount')}
            value={walletDefault.rechargeDiscount}
            onChange={(value) => onChange({ walletDefaultValuation: { ...walletDefault, rechargeDiscount: value ?? 0 } })}
          />
          <Field label={tr('upstreamCostPricing.costCatalog.walletDefaultConfidence')}>
            <Select
              value={walletDefault.confidence}
              onValueChange={(confidence) => onChange({
                walletDefaultValuation: {
                  ...walletDefault,
                  confidence: confidence as PlatformPricingConfig['walletDefaultValuation']['confidence'],
                },
              })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">{tr('upstreamCostPricing.costCatalog.walletConfidence.exact')}</SelectItem>
                <SelectItem value="estimated">{tr('upstreamCostPricing.costCatalog.walletConfidence.estimated')}</SelectItem>
                <SelectItem value="incomplete">{tr('upstreamCostPricing.costCatalog.walletConfidence.incomplete')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {tr('upstreamCostPricing.costCatalog.walletDefaultValuationHelp')}
        </div>
      </section>

      <section className="grid gap-3 rounded-md border p-3" aria-label={tr('upstreamCostPricing.costCatalog.driftCheck')}>
        <div className="grid gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <RefreshCw className="size-4 text-muted-foreground" />
              {tr('upstreamCostPricing.costCatalog.driftCheck')}
              <ToneBadge tone={config.driftCheck.enabled ? '-info' : '-muted'}>
                {config.driftCheck.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
              </ToneBadge>
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {tr('upstreamCostPricing.costCatalog.driftCheckDescription')}
            </div>
          </div>
          <SettingsToggleRow
            control="switch"
            title={tr('upstreamCostPricing.costCatalog.driftCheckEnabled')}
            checked={config.driftCheck.enabled}
            onCheckedChange={(enabled) => onChange({ driftCheck: { ...config.driftCheck, enabled } })}
            className="bg-background p-3"
          />
        </div>

        <div className="grid gap-3">
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {tr('upstreamCostPricing.costCatalog.driftCheckEnabledHelp')}
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <NumberField
              label={tr('upstreamCostPricing.costCatalog.driftWindowHours')}
              min={1}
              step={1}
              value={config.driftCheck.windowHours}
              onChange={(value) => onChange({ driftCheck: { ...config.driftCheck, windowHours: Math.max(1, Math.trunc(value ?? 1)) } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.costCatalog.driftMinSampleSize')}
              min={1}
              step={1}
              value={config.driftCheck.minSampleSize}
              onChange={(value) => onChange({ driftCheck: { ...config.driftCheck, minSampleSize: Math.max(1, Math.trunc(value ?? 1)) } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.costCatalog.driftRelativeTolerance')}
              value={config.driftCheck.relativeTolerance}
              onChange={(value) => onChange({ driftCheck: { ...config.driftCheck, relativeTolerance: value ?? 0 } })}
            />
            <NumberField
              label={tr('upstreamCostPricing.costCatalog.driftAbsoluteTolerance')}
              value={config.driftCheck.absoluteToleranceUsd}
              onChange={(value) => onChange({ driftCheck: { ...config.driftCheck, absoluteToleranceUsd: value ?? 0 } })}
            />
          </div>
        </div>
      </section>

    </div>
  );
}

function FxRateEditor({
  records,
  form,
  loading,
  saving,
  onChange,
  onNew,
  onSelect,
  onSave,
  onDelete,
}: {
  records: FxRateSnapshot[];
  form: FxForm;
  loading: boolean;
  saving: boolean;
  onChange: (patch: Partial<FxForm>) => void;
  onNew: () => void;
  onSelect: (record: FxRateSnapshot) => void;
  onSave: () => void;
  onDelete: (record: FxRateSnapshot) => void;
}) {
  const formError = resolveFxRateFormError(form, records);
  const formNotice = resolveFxRateFormNotice(form);

  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label={tr('upstreamCostPricing.costCatalog.fxRates')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CircleDollarSign className="size-4 text-muted-foreground" />
            {tr('upstreamCostPricing.costCatalog.fxRates')}
            <ToneBadge tone={records.length > 0 ? '-info' : '-muted'}>{String(records.length)}</ToneBadge>
          </div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {tr('upstreamCostPricing.costCatalog.fxEditorDescription')}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onNew} disabled={saving}>
          <Plus className="size-4" />
          {tr('common.new')}
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.6fr)]">
        <div className="grid gap-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Field label={tr('upstreamCostPricing.costCatalog.fxForm.from')}>
              <Input value={form.fromCurrency} onChange={(event) => onChange({ fromCurrency: event.target.value.toUpperCase() })} />
            </Field>
            <Field label={tr('upstreamCostPricing.costCatalog.fxForm.to')}>
              <Input value={form.toCurrency} onChange={(event) => onChange({ toCurrency: event.target.value.toUpperCase() })} />
            </Field>
            <Field label={tr('upstreamCostPricing.costCatalog.fxForm.rate')}>
              <Input value={form.rate} inputMode="decimal" onChange={(event) => onChange({ rate: event.target.value })} />
            </Field>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Field label={tr('upstreamCostPricing.costCatalog.fxForm.source')}>
              <Select value={form.source} onValueChange={(source) => onChange({ source: source as FxRateSnapshot['source'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">{tr('upstreamCostPricing.costCatalog.fxSource.manual')}</SelectItem>
                  <SelectItem value="provider">{tr('upstreamCostPricing.costCatalog.fxSource.provider')}</SelectItem>
                  <SelectItem value="system_default">{tr('upstreamCostPricing.costCatalog.fxSource.systemDefault')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={tr('upstreamCostPricing.costCatalog.fxForm.capturedAt')}>
              <Input value={form.capturedAt} placeholder="2026-06-24T00:00:00.000Z" onChange={(event) => onChange({ capturedAt: event.target.value })} />
            </Field>
          </div>
          <Field label={tr('upstreamCostPricing.notes')}>
            <Textarea value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} />
          </Field>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {!formError && formNotice ? (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {formNotice}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" onClick={onSave} disabled={saving || !!formError}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {form.id == null ? tr('upstreamCostPricing.costCatalog.createFxRate') : tr('common.save')}
            </Button>
          </div>
        </div>

        <div className="grid min-h-full overflow-hidden rounded-md border">
          {loading ? (
            <div className="grid gap-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : records.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('upstreamCostPricing.costCatalog.currencyPairScope')}</TableHead>
                  <TableHead>{tr('upstreamCostPricing.costCatalog.fxForm.rate')}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id} className="cursor-pointer" onClick={() => onSelect(record)}>
                    <TableCell>
                      <div className="font-medium">{currencyPair(record)}</div>
                      <div className="text-xs text-muted-foreground">{fxSourceText(record.source)}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{record.rate}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghostDestructive"
                        size="icon"
                        aria-label={tr('upstreamCostPricing.costCatalog.deleteFxRate')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(record);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty className="h-full min-h-80">
              <EmptyHeader>
                <EmptyIcon>
                  <CircleDollarSign className="size-5" />
                </EmptyIcon>
                <EmptyTitle>{tr('upstreamCostPricing.costCatalog.noFxRates')}</EmptyTitle>
                <EmptyDescription className="max-w-sm">
                  {tr('upstreamCostPricing.costCatalog.noFxRatesDescription')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min = 0,
  step = 0.000001,
  onChange,
}: {
  label: string;
  value: number | null;
  min?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        onChange={(event) => {
          const next = numberOrNull(event.target.value);
          onChange(next == null ? null : Math.max(min, next));
        }}
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </Label>
  );
}
