import { type ChangeEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Database, DownloadCloud, ExternalLink, LoaderCircle, RefreshCw, Save, Search, Settings2, Upload } from 'lucide-react';
import {
  api,
  type PricingReferenceCatalog,
  type PricingReferenceCatalogEntry,
  type PricingReferenceCatalogEntryInput,
  type PricingReferenceConfig,
} from '../api.js';
import { tr } from '../i18n.js';
import { useToast } from '../components/Toast.js';
import JsonCodeEditor from '../components/JsonCodeEditor.js';
import ToneBadge from '../components/ToneBadge.js';
import { cn } from '../lib/utils.js';
import PageHeader from '../components/workspace/PageHeader.js';
import { SITE_DOCS_URL } from '../docsLink.js';
import {
  CreateActionButton,
  PageActionBar,
  SecondaryActionButton,
  TableActionBar,
} from '../components/workspace/ActionBar.js';
import { Button } from '../components/ui/button/index.js';
import { DataTable, DataTableEmpty, DataTableToolbar } from '../components/ui/data-table/index.js';
import * as Dialog from '../components/ui/dialog/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import { Switch } from '../components/ui/switch/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';
import { Textarea } from '../components/ui/textarea/index.js';

type ReferenceEntryForm = {
  id: string;
  provider: string;
  modelName: string;
  displayName: string;
  aliases: string;
  inputPerMillion: string;
  outputPerMillion: string;
  cacheReadPerMillion: string;
  cacheWritePerMillion: string;
  reasoningPerMillion: string;
  requestUsd: string;
  advancedPlanEnabled: boolean;
  planJson: string;
  sourceUrl: string;
  sourceType: PricingReferenceCatalogEntry['sourceType'];
  notes: string;
};

const emptyEntryForm: ReferenceEntryForm = {
  id: '',
  provider: '',
  modelName: '',
  displayName: '',
  aliases: '',
  inputPerMillion: '',
  outputPerMillion: '',
  cacheReadPerMillion: '',
  cacheWritePerMillion: '',
  reasoningPerMillion: '',
  requestUsd: '',
  advancedPlanEnabled: false,
  planJson: '',
  sourceUrl: '',
  sourceType: 'manual',
  notes: '',
};

