import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Coins, LoaderCircle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api, type UpstreamCostPricingPayload, type UpstreamCostPricingRecord, type UpstreamCostPricingScope } from '../api.js';
import ToneBadge from './ToneBadge.js';
import { Button } from './ui/button/index.js';
import { ButtonGroup } from './ui/button-group/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card/index.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty/index.js';
import { Input } from './ui/input/index.js';
import { Label } from './ui/label/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select/index.js';
import { Separator } from './ui/separator/index.js';
import { Switch } from './ui/switch/index.js';

import { tr } from '../i18n.js';
type UpstreamTokenOption = {
  id: number;
  name: string;
  tokenGroup?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  valueStatus?: string | null;
};

type UpstreamCostPricingEditorProps = {
  open: boolean;
  siteId: number;
  accountId: number;
  modelName: string;
  siteName?: string | null;
  accountName?: string | null;
  tokens?: UpstreamTokenOption[];
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  toast?: {
    success?: (message: string) => void;
    error?: (message: string) => void;
    info?: (message: string) => void;
  };
};

type SimplePricingForm = {
  scope: UpstreamCostPricingScope;
  tokenId: string;
  tokenGroup: string;
  inputPerMillion: string;
  outputPerMillion: string;
  cacheReadPerMillion: string;
  cacheWritePerMillion: string;
  reasoningPerMillion: string;
  requestUsd: string;
  enabled: boolean;
  notes: string;
};

const EMPTY_FORM: SimplePricingForm = {
  scope: 'account_model',
  tokenId: '',
  tokenGroup: '',
  inputPerMillion: '',
  outputPerMillion: '',
  cacheReadPerMillion: '',
  cacheWritePerMillion: '',
  reasoningPerMillion: '',
  requestUsd: '',
  enabled: true,
  notes: '',
};

const PREVIEW_USAGE = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  requestCount: 1,
};

function formatMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'unknown';
  return `$${numeric.toFixed(6).replace(/\.?0+$/, '')}`;
}

function scopeLabel(scope: UpstreamCostPricingScope) {
  if (scope === 'site_model') return tr('upstreamCostPricing.scope.siteModel');
  if (scope === 'account_model') return tr('upstreamCostPricing.scope.accountModel');
  if (scope === 'token_model') return tr('upstreamCostPricing.scope.tokenModel');
  return tr('upstreamCostPricing.scope.tokenGroupModel');
}

function scopeDescription(scope: UpstreamCostPricingScope) {
  if (scope === 'site_model') return tr('upstreamCostPricing.scope.siteModelDescription');
  if (scope === 'account_model') return tr('upstreamCostPricing.scope.accountModelDescription');
  if (scope === 'token_model') return tr('upstreamCostPricing.scope.tokenModelDescription');
  return tr('upstreamCostPricing.scope.tokenGroupModelDescription');
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeDecimalInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  if (rest.length === 0) return head;
  return `${head}.${rest.join('')}`;
}

function readComponentUnit(plan: Record<string, unknown> | null | undefined, componentId: string): string {
  const components = Array.isArray(plan?.components) ? plan.components : [];
  const component = components.find((item: any) => item?.id === componentId || item?.kind === componentId) as any;
  const amount = Number(component?.price?.amount);
  return Number.isFinite(amount) ? String(amount) : '';
}

function recordToForm(record: UpstreamCostPricingRecord | null, fallback: Partial<SimplePricingForm> = {}): SimplePricingForm {
  if (!record) return { ...EMPTY_FORM, ...fallback };
  return {
    scope: record.scope,
    tokenId: record.tokenId ? String(record.tokenId) : '',
    tokenGroup: record.tokenGroup || '',
    inputPerMillion: readComponentUnit(record.plan, 'input_tokens'),
    outputPerMillion: readComponentUnit(record.plan, 'output_tokens'),
    cacheReadPerMillion: readComponentUnit(record.plan, 'cache_read_tokens'),
    cacheWritePerMillion: readComponentUnit(record.plan, 'cache_write_tokens'),
    reasoningPerMillion: readComponentUnit(record.plan, 'reasoning_tokens'),
    requestUsd: readComponentUnit(record.plan, 'request'),
    enabled: record.enabled,
    notes: record.notes || '',
  };
}

function resolveDefaultScope(tokens: UpstreamTokenOption[]): UpstreamCostPricingScope {
  return tokens.length > 0 ? 'token_model' : 'account_model';
}

