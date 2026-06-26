import { Database, LoaderCircle, RotateCcw, Save, Upload, DownloadCloud } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  PricingReferenceCatalog,
  PricingReferenceCatalogEntry,
  PricingReferenceConfig,
} from '../../api.js';
import { tr } from '../../i18n.js';
import ToneBadge from '../ToneBadge.js';
import { Button } from '../ui/button/index.js';
import { ButtonGroup } from '../ui/button-group/index.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty/index.js';
import { Input } from '../ui/input/index.js';
import { Label } from '../ui/label/index.js';
import { Skeleton } from '../ui/skeleton/index.js';
import { Switch } from '../ui/switch/index.js';
import { Textarea } from '../ui/textarea/index.js';

export type PricingReferenceConfigPanelProps = {
  config: PricingReferenceConfig | null;
  catalog: PricingReferenceCatalog | null;
  selectedEntryId: string | null;
  entryDraft: string;
  importDraft: string;
  loading: boolean;
  saving: boolean;
  onReload: () => void;
  onSaveConfig: () => void;
  onSyncNow: () => void;
  onChange: (patch: Partial<PricingReferenceConfig>) => void;
  onSelectEntry: (entry: PricingReferenceCatalogEntry) => void;
  onEntryDraftChange: (value: string) => void;
  onSaveEntryDraft: () => void;
  onImportDraftChange: (value: string) => void;
  onImportDraft: (replace: boolean) => void;
};

export function ReferencePricingPanel({
  config,
  catalog,
  selectedEntryId,
  entryDraft,
  importDraft,
  loading,
  saving,
  onReload,
  onSaveConfig,
  onSyncNow,
  onChange,
  onSelectEntry,
  onEntryDraftChange,
  onSaveEntryDraft,
  onImportDraftChange,
  onImportDraft,
}: PricingReferenceConfigPanelProps) {
  const selectedEntry = catalog?.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const entryCount = catalog?.entries.length ?? 0;
  return (
    <section className="rounded-lg border bg-card text-card-foreground">
      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{tr('upstreamCostPricing.reference.title')}</h3>
            <ToneBadge tone={entryCount > 0 ? '-success' : '-muted'}>
              {loading ? <LoaderCircle className="size-3 animate-spin" /> : null}
              {loading ? tr('common.loading') : tr('upstreamCostPricing.reference.entryCount').replace('{count}', String(entryCount))}
            </ToneBadge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">
            {tr('upstreamCostPricing.reference.description')}
          </p>
        </div>
        <ButtonGroup className="justify-start sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={loading || saving}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {tr('common.refresh')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onSyncNow} disabled={!config?.sync.url || saving}>
            <DownloadCloud className="size-4" />
            {tr('upstreamCostPricing.reference.syncNow')}
          </Button>
          <Button type="button" variant="default" size="sm" onClick={onSaveConfig} disabled={!config || saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {tr('common.save')}
          </Button>
        </ButtonGroup>
      </div>

      {config && catalog ? (
        <div className="grid gap-3 border-t p-3 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,1fr)]">
          <div className="grid gap-3">
            <div className="grid gap-3 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{tr('upstreamCostPricing.reference.syncSettings')}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr('upstreamCostPricing.reference.syncSettingsDescription')}</div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{tr('upstreamCostPricing.reference.syncEnabled')}</div>
                  <div className="text-xs text-muted-foreground">{tr('upstreamCostPricing.reference.syncEnabledHelp')}</div>
                </div>
                <Switch
                  className="shrink-0"
                  checked={config.sync.enabled}
                  onCheckedChange={(enabled) => onChange({ sync: { ...config.sync, enabled } })}
                />
              </div>
              <Field label={tr('upstreamCostPricing.reference.syncUrl')}>
                <Input
                  value={config.sync.url}
                  onChange={(event) => onChange({ sync: { ...config.sync, url: event.target.value } })}
                  placeholder="https://example.com/pricing-reference.json"
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={tr('upstreamCostPricing.reference.syncCron')}>
                  <Input
                    value={config.sync.cron}
                    onChange={(event) => onChange({ sync: { ...config.sync, cron: event.target.value } })}
                  />
                </Field>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{tr('upstreamCostPricing.reference.replaceOnSync')}</div>
                    <div className="text-xs text-muted-foreground">{tr('upstreamCostPricing.reference.replaceOnSyncHelp')}</div>
                  </div>
                  <Switch
                    className="shrink-0"
                    checked={config.sync.replaceOnSync}
                    onCheckedChange={(replaceOnSync) => onChange({ sync: { ...config.sync, replaceOnSync } })}
                  />
                </div>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground">
                <div>{tr('upstreamCostPricing.reference.lastSyncedAt')}: {config.sync.lastSyncedAt || '-'}</div>
                {config.sync.lastError ? <div className="text-destructive">{config.sync.lastError}</div> : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">{tr('upstreamCostPricing.reference.entries')}</div>
              {catalog.entries.length > 0 ? (
                <div className="max-h-80 divide-y overflow-auto">
                  {catalog.entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`grid w-full gap-1 px-3 py-2 text-left hover:bg-accent ${entry.id === selectedEntryId ? 'bg-accent' : ''}`}
                      onClick={() => onSelectEntry(entry)}
                    >
                      <span className="truncate text-sm font-medium">{entry.displayName || entry.modelName}</span>
                      <span className="truncate text-xs text-muted-foreground">{entry.provider || 'global'} · {entry.sourceType}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty className="p-4">
                  <EmptyHeader>
                    <EmptyTitle>{tr('upstreamCostPricing.reference.noEntries')}</EmptyTitle>
                    <EmptyDescription>{tr('upstreamCostPricing.reference.noEntriesDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{tr('upstreamCostPricing.reference.entryEditor')}</div>
                  <div className="text-xs text-muted-foreground">{selectedEntry ? selectedEntry.id : tr('upstreamCostPricing.reference.noSelection')}</div>
                </div>
                <Button type="button" size="sm" onClick={onSaveEntryDraft} disabled={!entryDraft.trim() || saving}>
                  <Save className="size-4" />
                  {tr('common.save')}
                </Button>
              </div>
              <Textarea
                className="min-h-72 font-mono text-xs"
                value={entryDraft}
                onChange={(event) => onEntryDraftChange(event.target.value)}
                placeholder={tr('upstreamCostPricing.reference.entryDraftPlaceholder')}
              />
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{tr('upstreamCostPricing.reference.importTitle')}</div>
                <div className="text-xs leading-relaxed text-muted-foreground">{tr('upstreamCostPricing.reference.importDescription')}</div>
              </div>
              <Textarea
                className="min-h-40 font-mono text-xs"
                value={importDraft}
                onChange={(event) => onImportDraftChange(event.target.value)}
                placeholder='[{"provider":"openai","modelName":"gpt-4o","inputPerMillion":5,"outputPerMillion":15}]'
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onImportDraft(false)} disabled={!importDraft.trim() || saving}>
                  <Upload className="size-4" />
                  {tr('upstreamCostPricing.reference.importMerge')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onImportDraft(true)} disabled={!importDraft.trim() || saving}>
                  <Upload className="size-4" />
                  {tr('upstreamCostPricing.reference.importReplace')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : loading ? (
        <PanelSkeleton />
      ) : (
        <div className="border-t p-3">
          <Empty className="p-4">
            <EmptyHeader>
              <EmptyTitle>{tr('upstreamCostPricing.reference.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{tr('upstreamCostPricing.reference.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </section>
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

function PanelSkeleton() {
  return (
    <div className="grid gap-3 border-t p-3 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}
