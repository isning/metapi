import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LoaderCircle, Trash2, Wallet } from 'lucide-react';
import { api, type DailyEarnedBalanceSource, type WalletAcquisitionConfidence, type WalletAcquisitionInheritance, type WalletAcquisitionProfile, type WalletAcquisitionProfilePayload, type WalletAcquisitionScope } from '../api.js';
import { tr } from '../i18n.js';
import CenteredModal from './CenteredModal.js';
import ToneBadge from './ToneBadge.js';
import { Button } from './ui/button/index.js';
import { Card, CardContent } from './ui/card/index.js';
import { Input } from './ui/input/index.js';
import { Label } from './ui/label/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select/index.js';
import { Switch } from './ui/switch/index.js';
import { Textarea } from './ui/textarea/index.js';

export type WalletAcquisitionEditorSubject = {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  title: string;
  subtitle?: string | null;
  siteLabel?: string | null;
  accountLabel?: string | null;
  tokenLabel?: string | null;
};

type WalletForm = {
  id: number | null;
  inheritance: WalletAcquisitionInheritance;
  walletUnit: string;
  faceValuePrice: string;
  rechargeDiscount: string;
  dailyEarnedBalance: string;
  dailyEarnedBalanceSource: DailyEarnedBalanceSource;
  observedWindowDays: string;
  confidence: WalletAcquisitionConfidence;
  enabled: boolean;
  notes: string;
};

type WalletAcquisitionEditorProps = {
  open: boolean;
  subject: WalletAcquisitionEditorSubject | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  toast?: {
    success?: (message: string) => void;
    error?: (message: string) => void;
  };
};

const EMPTY_FORM: WalletForm = {
  id: null,
  inheritance: 'override',
  walletUnit: 'USD',
  faceValuePrice: '',
  rechargeDiscount: '1',
  dailyEarnedBalance: '',
  dailyEarnedBalanceSource: 'observed_checkin',
  observedWindowDays: '',
  confidence: 'incomplete',
  enabled: true,
  notes: '',
};