function pickInitialToken(tokens: UpstreamTokenOption[]) {
  return tokens.find((token) => token.isDefault && token.enabled !== false) || tokens.find((token) => token.enabled !== false) || tokens[0] || null;
}

function buildPayload(input: {
  form: SimplePricingForm;
  siteId: number;
  accountId: number;
  modelName: string;
}): UpstreamCostPricingPayload {
  const tokenId = input.form.tokenId ? Number(input.form.tokenId) : undefined;
  const tokenGroup = input.form.scope === 'token_model_group' ? input.form.tokenGroup.trim() : null;
  return {
    scope: input.form.scope,
    siteId: input.siteId,
    accountId: input.form.scope === 'site_model' ? null : input.accountId,
    tokenId: input.form.scope === 'token_model' || input.form.scope === 'token_model_group' ? tokenId : null,
    tokenGroup,
    modelName: input.modelName,
    enabled: input.form.enabled,
    simpleTokenPricing: {
      inputPerMillion: parseOptionalNumber(input.form.inputPerMillion),
      outputPerMillion: parseOptionalNumber(input.form.outputPerMillion),
      cacheReadPerMillion: parseOptionalNumber(input.form.cacheReadPerMillion),
      cacheWritePerMillion: parseOptionalNumber(input.form.cacheWritePerMillion),
      reasoningPerMillion: parseOptionalNumber(input.form.reasoningPerMillion),
      requestUsd: parseOptionalNumber(input.form.requestUsd),
    },
    notes: input.form.notes.trim() || null,
    metadata: {
      editor: 'upstream-cost-pricing-editor',
    },
  };
}

function isSameScope(record: UpstreamCostPricingRecord, form: SimplePricingForm, accountId: number) {
  if (record.scope !== form.scope) return false;
  if (form.scope === 'site_model') return record.accountId == null && record.tokenId == null;
  if (record.accountId !== accountId) return false;
  if (form.scope === 'account_model') return record.tokenId == null;
  if (record.tokenId !== Number(form.tokenId)) return false;
  if (form.scope === 'token_model_group') return (record.tokenGroup || '') === form.tokenGroup.trim();
  return !record.tokenGroup;
}