function updateConfigState(
  current: PricingReferenceConfig | null,
  patch: Partial<PricingReferenceConfig>,
): PricingReferenceConfig | null {
  if (!current) return current;
  return {
    ...current,
    ...patch,
    sync: patch.sync ? { ...current.sync, ...patch.sync } : current.sync,
  };
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function entrySourceLabel(sourceType: PricingReferenceCatalogEntry['sourceType']): string {
  if (sourceType === 'remote') return tr('upstreamCostPricing.reference.source.remote');
  if (sourceType === 'imported') return tr('upstreamCostPricing.reference.source.imported');
  return tr('upstreamCostPricing.reference.source.manual');
}

function entrySourceTone(sourceType: PricingReferenceCatalogEntry['sourceType']): string {
  if (sourceType === 'remote') return '-info';
  if (sourceType === 'imported') return '-warning';
  return '-muted';
}

function CostCatalogTableLoadingSkeleton() {
  return (
    <Table className="w-full table-fixed text-sm" aria-busy="true">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[36%]">{tr('upstreamCostPricing.reference.model')}</TableHead>
          <TableHead className="w-[20%]">{tr('upstreamCostPricing.reference.provider')}</TableHead>
          <TableHead className="w-[24%]">{tr('upstreamCostPricing.reference.aliases')}</TableHead>
          <TableHead className="w-[14%]">{tr('upstreamCostPricing.reference.updatedAt')}</TableHead>
          <TableHead className="w-[6rem] text-right">{tr('pages.accounts.actions2')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }).map((_, index) => (
          <TableRow key={index} className={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
            <TableCell>
              <div className="grid gap-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-28" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-3 w-20" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="ml-auto h-8 w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CostCatalogDialogLoadingSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function readPlanComponent(plan: Record<string, unknown>, key: string): string {
  const components = Array.isArray(plan.components) ? plan.components : [];
  const component = components.find((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return record.id === key || record.usageKey === key;
  });
  if (!component || typeof component !== 'object') return '';
  const record = component as Record<string, unknown>;
  const directUnitPrice = record.unitPrice;
  if (typeof directUnitPrice === 'number' && Number.isFinite(directUnitPrice)) return String(directUnitPrice);
  const price = record.price;
  if (!price || typeof price !== 'object') return '';
  const amount = (price as Record<string, unknown>).amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? String(amount) : '';
}

function entryToForm(entry: PricingReferenceCatalogEntry | null): ReferenceEntryForm {
  if (!entry) return emptyEntryForm;
  return {
    id: entry.id,
    provider: entry.provider ?? '',
    modelName: entry.modelName,
    displayName: entry.displayName ?? '',
    aliases: entry.aliases.join(', '),
    inputPerMillion: readPlanComponent(entry.plan, 'input_tokens'),
    outputPerMillion: readPlanComponent(entry.plan, 'output_tokens'),
    cacheReadPerMillion: readPlanComponent(entry.plan, 'cache_read_tokens'),
    cacheWritePerMillion: readPlanComponent(entry.plan, 'cache_write_tokens'),
    reasoningPerMillion: readPlanComponent(entry.plan, 'reasoning_tokens'),
    requestUsd: readPlanComponent(entry.plan, 'request'),
    advancedPlanEnabled: false,
    planJson: JSON.stringify(entry.plan, null, 2),
    sourceUrl: entry.sourceUrl ?? '',
    sourceType: entry.sourceType,
    notes: entry.notes ?? '',
  };
}

function parseOptionalNumber(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Price values must be non-negative numbers.');
  }
  return parsed;
}

function formToEntryInput(form: ReferenceEntryForm): PricingReferenceCatalogEntryInput {
  const modelName = form.modelName.trim();
  if (!modelName) throw new Error('Reference entry model name is required.');
  const planText = form.planJson.trim();
  const aliases = form.aliases
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const input: PricingReferenceCatalogEntryInput = {
    modelName,
    provider: form.provider.trim() || null,
    displayName: form.displayName.trim() || null,
    aliases,
    sourceUrl: form.sourceUrl.trim() || null,
    sourceType: form.sourceType,
    notes: form.notes.trim() || null,
    updatedAt: new Date().toISOString(),
  };
  if (form.id.trim()) input.id = form.id.trim();
  if (form.advancedPlanEnabled && planText) {
    input.plan = JSON.parse(planText);
  } else {
    input.simpleTokenPricing = {
      inputPerMillion: parseOptionalNumber(form.inputPerMillion),
      outputPerMillion: parseOptionalNumber(form.outputPerMillion),
      cacheReadPerMillion: parseOptionalNumber(form.cacheReadPerMillion),
      cacheWritePerMillion: parseOptionalNumber(form.cacheWritePerMillion),
      reasoningPerMillion: parseOptionalNumber(form.reasoningPerMillion),
      requestUsd: parseOptionalNumber(form.requestUsd),
    };
  }
  return input;
}

export default function CostCatalog() {
  const toast = useToast();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<PricingReferenceConfig | null>(null);
  const [catalog, setCatalog] = useState<PricingReferenceCatalog | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState<ReferenceEntryForm>(emptyEntryForm);
  const [importDraft, setImportDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [nextConfig, nextCatalog] = await Promise.all([
        api.getPricingReferenceConfig(),
        api.getPricingReferenceCatalog(),
      ]);
      setConfig(nextConfig);
      setCatalog(nextCatalog);
      setSelectedEntryId((current) => {
        const selected = current
          ? nextCatalog.entries.find((entry) => entry.id === current)
          : nextCatalog.entries[0];
        setEntryForm(entryToForm(selected ?? null));
        return selected?.id ?? null;
      });
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredEntries = useMemo(() => {
    const entries = catalog?.entries ?? [];
    const query = filter.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => [
      entry.id,
      entry.provider || 'global',
      entry.modelName,
      entry.displayName || '',
      entry.normalizedModelName,
      ...entry.aliases,
    ].some((value) => value.toLowerCase().includes(query)));
  }, [catalog?.entries, filter]);

  const selectedEntry = useMemo(() => {
    return catalog?.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  }, [catalog?.entries, selectedEntryId]);

  const handleSelectEntry = (entry: PricingReferenceCatalogEntry) => {
    setSelectedEntryId(entry.id);
    setEntryForm(entryToForm(entry));
    setEntryDialogOpen(true);
  };

  const handleNewEntry = () => {
    setSelectedEntryId(null);
    setEntryForm(emptyEntryForm);
    setEntryDialogOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await api.updatePricingReferenceConfig(config);
      setConfig(saved);
      setSyncDialogOpen(false);
      toast.success(tr('upstreamCostPricing.reference.saved'));
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.reference.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntry = async () => {
    if (!catalog) return;
    setSaving(true);
    try {
      const entry = formToEntryInput(entryForm);
      const entryId = String(entry.id || selectedEntryId || '').trim();
      const saved = await api.updatePricingReferenceCatalog({
        schemaVersion: 1,
        entries: [
          ...catalog.entries.filter((item) => item.id !== entryId && item.id !== selectedEntryId),
          entry,
        ],
        updatedAt: catalog.updatedAt,
      });
      const nextSelected = saved.entries.find((item) => (
        item.id === entryId
        || (item.modelName === entry.modelName && item.provider === (entry.provider ?? null))
      )) ?? saved.entries[0] ?? null;
      setCatalog(saved);
      setSelectedEntryId(nextSelected?.id ?? null);
      setEntryForm(entryToForm(nextSelected));
      setEntryDialogOpen(false);
      toast.success(tr('upstreamCostPricing.reference.catalogSaved'));
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.reference.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (replace: boolean) => {
    setSaving(true);
    try {
      const payload = JSON.parse(importDraft);
      const result = await api.importPricingReferenceCatalog(payload, replace);
      setCatalog(result.catalog);
      const nextSelected = result.catalog.entries[0] ?? null;
      setSelectedEntryId(nextSelected?.id ?? null);
      setEntryForm(entryToForm(nextSelected));
      setImportDraft('');
      setImportDialogOpen(false);
      toast.success(tr('upstreamCostPricing.reference.imported').replace('{count}', String(result.imported)));
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.reference.importFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSaving(true);
    try {
      const result = await api.syncPricingReferenceCatalog();
      if ('catalog' in result) {
        setCatalog(result.catalog);
        const nextSelected = result.catalog.entries[0] ?? null;
        setSelectedEntryId(nextSelected?.id ?? null);
        setEntryForm(entryToForm(nextSelected));
        toast.success(tr('upstreamCostPricing.reference.imported').replace('{count}', String(result.imported)));
      } else {
        toast.success(tr('upstreamCostPricing.reference.syncSkipped'));
      }
      setConfig(await api.getPricingReferenceConfig());
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.reference.syncFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setImportDraft(await file.text());
    } catch (error) {
      toast.error(errorMessage(error) || tr('upstreamCostPricing.reference.importFileFailed'));
    } finally {
      event.target.value = '';
    }
  };

  const entryCount = catalog?.entries.length ?? 0;
  const remoteCount = catalog?.entries.filter((entry) => entry.sourceType === 'remote').length ?? 0;

  return (
    <div className="grid gap-4" aria-busy={loading || saving}>
      <PageHeader
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <Database className="size-5 shrink-0 text-muted-foreground" />
            <span className="truncate">{tr('upstreamCostPricing.costCatalog.title')}</span>
          </span>
        )}
        description={tr('upstreamCostPricing.costCatalog.description')}
        actions={(
          <PageActionBar>
            <SecondaryActionButton
              type="button"
              icon={RefreshCw}
              loading={loading}
              onClick={() => void loadData()}
              disabled={loading || saving}
            >
              {tr('common.refresh')}
            </SecondaryActionButton>
          </PageActionBar>
        )}
      />

      <div className="grid gap-2 md:grid-cols-3">
        <MetricCard
          label={tr('upstreamCostPricing.reference.entries')}
          value={loading ? null : String(entryCount)}
          description={tr('upstreamCostPricing.reference.metricEntriesDescription')}
          className="animate-slide-up stagger-1"
        />
        <MetricCard
          label={tr('upstreamCostPricing.reference.remoteEntries')}
          value={loading ? null : String(remoteCount)}
          description={tr('upstreamCostPricing.reference.metricRemoteDescription')}
          className="animate-slide-up stagger-2"
        />
        <MetricCard
          label={tr('upstreamCostPricing.reference.lastSyncedAt')}
          value={loading ? null : formatDateTime(config?.sync.lastSyncedAt)}
          description={config?.sync.lastError || tr('upstreamCostPricing.reference.metricSyncDescription')}
          danger={!!config?.sync.lastError}
          className="animate-slide-up stagger-3"
        />
      </div>

      <DataTable minWidth={860} density="compact" className="min-w-0 max-w-full animate-slide-up stagger-4">
        <DataTableToolbar className="border-b bg-muted/30 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
              <Database className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{tr('upstreamCostPricing.reference.entries')}</h2>
                <ToneBadge tone={entryCount > 0 ? '-success' : '-muted'} className="shrink-0">
                  {loading ? <LoaderCircle className="size-3 animate-spin" /> : null}
                  {loading ? tr('common.loading') : tr('upstreamCostPricing.reference.entryCount').replace('{count}', String(entryCount))}
                </ToneBadge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{tr('upstreamCostPricing.reference.tableDescription')}</p>
            </div>
          </div>
          <TableActionBar className="flex-1 sm:flex-none">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={tr('upstreamCostPricing.reference.searchPlaceholder')}
              />
            </div>
            <SecondaryActionButton
              type="button"
              icon={Settings2}
              onClick={() => setSyncDialogOpen(true)}
              disabled={!config || saving}
            >
              {tr('upstreamCostPricing.reference.syncSettings')}
            </SecondaryActionButton>
            <SecondaryActionButton
              type="button"
              icon={DownloadCloud}
              onClick={() => void handleSync()}
              disabled={!config?.sync.url || saving}
            >
              {tr('upstreamCostPricing.reference.syncNow')}
            </SecondaryActionButton>
            <SecondaryActionButton
              type="button"
              icon={Upload}
              onClick={() => setImportDialogOpen(true)}
              disabled={saving}
            >
              {tr('upstreamCostPricing.reference.importTab')}
            </SecondaryActionButton>
            <CreateActionButton
              type="button"
              size="sm"
              label={tr('upstreamCostPricing.reference.newEntry')}
              onClick={handleNewEntry}
            />
          </TableActionBar>
        </DataTableToolbar>

        {loading && !catalog ? (
          <CostCatalogTableLoadingSkeleton />
        ) : filteredEntries.length > 0 ? (
          <Table className="w-full table-fixed text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36%]">{tr('upstreamCostPricing.reference.model')}</TableHead>
                <TableHead className="w-[20%]">{tr('upstreamCostPricing.reference.provider')}</TableHead>
                <TableHead className="w-[24%]">{tr('upstreamCostPricing.reference.aliases')}</TableHead>
                <TableHead className="w-[14%]">{tr('upstreamCostPricing.reference.updatedAt')}</TableHead>
                <TableHead className="w-[6rem] text-right">{tr('pages.accounts.actions2')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry, index) => (
                <TableRow
                  key={entry.id}
                  data-state={entry.id === selectedEntryId ? 'selected' : undefined}
                  className={`animate-slide-up stagger-${Math.min(index + 1, 5)} row-selectable ${entry.id === selectedEntryId ? 'row-selected' : ''}`.trim()}
                  onClick={() => handleSelectEntry(entry)}
                >
                  <TableCell className="min-w-0 font-semibold">
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <span className="max-w-full truncate text-foreground" title={entry.displayName || entry.modelName}>
                        {entry.displayName || entry.modelName}
                      </span>
                      <span className="max-w-full truncate font-mono text-[11px] font-normal text-muted-foreground" title={entry.id}>
                        {entry.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0">
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      <ToneBadge tone={entry.provider ? '-muted' : 'muted'} className="max-w-full">
                        <span className="truncate">{entry.provider || 'global'}</span>
                      </ToneBadge>
                      <ToneBadge tone={entrySourceTone(entry.sourceType)}>{entrySourceLabel(entry.sourceType)}</ToneBadge>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0 text-xs text-muted-foreground">
                    <div className="truncate" title={entry.aliases.join(', ')}>
                      {entry.aliases.length > 0 ? entry.aliases.join(', ') : '-'}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-0 text-xs text-muted-foreground">
                    <div className="truncate" title={formatDateTime(entry.updatedAt)}>
                      {formatDateTime(entry.updatedAt)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectEntry(entry);
                      }}
                    >
                      {tr('upstreamCostPricing.costCatalog.editShort')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <DataTableEmpty
            className="min-h-64"
            icon={<Database className="size-5" />}
            title={filter ? tr('upstreamCostPricing.reference.noSearchResults') : tr('upstreamCostPricing.reference.noEntries')}
            description={filter ? tr('upstreamCostPricing.reference.noSearchResultsDescription') : tr('upstreamCostPricing.reference.noEntriesDescription')}
          />
        )}
      </DataTable>

      <ReferenceEntryDialog
        open={entryDialogOpen}
        selectedEntry={selectedEntry}
        form={entryForm}
        saving={saving}
        onOpenChange={setEntryDialogOpen}
        onChange={(patch) => setEntryForm((current) => ({ ...current, ...patch }))}
        onSave={() => void handleSaveEntry()}
      />
      <ReferenceImportDialog
        open={importDialogOpen}
        value={importDraft}
        saving={saving}
        fileInputRef={importFileInputRef}
        onOpenChange={setImportDialogOpen}
        onChange={setImportDraft}
        onFileChange={handleImportFile}
        onMerge={() => void handleImport(false)}
        onReplace={() => void handleImport(true)}
      />
      <ReferenceSyncDialog
        open={syncDialogOpen}
        config={config}
        saving={saving}
        onOpenChange={setSyncDialogOpen}
        onChange={setConfig}
        onSave={() => void handleSaveConfig()}
        onSync={() => void handleSync()}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  description,
  danger = false,
  className,
}: {
  label: string;
  value: string | null;
  description: string;
  danger?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border bg-card p-3', danger && 'border-destructive/30', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 min-h-7 text-lg font-semibold">
        {value == null ? <Skeleton className="h-6 w-20" /> : value}
      </div>
      <div className={cn('mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground', danger && 'text-destructive')}>
        {description}
      </div>
    </div>
  );
}

function ReferenceEntryDialog({
  open,
  selectedEntry,
  form,
  saving,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean;
  selectedEntry: PricingReferenceCatalogEntry | null;
  form: ReferenceEntryForm;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<ReferenceEntryForm>) => void;
  onSave: () => void;
}) {
  const hasModelName = form.modelName.trim().length > 0;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="w-[min(94vw,920px)]">
        <Dialog.Header>
          <Dialog.Title>
            {selectedEntry ? tr('upstreamCostPricing.reference.editEntry') : tr('upstreamCostPricing.reference.newEntry')}
          </Dialog.Title>
          <Dialog.Description>
            {selectedEntry?.id || tr('upstreamCostPricing.reference.entryEditorDescription')}
          </Dialog.Description>
        </Dialog.Header>
        <div className="mt-4">
          <ReferenceEntryEditor form={form} onChange={onChange} />
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('common.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!hasModelName || saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tr('common.save')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ReferenceImportDialog({
  open,
  value,
  saving,
  fileInputRef,
  onOpenChange,
  onChange,
  onFileChange,
  onMerge,
  onReplace,
}: {
  open: boolean;
  value: string;
  saving: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onMerge: () => void;
  onReplace: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="w-[min(94vw,760px)]">
        <Dialog.Header>
          <Dialog.Title>{tr('upstreamCostPricing.reference.importTitle')}</Dialog.Title>
          <Dialog.Description>{tr('upstreamCostPricing.reference.importDescription')}</Dialog.Description>
        </Dialog.Header>
        <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={saving}>
              <Upload className="size-4" />
              {tr('upstreamCostPricing.reference.importFromFile')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
          <JsonCodeEditor
            minHeight={280}
            maxHeight={520}
            value={value}
            onChange={onChange}
            placeholder='[{"provider":"openai","modelName":"gpt-4o","inputPerMillion":5,"outputPerMillion":15}]'
            ariaLabel={tr('upstreamCostPricing.reference.importTitle')}
          />
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('common.cancel')}
          </Button>
          <Button type="button" variant="outline" onClick={onMerge} disabled={!value.trim() || saving}>
            <Upload className="size-4" />
            {tr('upstreamCostPricing.reference.importMerge')}
          </Button>
          <Button type="button" onClick={onReplace} disabled={!value.trim() || saving}>
            <Upload className="size-4" />
            {tr('upstreamCostPricing.reference.importReplace')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ReferenceSyncDialog({
  open,
  config,
  saving,
  onOpenChange,
  onChange,
  onSave,
  onSync,
}: {
  open: boolean;
  config: PricingReferenceConfig | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (updater: (current: PricingReferenceConfig | null) => PricingReferenceConfig | null) => void;
  onSave: () => void;
  onSync: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="w-[min(94vw,680px)]">
        <Dialog.Header>
          <Dialog.Title>{tr('upstreamCostPricing.reference.syncSettings')}</Dialog.Title>
          <Dialog.Description>{tr('upstreamCostPricing.reference.syncSettingsDescription')}</Dialog.Description>
        </Dialog.Header>
        <div className="mt-4">
          {config ? (
            <ReferenceSyncPanel
              config={config}
              onChange={onChange}
            />
          ) : (
            <CostCatalogDialogLoadingSkeleton />
          )}
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tr('common.cancel')}
          </Button>
          <Button type="button" variant="outline" onClick={onSync} disabled={!config?.sync.url || saving}>
            <DownloadCloud className="size-4" />
            {tr('upstreamCostPricing.reference.syncNow')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!config || saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tr('common.save')}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function ReferenceSyncPanel({
  config,
  onChange,
}: {
  config: PricingReferenceConfig;
  onChange: (updater: (current: PricingReferenceConfig | null) => PricingReferenceConfig | null) => void;
}) {
  return (
    <div className="grid gap-3">
      <SettingRow
        title={tr('upstreamCostPricing.reference.syncEnabled')}
        description={tr('upstreamCostPricing.reference.syncEnabledHelp')}
        control={(
          <Switch
            className="shrink-0"
            checked={config.sync.enabled}
            onCheckedChange={(enabled) => onChange((current) => updateConfigState(current, { sync: { ...config.sync, enabled } }))}
          />
        )}
      />
      <Field label={tr('upstreamCostPricing.reference.syncUrl')}>
        <Input
          value={config.sync.url}
          onChange={(event) => onChange((current) => updateConfigState(current, { sync: { ...config.sync, url: event.target.value } }))}
          placeholder="https://example.com/pricing-reference.json"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.72fr)]">
        <Field label={tr('upstreamCostPricing.reference.syncCron')}>
          <Input
            value={config.sync.cron}
            onChange={(event) => onChange((current) => updateConfigState(current, { sync: { ...config.sync, cron: event.target.value } }))}
          />
        </Field>
        <SettingRow
          title={tr('upstreamCostPricing.reference.replaceOnSync')}
          description={tr('upstreamCostPricing.reference.replaceOnSyncHelp')}
          control={(
            <Switch
              className="shrink-0"
              checked={config.sync.replaceOnSync}
              onCheckedChange={(replaceOnSync) => onChange((current) => updateConfigState(current, { sync: { ...config.sync, replaceOnSync } }))}
            />
          )}
        />
      </div>
    </div>
  );
}

function ReferenceEntryEditor({
  form,
  onChange,
}: {
  form: ReferenceEntryForm;
  onChange: (patch: Partial<ReferenceEntryForm>) => void;
}) {
  return (
    <div className="grid gap-4">
      <EditorSection>
        <SectionHeader
          title={tr('upstreamCostPricing.reference.identitySection')}
          description={tr('upstreamCostPricing.reference.identitySectionDescription')}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr('upstreamCostPricing.reference.model')}>
            <Input
              value={form.modelName}
              onChange={(event) => onChange({ modelName: event.target.value })}
              placeholder="gpt-4o"
            />
          </Field>
          <Field label={tr('upstreamCostPricing.reference.provider')}>
            <Input
              value={form.provider}
              onChange={(event) => onChange({ provider: event.target.value })}
              placeholder="openai"
            />
          </Field>
          <Field label={tr('upstreamCostPricing.reference.displayName')}>
            <Input
              value={form.displayName}
              onChange={(event) => onChange({ displayName: event.target.value })}
              placeholder="GPT-4o"
            />
          </Field>
          <Field label={tr('upstreamCostPricing.reference.entryId')}>
            <Input
              value={form.id}
              onChange={(event) => onChange({ id: event.target.value })}
              placeholder={tr('upstreamCostPricing.reference.entryIdPlaceholder')}
            />
          </Field>
        </div>
        <Field label={tr('upstreamCostPricing.reference.aliases')}>
          <Input
            value={form.aliases}
            onChange={(event) => onChange({ aliases: event.target.value })}
            placeholder={tr('upstreamCostPricing.reference.aliasesPlaceholder')}
          />
        </Field>
      </EditorSection>

      <EditorSection>
        <SectionHeader
          title={tr('upstreamCostPricing.reference.rateCardSection')}
          description={tr('upstreamCostPricing.reference.rateCardSectionDescription')}
        />
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          <PriceField label={tr('upstreamCostPricing.price.input')} value={form.inputPerMillion} onChange={(value) => onChange({ inputPerMillion: value })} />
          <PriceField label={tr('upstreamCostPricing.price.output')} value={form.outputPerMillion} onChange={(value) => onChange({ outputPerMillion: value })} />
          <PriceField label={tr('upstreamCostPricing.price.cacheRead')} value={form.cacheReadPerMillion} onChange={(value) => onChange({ cacheReadPerMillion: value })} />
          <PriceField label={tr('upstreamCostPricing.price.cacheWrite')} value={form.cacheWritePerMillion} onChange={(value) => onChange({ cacheWritePerMillion: value })} />
          <PriceField label={tr('upstreamCostPricing.price.reasoning')} value={form.reasoningPerMillion} onChange={(value) => onChange({ reasoningPerMillion: value })} />
          <PriceField label={tr('upstreamCostPricing.price.requestFee')} value={form.requestUsd} onChange={(value) => onChange({ requestUsd: value })} />
        </div>
      </EditorSection>

      <EditorSection>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader
            title={tr('upstreamCostPricing.reference.advancedPlanSection')}
            description={tr('upstreamCostPricing.reference.advancedPlanSectionDescription')}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghostPrimary" size="sm" asChild>
              <a href={`${SITE_DOCS_URL}/advanced-pricing`} target="_blank" rel="noreferrer">
                {tr('upstreamCostPricing.reference.advancedPlanDocs')}
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Switch
              checked={form.advancedPlanEnabled}
              onCheckedChange={(advancedPlanEnabled) => onChange({ advancedPlanEnabled })}
              aria-label={tr('upstreamCostPricing.reference.advancedPlanSection')}
            />
          </div>
        </div>
        {form.advancedPlanEnabled ? (
          <JsonCodeEditor
            minHeight={180}
            maxHeight={360}
            value={form.planJson}
            onChange={(planJson) => onChange({ planJson })}
            placeholder='{"schemaVersion":1,"planKind":"rate_card","components":[]}'
            ariaLabel={tr('upstreamCostPricing.reference.advancedPlanSection')}
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Code2 className="size-4 shrink-0" />
            <span>{tr('upstreamCostPricing.reference.advancedPlanDisabled')}</span>
          </div>
        )}
      </EditorSection>

      <EditorSection>
        <SectionHeader
          title={tr('upstreamCostPricing.reference.sourceSection')}
          description={tr('upstreamCostPricing.reference.sourceSectionDescription')}
        />
        <Field label={tr('upstreamCostPricing.reference.syncUrl')}>
          <Input
            value={form.sourceUrl}
            onChange={(event) => onChange({ sourceUrl: event.target.value })}
            placeholder="https://example.com/model-pricing"
          />
        </Field>
        <Field label={tr('upstreamCostPricing.notes')}>
          <Textarea
            className="min-h-20"
            value={form.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            placeholder={tr('upstreamCostPricing.notesPlaceholder')}
          />
        </Field>
      </EditorSection>
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: ReactNode;
  description: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
      </div>
      {control}
    </div>
  );
}

function EditorSection({ children }: { children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      {children}
    </section>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
    </div>
  );
}

function PriceField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
        <Input
          className="pl-7"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0"
        />
      </div>
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