function numberOrNull(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function profileToForm(profile: WalletAcquisitionProfile): WalletForm {
  return {
    id: profile.id,
    inheritance: profile.inheritance,
    walletUnit: profile.walletUnit,
    faceValuePrice: profile.faceValuePrice == null ? '' : String(profile.faceValuePrice),
    rechargeDiscount: String(profile.rechargeDiscount),
    dailyEarnedBalance: profile.dailyEarnedBalance == null ? '' : String(profile.dailyEarnedBalance),
    dailyEarnedBalanceSource: profile.dailyEarnedBalanceSource,
    observedWindowDays: profile.observedWindowDays == null ? '' : String(profile.observedWindowDays),
    confidence: profile.confidence,
    enabled: profile.enabled,
    notes: profile.notes || '',
  };
}

function formToPayload(subject: WalletAcquisitionEditorSubject, form: WalletForm): WalletAcquisitionProfilePayload {
  return {
    scope: subject.scope,
    siteId: subject.siteId,
    accountId: subject.scope === 'site' ? null : subject.accountId ?? null,
    tokenId: subject.scope === 'token' ? subject.tokenId ?? null : null,
    inheritance: form.inheritance,
    walletUnit: form.walletUnit.trim() || 'USD',
    faceValuePrice: numberOrNull(form.faceValuePrice),
    rechargeDiscount: numberOrNull(form.rechargeDiscount) ?? 1,
    dailyEarnedBalance: numberOrNull(form.dailyEarnedBalance),
    dailyEarnedBalanceSource: form.dailyEarnedBalanceSource,
    observedWindowDays: numberOrNull(form.observedWindowDays),
    confidence: form.confidence,
    enabled: form.enabled,
    notes: form.notes.trim() || null,
  };
}

function sameProfileSubject(profile: WalletAcquisitionProfile, subject: WalletAcquisitionEditorSubject): boolean {
  if (profile.scope !== subject.scope) return false;
  if (profile.siteId !== subject.siteId) return false;
  if (subject.scope === 'site') return profile.accountId == null && profile.tokenId == null;
  if (subject.scope === 'account') return profile.accountId === subject.accountId && profile.tokenId == null;
  return profile.accountId === subject.accountId && profile.tokenId === subject.tokenId;
}

function profileForScope(profiles: WalletAcquisitionProfile[], input: {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
}): WalletAcquisitionProfile | null {
  return profiles.find((profile) => sameProfileSubject(profile, {
    ...input,
    title: '',
  })) || null;
}

function scopeText(scope: WalletAcquisitionScope): string {
  if (scope === 'site') return tr('upstreamCostPricing.costCatalog.walletScope.site');
  if (scope === 'account') return tr('upstreamCostPricing.costCatalog.walletScope.account');
  return tr('upstreamCostPricing.costCatalog.walletScope.token');
}

function inheritanceText(value: WalletAcquisitionInheritance): string {
  if (value === 'inherit') return tr('upstreamCostPricing.costCatalog.walletInheritance.inherit');
  if (value === 'disabled') return tr('upstreamCostPricing.costCatalog.walletInheritance.disabled');
  return tr('upstreamCostPricing.costCatalog.walletInheritance.override');
}

function dailySourceText(value: DailyEarnedBalanceSource): string {
  if (value === 'manual') return tr('upstreamCostPricing.costCatalog.dailySource.manual');
  if (value === 'observed_checkin') return tr('upstreamCostPricing.costCatalog.dailySource.observed');
  if (value === 'mixed') return tr('upstreamCostPricing.costCatalog.dailySource.mixed');
  return tr('upstreamCostPricing.costCatalog.dailySource.none');
}

function confidenceText(value: WalletAcquisitionConfidence): string {
  if (value === 'exact') return tr('upstreamCostPricing.costCatalog.confidence.exact');
  if (value === 'estimated') return tr('upstreamCostPricing.costCatalog.confidence.estimated');
  return tr('upstreamCostPricing.costCatalog.confidence.incomplete');
}

function confidenceTone(value: WalletAcquisitionConfidence): string {
  if (value === 'exact') return '-success';
  if (value === 'estimated') return '-info';
  return '-warning';
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(6).replace(/\.?0+$/, '');
}

function formatWalletAmount(value: number | null | undefined, currency: string | null | undefined): string {
  const amount = formatCompactNumber(value);
  return amount === '-' ? '-' : `${amount} ${currency || 'USD'}`;
}

function describeProfile(profile: WalletAcquisitionProfile | null): string {
  if (!profile) return tr('upstreamCostPricing.walletEditor.notConfigured');
  if (profile.inheritance === 'disabled') return tr('upstreamCostPricing.walletEditor.disabledHere');
  if (profile.inheritance === 'inherit') return tr('upstreamCostPricing.walletEditor.inheritsParent');
  return `${profile.walletUnit} · ${tr('upstreamCostPricing.costCatalog.walletList.dailySource')} ${dailySourceText(profile.dailyEarnedBalanceSource)}`;
}

function resolveEffectiveProfile(subject: WalletAcquisitionEditorSubject, profiles: WalletAcquisitionProfile[]) {
  const chain = [
    {
      scope: 'site' as const,
      label: subject.siteLabel || `${tr('common.site')} ${subject.siteId}`,
      profile: profileForScope(profiles, { scope: 'site', siteId: subject.siteId }),
      visible: true,
    },
    {
      scope: 'account' as const,
      label: subject.accountLabel || `${tr('common.account')} ${subject.accountId ?? '-'}`,
      profile: subject.accountId ? profileForScope(profiles, { scope: 'account', siteId: subject.siteId, accountId: subject.accountId }) : null,
      visible: subject.scope === 'account' || subject.scope === 'token',
    },
    {
      scope: 'token' as const,
      label: subject.tokenLabel || `Token ${subject.tokenId ?? '-'}`,
      profile: subject.tokenId ? profileForScope(profiles, { scope: 'token', siteId: subject.siteId, accountId: subject.accountId, tokenId: subject.tokenId }) : null,
      visible: subject.scope === 'token',
    },
  ].filter((item) => item.visible);

  for (const item of [...chain].reverse()) {
    if (!item.profile || item.profile.enabled === false) continue;
    if (item.profile.inheritance === 'disabled') return { chain, effective: null, stoppedAt: item.scope };
    if (item.profile.inheritance === 'override') return { chain, effective: item.profile, stoppedAt: null };
  }
  return { chain, effective: null, stoppedAt: null };
}

function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
      {description ? <span className="text-[11px] leading-relaxed">{description}</span> : null}
    </Label>
  );
}