export function UpstreamCostPricingEditor({
  open,
  siteId,
  accountId,
  modelName,
  siteName,
  accountName,
  tokens = [],
  onOpenChange,
  onSaved,
  toast,
}: UpstreamCostPricingEditorProps) {
  const availableTokens = useMemo(() => tokens.filter((token) => token.enabled !== false), [tokens]);
  const [records, setRecords] = useState<UpstreamCostPricingRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [form, setForm] = useState<SimplePricingForm>(() => {
    const token = pickInitialToken(availableTokens);
    return {
      ...EMPTY_FORM,
      scope: resolveDefaultScope(availableTokens),
      tokenId: token ? String(token.id) : '',
      tokenGroup: token?.tokenGroup || '',
    };
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId],
  );

  const resetToNew = useCallback(() => {
    const token = pickInitialToken(availableTokens);
    setSelectedRecordId(null);
    setForm({
      ...EMPTY_FORM,
      scope: resolveDefaultScope(availableTokens),
      tokenId: token ? String(token.id) : '',
      tokenGroup: token?.tokenGroup || '',
    });
    setPreview(null);
  }, [availableTokens]);

  const loadRecords = useCallback(async () => {
    if (!open || !siteId || !accountId || !modelName) return;
    setLoading(true);
    try {
      const next = await api.listUpstreamCostPricings({ siteId, modelName });
      setRecords(next);
      const preferred = next.find((record) => record.accountId === accountId)
        || next.find((record) => record.scope === 'site_model')
        || next[0]
        || null;
      if (preferred) {
        setSelectedRecordId(preferred.id);
        setForm(recordToForm(preferred));
      } else {
        resetToNew();
      }
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, modelName, open, resetToNew, siteId, toast]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const updateForm = (patch: Partial<SimplePricingForm>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.scope === 'site_model' || patch.scope === 'account_model') {
        next.tokenId = '';
        next.tokenGroup = '';
      }
      if (patch.scope === 'token_model' || patch.scope === 'token_model_group') {
        const token = availableTokens.find((item) => String(item.id) === next.tokenId) || pickInitialToken(availableTokens);
        next.tokenId = token ? String(token.id) : '';
        if (patch.scope === 'token_model_group' && !next.tokenGroup) next.tokenGroup = token?.tokenGroup || '';
        if (patch.scope === 'token_model') next.tokenGroup = '';
      }
      return next;
    });
    setPreview(null);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const payload = buildPayload({ form, siteId, accountId, modelName });
      const savedLike = selectedRecord && isSameScope(selectedRecord, form, accountId);
      if (savedLike) {
        const result = await api.previewUpstreamCostPricing({
          siteId,
          accountId: payload.accountId ?? undefined,
          tokenId: payload.tokenId ?? undefined,
          tokenGroup: payload.tokenGroup ?? undefined,
          modelName,
          usage: PREVIEW_USAGE,
        });
        setPreview(result.evaluation || null);
      } else {
        const localTotal =
          (parseOptionalNumber(form.inputPerMillion) || 0)
          + (parseOptionalNumber(form.outputPerMillion) || 0)
          + (parseOptionalNumber(form.requestUsd) || 0);
        setPreview({
          totalCostUsd: localTotal,
          source: 'local_form',
          estimateLevel: 'request_estimate',
        });
      }
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.errors.previewFailed'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildPayload({ form, siteId, accountId, modelName });
      if (!payload.simpleTokenPricing || Object.values(payload.simpleTokenPricing).every((value) => value === undefined)) {
        throw new Error(tr('upstreamCostPricing.errors.emptyPricing'));
      }
      const matched = records.find((record) => isSameScope(record, form, accountId));
      const saved = matched
        ? await api.updateUpstreamCostPricing(matched.id, payload)
        : await api.createUpstreamCostPricing(payload);
      toast?.success?.(tr('upstreamCostPricing.saved'));
      setSelectedRecordId(saved.id);
      setForm(recordToForm(saved));
      await loadRecords();
      onSaved?.();
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord) return;
    setSaving(true);
    try {
      await api.deleteUpstreamCostPricing(selectedRecord.id);
      toast?.success?.(tr('upstreamCostPricing.deleted'));
      await loadRecords();
      resetToNew();
      onSaved?.();
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.errors.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const canUseTokenScope = availableTokens.length > 0;
  const selectedToken = availableTokens.find((token) => String(token.id) === form.tokenId) || null;

  if (!open) return null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="size-4" />
            {tr('upstreamCostPricing.title')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {siteName || `${tr('common.site')} ${siteId}`} · {accountName || `${tr('common.account')} ${accountId}`} · <span className="font-mono">{modelName}</span>
          </div>
        </div>
        <ButtonGroup>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadRecords()} disabled={loading || saving}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {tr('common.refresh')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetToNew} disabled={saving}>
            <Plus className="size-4" />
            {tr('common.new')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('common.close')}
          </Button>
        </ButtonGroup>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(200px,260px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{tr('upstreamCostPricing.configured')}</CardTitle>
            <CardDescription>{tr('upstreamCostPricing.configuredDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {tr('common.loading')}
              </div>
            ) : records.length > 0 ? (
              records.map((record) => (
                <Button
                  key={record.id}
                  type="button"
                  variant="ghost"
                  className="grid gap-1 rounded-md border bg-background p-2 text-left text-sm hover:bg-accent data-[state=selected]:bg-accent"
                  data-state={record.id === selectedRecordId ? 'selected' : undefined}
                  onClick={() => {
                    setSelectedRecordId(record.id);
                    setForm(recordToForm(record));
                    setPreview(null);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{record.scope}</span>
                    <ToneBadge tone={record.enabled ? '-success' : '-muted'}>{record.enabled ? tr('common.enabled') : tr('common.disabled')}</ToneBadge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {record.tokenGroup || (record.tokenId ? `token ${record.tokenId}` : record.accountId ? `account ${record.accountId}` : `site ${record.siteId}`)}
                  </div>
                </Button>
              ))
            ) : (
              <Empty className="p-4">
                <EmptyHeader>
                  <EmptyTitle>{tr('upstreamCostPricing.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{tr('upstreamCostPricing.emptyDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr('upstreamCostPricing.rateCard')}</CardTitle>
            <CardDescription>{tr('upstreamCostPricing.rateCardDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="grid gap-1">
                <div className="text-sm font-medium">{tr('upstreamCostPricing.enableTitle')}</div>
                <div className="text-xs text-muted-foreground">
                  {tr('upstreamCostPricing.enableDescription')}
                </div>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) => updateForm({ enabled })}
                aria-label={tr('upstreamCostPricing.enableAria')}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Label className="grid gap-1.5 text-xs text-muted-foreground">
                {tr('upstreamCostPricing.scope')}
                <Select value={form.scope} onValueChange={(scope) => updateForm({ scope: scope as UpstreamCostPricingScope })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="site_model">{tr('upstreamCostPricing.scope.siteModel')}</SelectItem>
                    <SelectItem value="account_model">{tr('upstreamCostPricing.scope.accountModel')}</SelectItem>
                    <SelectItem value="token_model" disabled={!canUseTokenScope}>{tr('upstreamCostPricing.scope.tokenModel')}</SelectItem>
                    <SelectItem value="token_model_group" disabled={!canUseTokenScope}>{tr('upstreamCostPricing.scope.tokenGroupModel')}</SelectItem>
                  </SelectContent>
                </Select>
                <span>{scopeDescription(form.scope)}</span>
              </Label>
              {form.scope === 'token_model' || form.scope === 'token_model_group' ? (
                <Label className="grid gap-1.5 text-xs text-muted-foreground">
                  Token
                  <Select value={form.tokenId} onValueChange={(tokenId) => {
                    const token = availableTokens.find((item) => String(item.id) === tokenId);
                    updateForm({ tokenId, tokenGroup: form.scope === 'token_model_group' ? token?.tokenGroup || '' : '' });
                  }}>
                    <SelectTrigger><SelectValue placeholder={tr('upstreamCostPricing.selectToken')} /></SelectTrigger>
                    <SelectContent>
                      {availableTokens.map((token) => (
                        <SelectItem key={token.id} value={String(token.id)}>
                          {token.name}{token.tokenGroup ? ` · ${token.tokenGroup}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              ) : null}
              {form.scope === 'token_model_group' ? (
                <Label className="grid gap-1.5 text-xs text-muted-foreground">
                  {tr('upstreamCostPricing.tokenGroup')}
                  <Input value={form.tokenGroup} onChange={(event) => updateForm({ tokenGroup: event.target.value })} placeholder={selectedToken?.tokenGroup || 'default'} />
                </Label>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <PriceInput label={tr('upstreamCostPricing.price.input')} value={form.inputPerMillion} onChange={(inputPerMillion) => updateForm({ inputPerMillion })} />
              <PriceInput label={tr('upstreamCostPricing.price.output')} value={form.outputPerMillion} onChange={(outputPerMillion) => updateForm({ outputPerMillion })} />
              <PriceInput label={tr('upstreamCostPricing.price.cacheRead')} value={form.cacheReadPerMillion} onChange={(cacheReadPerMillion) => updateForm({ cacheReadPerMillion })} />
              <PriceInput label={tr('upstreamCostPricing.price.cacheWrite')} value={form.cacheWritePerMillion} onChange={(cacheWritePerMillion) => updateForm({ cacheWritePerMillion })} />
              <PriceInput label={tr('upstreamCostPricing.price.reasoning')} value={form.reasoningPerMillion} onChange={(reasoningPerMillion) => updateForm({ reasoningPerMillion })} />
              <PriceInput label={tr('upstreamCostPricing.price.requestFee')} value={form.requestUsd} onChange={(requestUsd) => updateForm({ requestUsd })} />
            </div>

            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              {tr('upstreamCostPricing.notes')}
              <Input value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder={tr('upstreamCostPricing.notesPlaceholder')} />
            </Label>

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ToneBadge tone="-muted">{tr('upstreamCostPricing.previewSummary')}</ToneBadge>
                <ToneBadge tone="-muted">{scopeLabel(form.scope)}</ToneBadge>
                {preview ? <ToneBadge tone="-info">{formatMoney(preview.totalCostUsd)}</ToneBadge> : null}
              </div>
              <ButtonGroup>
                <Button type="button" variant="outline" size="sm" onClick={() => void handlePreview()} disabled={previewLoading || saving}>
                  {previewLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                  {tr('upstreamCostPricing.preview')}
                </Button>
                <Button type="button" variant="default" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {tr('common.save')}
                </Button>
                <Button type="button" variant="ghostDestructive" size="sm" onClick={() => void handleDelete()} disabled={!selectedRecord || saving}>
                  <Trash2 className="size-4" />
                  {tr('common.delete')}
                </Button>
              </ButtonGroup>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PriceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Label className="grid gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(normalizeDecimalInput(event.target.value))}
        placeholder="0"
      />
    </Label>
  );
}