export function WalletAcquisitionEditor({
  open,
  subject,
  onOpenChange,
  onSaved,
  toast,
}: WalletAcquisitionEditorProps) {
  const [profiles, setProfiles] = useState<WalletAcquisitionProfile[]>([]);
  const [form, setForm] = useState<WalletForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const exactProfile = useMemo(() => (
    subject ? profiles.find((profile) => sameProfileSubject(profile, subject)) || null : null
  ), [profiles, subject]);
  const resolution = useMemo(() => (
    subject ? resolveEffectiveProfile(subject, profiles) : { chain: [], effective: null, stoppedAt: null }
  ), [profiles, subject]);

  const loadProfiles = useCallback(async () => {
    if (!subject) return;
    setLoading(true);
    try {
      const nextProfiles = await api.listWalletAcquisitionProfiles({ siteId: subject.siteId });
      setProfiles(nextProfiles);
      const exact = nextProfiles.find((profile) => sameProfileSubject(profile, subject)) || null;
      setForm(exact ? profileToForm(exact) : EMPTY_FORM);
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [subject, toast]);

  useEffect(() => {
    if (!open) return;
    void loadProfiles();
  }, [loadProfiles, open]);

  const updateForm = (patch: Partial<WalletForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const save = async () => {
    if (!subject) return;
    setSaving(true);
    try {
      const payload = formToPayload(subject, form);
      const saved = exactProfile
        ? await api.updateWalletAcquisitionProfile(exactProfile.id, payload)
        : await api.createWalletAcquisitionProfile(payload);
      setForm(profileToForm(saved));
      toast?.success?.(tr('upstreamCostPricing.costCatalog.walletSaved'));
      await loadProfiles();
      onSaved?.();
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.costCatalog.walletSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!exactProfile) return;
    setSaving(true);
    try {
      await api.deleteWalletAcquisitionProfile(exactProfile.id);
      toast?.success?.(tr('upstreamCostPricing.costCatalog.walletDeleted'));
      setForm(EMPTY_FORM);
      await loadProfiles();
      onSaved?.();
    } catch (error: any) {
      toast?.error?.(error?.message || tr('upstreamCostPricing.costCatalog.walletDeleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!subject) return null;

  return (
    <CenteredModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={(
        <span className="inline-flex min-w-0 items-center gap-2">
          <Wallet className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{tr('upstreamCostPricing.costCatalog.walletCost')}</span>
        </span>
      )}
      maxWidth={980}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('common.cancel')}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {exactProfile ? (
              <Button type="button" variant="ghostDestructive" onClick={() => void remove()} disabled={saving}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {tr('pages.accounts.delete3')}
              </Button>
            ) : null}
            <Button type="button" onClick={() => void save()} disabled={saving || loading}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {tr('common.save')}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="grid gap-3">
        <div className="rounded-md border bg-muted/25 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{subject.title}</div>
              {subject.subtitle ? <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{subject.subtitle}</div> : null}
            </div>
            <ToneBadge tone="-info">{scopeText(subject.scope)}</ToneBadge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {resolution.chain.map((item) => {
              const isEffective = resolution.effective?.id === item.profile?.id;
              const isStopped = resolution.stoppedAt === item.scope;
              return (
                <div key={item.scope} className="rounded-md border bg-background px-3 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{scopeText(item.scope)}</span>
                    {isEffective ? <ToneBadge tone="-success">{tr('upstreamCostPricing.walletEditor.effective')}</ToneBadge> : null}
                    {isStopped ? <ToneBadge tone="-warning">{tr('upstreamCostPricing.walletEditor.stopped')}</ToneBadge> : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{describeProfile(item.profile)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <Card>
          <CardContent className="grid gap-3 p-3">
            <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.inheritance')}>
                <Select value={form.inheritance} onValueChange={(inheritance) => updateForm({ inheritance: inheritance as WalletAcquisitionInheritance })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="override">{inheritanceText('override')}</SelectItem>
                    <SelectItem value="inherit">{inheritanceText('inherit')}</SelectItem>
                    <SelectItem value="disabled">{inheritanceText('disabled')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={tr('common.enabled')}>
                <div className="flex h-9 items-center gap-2 rounded-md border px-3">
                  <Switch checked={form.enabled} onCheckedChange={(enabled) => updateForm({ enabled })} />
                  <span>{form.enabled ? tr('common.enabled') : tr('common.disabled')}</span>
                </div>
              </Field>
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.confidence')}>
                <Select value={form.confidence} onValueChange={(confidence) => updateForm({ confidence: confidence as WalletAcquisitionConfidence })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">{confidenceText('exact')}</SelectItem>
                    <SelectItem value="estimated">{confidenceText('estimated')}</SelectItem>
                    <SelectItem value="incomplete">{confidenceText('incomplete')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <ToneBadge tone={confidenceTone(form.confidence)} className="min-h-9 px-3">
                  {exactProfile ? tr('upstreamCostPricing.walletEditor.configuredHere') : tr('upstreamCostPricing.walletEditor.newProfile')}
                </ToneBadge>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.walletUnit')} description={tr('upstreamCostPricing.costCatalog.walletForm.walletUnitHelp')}>
                <Input value={form.walletUnit} onChange={(event) => updateForm({ walletUnit: event.target.value.toUpperCase() })} />
              </Field>
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.faceValuePrice')} description={tr('upstreamCostPricing.costCatalog.walletForm.faceValuePriceHelp')}>
                <Input value={form.faceValuePrice} inputMode="decimal" onChange={(event) => updateForm({ faceValuePrice: event.target.value })} />
              </Field>
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.rechargeDiscount')} description={tr('upstreamCostPricing.costCatalog.walletForm.rechargeDiscountHelp')}>
                <Input value={form.rechargeDiscount} inputMode="decimal" onChange={(event) => updateForm({ rechargeDiscount: event.target.value })} />
              </Field>
            </div>

            <div className="rounded-md border border-info/25 bg-info/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{tr('upstreamCostPricing.costCatalog.freeQuotaHintTitle')}</span>
              <span className="ml-1">{tr('upstreamCostPricing.costCatalog.freeQuotaHintDescription')}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-4">
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.dailyEarnedBalance')} description={tr('upstreamCostPricing.costCatalog.walletForm.dailyEarnedBalanceHelp')}>
                <Input value={form.dailyEarnedBalance} inputMode="decimal" onChange={(event) => updateForm({ dailyEarnedBalance: event.target.value })} />
              </Field>
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.dailyEarnedBalanceSource')}>
                <Select value={form.dailyEarnedBalanceSource} onValueChange={(dailyEarnedBalanceSource) => updateForm({ dailyEarnedBalanceSource: dailyEarnedBalanceSource as DailyEarnedBalanceSource })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="observed_checkin">{dailySourceText('observed_checkin')}</SelectItem>
                    <SelectItem value="manual">{dailySourceText('manual')}</SelectItem>
                    <SelectItem value="mixed">{dailySourceText('mixed')}</SelectItem>
                    <SelectItem value="none">{dailySourceText('none')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={tr('upstreamCostPricing.costCatalog.walletForm.observedWindowDays')}>
                <Input value={form.observedWindowDays} inputMode="numeric" onChange={(event) => updateForm({ observedWindowDays: event.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center"
                  onClick={() => updateForm({
                    rechargeDiscount: '0',
                    dailyEarnedBalanceSource: 'observed_checkin',
                    confidence: form.confidence === 'exact' ? 'exact' : 'estimated',
                  })}
                >
                  <Wallet className="size-4" />
                  {tr('upstreamCostPricing.costCatalog.freeQuotaPreset')}
                </Button>
              </div>
            </div>

            <Field label={tr('upstreamCostPricing.notes')}>
              <Textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} />
            </Field>
            {resolution.effective ? (
              <div className="rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                {tr('upstreamCostPricing.walletEditor.effectiveSummary')
                  .replace('{scope}', scopeText(resolution.effective.scope))
                  .replace('{cost}', formatWalletAmount(resolution.effective.faceValuePrice, resolution.effective.walletUnit))
                  .replace('{daily}', formatWalletAmount(resolution.effective.dailyEarnedBalance, resolution.effective.walletUnit))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </CenteredModal>
  );
}

export default WalletAcquisitionEditor;
