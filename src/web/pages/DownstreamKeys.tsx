import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CenteredModal from '../components/CenteredModal.js';
import DeleteConfirmModal from '../components/DeleteConfirmModal.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import ResponsiveBatchActionBar from '../components/ResponsiveBatchActionBar.js';
import { useToast } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { tr } from '../i18n.js';
import DownstreamKeyEditorModal, {
  TagInput,
  type DownstreamCredentialOption,
  type DownstreamExcludedCredentialRef,
  type DownstreamKeyEditorForm,
  type DownstreamSiteOption,
} from './downstream-keys/DownstreamKeyEditorModal.js';
import DownstreamKeyDrawer from './downstream-keys/DownstreamKeyDrawer.js';
import {
  formatCompactTokens,
  formatIso,
  formatMoney,
  RangeToggle,
  StatusBadge,
  TagChips,
  type Range,
  type SummaryItem,
} from './downstream-keys/shared.js';
import type { RouteSummaryRow } from './token-routes/types.js';
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { Ellipsis, Eye, LoaderCircle, Pencil, Power, PowerOff, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import InfoNote from '../components/InfoNote.js';
import SearchInput from '../components/SearchInput.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import {
  CreateActionButton,
  PageActionBar,
  SecondaryActionButton,
  TableActionBar,
} from '../components/workspace/ActionBar.js';
import { Card } from '../components/ui/card/index.js';
import { Badge } from '../components/ui/badge/index.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { DataTable, DataTableToolbar } from '../components/ui/data-table/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Input } from '../components/ui/input/index.js';
import * as DropdownMenu from '../components/ui/dropdown-menu/index.js';
import {
  getRouteRequestedModelPattern,
  isExactModelPattern,
  isRouteBackendReferences,
  resolveRouteTitle,
} from './token-routes/utils.js';

type Status = 'all' | 'enabled' | 'disabled';

type DownstreamApiKeyItem = {
  id: number;
  name: string;
  key: string;
  keyMasked: string;
  description: string | null;
  groupName: string | null;
  tags: string[];
  enabled: boolean;
  expiresAt: string | null;
  maxCost: number | null;
  usedCost: number;
  maxRequests: number | null;
  usedRequests: number;
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: DownstreamExcludedCredentialRef[];
  lastUsedAt: string | null;
};

type ManagedItem = SummaryItem & {
  key?: string;
};

type RouteSelectorItem = Pick<RouteSummaryRow, 'id' | 'match' | 'backend' | 'presentation' | 'enabled'>;

type DeleteConfirmState =
  | null
  | { mode: 'single'; item: ManagedItem }
  | { mode: 'batch'; ids: number[] };

type TagMatchMode = 'any' | 'all';

type BatchMetadataForm = {
  groupOperation: 'keep' | 'set' | 'clear';
  groupName: string;
  tagOperation: 'keep' | 'append';
  tags: string[];
};

type DefaultRouteSelections = Pick<DownstreamKeyEditorForm, 'selectedModels' | 'selectedGroupRouteIds'>;
function toDateTimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const ts = Date.parse(isoString);
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function routeTitle(route: RouteSelectorItem): string {
  return resolveRouteTitle(route);
}

function isGroupRouteOption(route: RouteSelectorItem): boolean {
  return isRouteBackendReferences(route.backend) || !isExactModelPattern(getRouteRequestedModelPattern(route));
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeTags(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const normalized = value.slice(0, 32);
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(normalized);
    if (result.length >= 20) break;
  }
  return result;
}

function uniqIds(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.trunc(value)))];
}

function buildExcludedCredentialRefKey(ref: DownstreamExcludedCredentialRef): string {
  return ref.kind === 'account_token'
    ? `${ref.kind}:${ref.siteId}:${ref.accountId}:${ref.tokenId}`
    : `${ref.kind}:${ref.siteId}:${ref.accountId}`;
}

function normalizeExcludedSiteIds(values: number[]): number[] {
  return uniqIds(values).sort((left, right) => left - right);
}

function normalizeExcludedCredentialRefs(values: DownstreamExcludedCredentialRef[]): DownstreamExcludedCredentialRef[] {
  const deduped = new Map<string, DownstreamExcludedCredentialRef>();
  for (const value of values) {
    if (!value || !Number.isFinite(value.siteId) || !Number.isFinite(value.accountId)) continue;
    if (value.kind === 'account_token') {
      if (!Number.isFinite(value.tokenId)) continue;
      const normalized: DownstreamExcludedCredentialRef = {
        kind: 'account_token',
        siteId: Math.trunc(value.siteId),
        accountId: Math.trunc(value.accountId),
        tokenId: Math.trunc(value.tokenId),
      };
      deduped.set(buildExcludedCredentialRefKey(normalized), normalized);
      continue;
    }
    const normalized: DownstreamExcludedCredentialRef = {
      kind: 'default_api_key',
      siteId: Math.trunc(value.siteId),
      accountId: Math.trunc(value.accountId),
    };
    deduped.set(buildExcludedCredentialRefKey(normalized), normalized);
  }
  return Array.from(deduped.values()).sort((left, right) => buildExcludedCredentialRefKey(left).localeCompare(buildExcludedCredentialRefKey(right)));
}

function buildDefaultRouteSelections(routeOptions: RouteSelectorItem[]): DefaultRouteSelections {
  return {
    selectedModels: uniqStrings(
      routeOptions
        .filter((item) => !isRouteBackendReferences(item.backend) && isExactModelPattern(getRouteRequestedModelPattern(item)))
        .map((item) => getRouteRequestedModelPattern(item)),
    ).sort((a, b) => a.localeCompare(b)),
    selectedGroupRouteIds: uniqIds(
      routeOptions
        .filter(isGroupRouteOption)
        .map((item) => item.id),
    ),
  };
}

function parseTagText(value: string): string[] {
  return normalizeTags(value.split(/[\r\n,，]+/g));
}

function parseInlineRegex(value: string): RegExp | null {
  const text = value.trim();
  if (!text.startsWith('/') || text.length < 2) return null;
  const lastSlash = text.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const pattern = text.slice(1, lastSlash);
  const flags = text.slice(lastSlash + 1);
  if (!pattern) return null;
  if (!/^[dgimsuvy]*$/i.test(flags)) return null;
  try {
    return new RegExp(pattern, flags || 'i');
  } catch {
    return null;
  }
}

function buildSearchMatcher(search: string): ((haystack: string) => boolean) | null {
  const text = search.trim();
  if (!text) return null;
  const regex = parseInlineRegex(text);
  if (regex) {
    return (haystack: string) => regex.test(haystack);
  }
  const normalized = text.toLowerCase();
  return (haystack: string) => haystack.toLowerCase().includes(normalized);
}

function splitSearchInput(value: string): { textSearch: string; inlineTags: string[] } {
  const raw = value.trim();
  if (!raw) return { textSearch: '', inlineTags: [] };
  if (parseInlineRegex(raw)) return { textSearch: raw, inlineTags: [] };

  const parts = raw.split(/[\r\n,，]+/g).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) return { textSearch: raw, inlineTags: [] };

  return {
    textSearch: '',
    inlineTags: normalizeTags(parts),
  };
}

function tagChipStyle(kind: 'normal' | 'accent' = 'normal'): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    border: '1px solid var(--color-border-light)',
    color: kind === 'accent' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    background: kind === 'accent'
      ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
      : 'var(--color-bg-card)',
  };
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function DownstreamKeyCopyIconButton({ fullKey }: { fullKey: string | undefined }) {
  const toast = useToast();
  const [pressed, setPressed] = useState(false);

  const disabled = !fullKey?.trim();
  const release = () => setPressed(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={tr('pages.downstreamKeys.copyKey')}
      aria-label={tr('pages.downstreamKeys.copyKey')}
      disabled={disabled}
      onMouseDown={() => {
        if (!disabled) setPressed(true);
      }}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={() => {
        if (!disabled) setPressed(true);
      }}
      onTouchEnd={release}
      onTouchCancel={release}
      onClick={async (e) => {
        e.stopPropagation();
        const full = fullKey?.trim();
        if (!full) {
          toast.info(tr('pages.downstreamKeys.keyNotAvailableRefreshRetry'));
          return;
        }
        try {
          await copyToClipboard(full);
          toast.success(tr('pages.downstreamKeys.copy'));
        } catch {
          toast.error(tr('pages.downstreamKeys.copyfailed'));
        }
      }}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    </Button>
  );
}

function buildEditorForm(
  item?: ManagedItem | DownstreamApiKeyItem | null,
  routeOptions: RouteSelectorItem[] = [],
  selectAllByDefault = false,
): DownstreamKeyEditorForm {
  const defaultSelections = selectAllByDefault
    ? buildDefaultRouteSelections(routeOptions)
    : { selectedModels: [], selectedGroupRouteIds: [] };
  const selectedModels = Array.isArray(item?.supportedModels)
    ? item.supportedModels
    : defaultSelections.selectedModels;
  const selectedGroupRouteIds = Array.isArray(item?.allowedRouteIds)
    ? item.allowedRouteIds
    : defaultSelections.selectedGroupRouteIds;

  return {
    name: item?.name || '',
    key: item?.key || '',
    description: item?.description || '',
    groupName: item?.groupName || '',
    tags: normalizeTags(Array.isArray(item?.tags) ? item!.tags : []),
    maxCost: item?.maxCost === null || item?.maxCost === undefined ? '' : String(item.maxCost),
    maxRequests: item?.maxRequests === null || item?.maxRequests === undefined ? '' : String(item.maxRequests),
    expiresAt: toDateTimeLocal(item?.expiresAt),
    enabled: item?.enabled ?? true,
    selectedModels: uniqStrings(selectedModels),
    selectedGroupRouteIds: uniqIds(selectedGroupRouteIds),
    siteWeightMultipliersText: JSON.stringify(item?.siteWeightMultipliers || {}, null, 2),
    excludedSiteIds: normalizeExcludedSiteIds(Array.isArray(item?.excludedSiteIds) ? item.excludedSiteIds : []),
    excludedCredentialRefs: normalizeExcludedCredentialRefs(Array.isArray(item?.excludedCredentialRefs) ? item.excludedCredentialRefs : []),
  };
}

function summarizeModelLimit(models: string[]): string {
  if (!Array.isArray(models) || models.length === 0) return tr('pages.downstreamKeys.model2');
  if (models.length === 1) return models[0];
  return `${models[0]} +${models.length - 1}`;
}

function summarizeRouteLimit(routeIds: number[], routeMap: Map<number, RouteSelectorItem>): string {
  if (!Array.isArray(routeIds) || routeIds.length === 0) return tr('pages.downstreamKeys.groups2');
  const names = routeIds
    .map((id) => routeMap.get(id))
    .filter(Boolean)
    .map((item) => routeTitle(item!));
  if (names.length === 0) return `${routeIds.length} 个群组`;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function summarizeSiteWeightMultipliers(weights: Record<number, number> | undefined): string {
  const entries = Object.entries(weights || {});
  if (entries.length === 0) return tr('pages.downstreamKeys.defaultmultiplier');
  if (entries.length === 1) return `${entries[0][0]} => ${entries[0][1]}`;
  return `${entries[0][0]} => ${entries[0][1]} +${entries.length - 1}`;
}

function summarizeTags(tags: string[]): string {
  if (!Array.isArray(tags) || tags.length === 0) return tr('pages.downstreamKeys.noTags');
  if (tags.length === 1) return tags[0];
  return `${tags[0]} +${tags.length - 1}`;
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-28 gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-sm font-bold text-foreground">{value}</strong>
    </div>
  );
}

function DownstreamKeysLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile) {
    return (
      <div className="grid gap-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <MobileCard
            key={index}
            className={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}
            title={<Skeleton className="h-5 w-40" />}
            headerActions={<Skeleton className="h-5 w-16 rounded-full" />}
          >
            <div className="grid gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-56 max-w-full" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
          </MobileCard>
        ))}
      </div>
    );
  }

  return (
    <DataTable minWidth={1120} density="compact" aria-busy="true">
      <DataTableToolbar className="border-b bg-muted/30 px-4">
        <div className="grid gap-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </DataTableToolbar>
      <Table className="w-full text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[42px]" />
            <TableHead>{tr('pages.downstreamKeys.keyinfo')}</TableHead>
            <TableHead>{tr('pages.downstreamKeys.authorizationScope')}</TableHead>
            <TableHead className="text-right">{tr('pages.downstreamKeys.quota')}</TableHead>
            <TableHead className="text-right">{tr('pages.downstreamKeys.usage')}</TableHead>
            <TableHead>{tr('pages.downstreamKeys.recentUsage')}</TableHead>
            <TableHead className="text-right">{tr('pages.accounts.actions2')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, index) => (
            <TableRow key={index} className={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
              <TableCell><Skeleton className="size-4" /></TableCell>
              <TableCell>
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-44" />
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="grid gap-2">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="size-8" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

function InlineToggle({
  value,
  onChange,
}: {
  value: TagMatchMode;
  onChange: (value: TagMatchMode) => void;
}) {
  const options: Array<{ value: TagMatchMode; label: string }> = [
    { value: 'any', label: tr('pages.downstreamKeys.matchAnyTag') },
    { value: 'all', label: tr('pages.downstreamKeys.matchalltags') },
  ];

  return (
    <ButtonGroup>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={value === option.value ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

export default function DownstreamKeys() {
  const toast = useToast();
  const [range, setRange] = useState<Range>('24h');
  const [status, setStatus] = useState<Status>('all');
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [groupFilter, setGroupFilter] = useState('__all__');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>('any');
  const [summaryItems, setSummaryItems] = useState<SummaryItem[]>([]);
  const [rawItems, setRawItems] = useState<DownstreamApiKeyItem[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteSelectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorForm, setEditorForm] = useState<DownstreamKeyEditorForm>(() => buildEditorForm());
  const [createDefaultsPending, setCreateDefaultsPending] = useState(false);
  const [exclusionSourceLoading, setExclusionSourceLoading] = useState(false);
  const [exclusionSourceLoaded, setExclusionSourceLoaded] = useState(false);
  const [exclusionSiteOptions, setExclusionSiteOptions] = useState<DownstreamSiteOption[]>([]);
  const [exclusionCredentialOptions, setExclusionCredentialOptions] = useState<DownstreamCredentialOption[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);
  const [batchMetadataOpen, setBatchMetadataOpen] = useState(false);
  const [batchMetadataForm, setBatchMetadataForm] = useState<BatchMetadataForm>({
    groupOperation: 'keep',
    groupName: '',
    tagOperation: 'keep',
    tags: [],
  });
  const isMobile = useIsMobile();

  const load = async () => {
    setLoading(true);
    try {
      const [summaryRes, rawRes, routesRes] = await Promise.all([
        api.getDownstreamApiKeysSummary({ range }),
        api.getDownstreamApiKeys(),
        api.getRoutesLite(),
      ]);
      setSummaryItems(Array.isArray(summaryRes?.items) ? summaryRes.items : []);
      setRawItems(Array.isArray(rawRes?.items) ? rawRes.items : []);
      setRouteOptions((Array.isArray(routesRes) ? routesRes : []) as RouteSelectorItem[]);
    } catch (err: any) {
      toast.error(err?.message || tr('pages.downstreamKeys.downstreamKeysFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadExclusionSources = async () => {
    if (exclusionSourceLoading || exclusionSourceLoaded) return;
    setExclusionSourceLoading(true);
    try {
      const [accountsSnapshotRes, tokensRes] = await Promise.all([
        api.getAccountsSnapshot(),
        api.getAccountTokens(),
      ]);

      const accountRows = Array.isArray(accountsSnapshotRes?.accounts)
        ? accountsSnapshotRes.accounts
        : [];
      const tokenRows = Array.isArray(tokensRes) ? tokensRes : [];

      const siteMap = new Map<number, { siteId: number; siteName: string; accountIds: Set<number> }>();
      for (const account of accountRows) {
        const siteId = Number(account?.site?.id);
        const accountId = Number(account?.id);
        if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(accountId) || accountId <= 0) continue;
        const siteName = String(account?.site?.name || `站点 ${siteId}`).trim() || `站点 ${siteId}`;
        if (!siteMap.has(siteId)) {
          siteMap.set(siteId, { siteId, siteName, accountIds: new Set<number>() });
        }
        siteMap.get(siteId)!.accountIds.add(accountId);
      }

      const siteOptions = Array.from(siteMap.values())
        .map((item) => ({
          siteId: item.siteId,
          siteName: item.siteName,
          accountCount: item.accountIds.size,
        }))
        .sort((left, right) => left.siteName.localeCompare(right.siteName));

      const credentialOptions: DownstreamCredentialOption[] = [];
      for (const account of accountRows) {
        const siteId = Number(account?.site?.id);
        const accountId = Number(account?.id);
        const apiToken = String(account?.apiToken || '').trim();
        if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(accountId) || accountId <= 0 || !apiToken) continue;
        credentialOptions.push({
          key: `default_api_key:${siteId}:${accountId}`,
          ref: { kind: 'default_api_key', siteId: Math.trunc(siteId), accountId: Math.trunc(accountId) },
          siteName: String(account?.site?.name || `站点 ${siteId}`).trim() || `站点 ${siteId}`,
          accountName: String(account?.username || `账号 ${accountId}`).trim() || `账号 ${accountId}`,
          label: tr('pages.downstreamKeys.defaultApiKey'),
          detail: `使用账号默认 API Key (${apiToken.slice(0, 6)}...)`,
        });
      }

      for (const token of tokenRows) {
        const siteId = Number(token?.site?.id);
        const accountId = Number(token?.account?.id ?? token?.accountId);
        const tokenId = Number(token?.id);
        if (!Number.isFinite(siteId) || siteId <= 0 || !Number.isFinite(accountId) || accountId <= 0 || !Number.isFinite(tokenId) || tokenId <= 0) continue;
        credentialOptions.push({
          key: `account_token:${siteId}:${accountId}:${tokenId}`,
          ref: { kind: 'account_token', siteId: Math.trunc(siteId), accountId: Math.trunc(accountId), tokenId: Math.trunc(tokenId) },
          siteName: String(token?.site?.name || `站点 ${siteId}`).trim() || `站点 ${siteId}`,
          accountName: String(token?.account?.username || `账号 ${accountId}`).trim() || `账号 ${accountId}`,
          label: String(token?.name || `token-${tokenId}`).trim() || `token-${tokenId}`,
          detail: String(token?.tokenGroup || 'default').trim() || 'default',
        });
      }

      setExclusionSiteOptions(siteOptions);
      setExclusionCredentialOptions(
        credentialOptions.sort((left, right) => (
          `${left.siteName}:${left.accountName}:${left.label}:${left.detail}`.localeCompare(
            `${right.siteName}:${right.accountName}:${right.label}:${right.detail}`,
          )
        )),
      );
      setExclusionSourceLoaded(true);
    } catch (err: any) {
      toast.error(err?.message || tr('pages.downstreamKeys.sitesTokenfailed'));
    } finally {
      setExclusionSourceLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [range]);

  useEffect(() => {
    if (!editorOpen) return;
    void loadExclusionSources();
  }, [editorOpen]);

  const rawItemMap = useMemo(() => new Map(rawItems.map((item) => [item.id, item])), [rawItems]);
  const routeMap = useMemo(() => new Map(routeOptions.map((item) => [item.id, item])), [routeOptions]);

  const managedItems = useMemo<ManagedItem[]>(() => (
    summaryItems.map((item) => {
      const raw = rawItemMap.get(item.id);
      return {
        ...item,
        key: raw?.key,
        keyMasked: raw?.keyMasked || item.keyMasked,
        description: raw?.description ?? item.description,
        groupName: raw?.groupName ?? item.groupName,
        tags: raw?.tags ?? item.tags,
        enabled: raw?.enabled ?? item.enabled,
        expiresAt: raw?.expiresAt ?? item.expiresAt,
        maxCost: raw?.maxCost ?? item.maxCost,
        usedCost: raw?.usedCost ?? item.usedCost,
        maxRequests: raw?.maxRequests ?? item.maxRequests,
        usedRequests: raw?.usedRequests ?? item.usedRequests,
        supportedModels: raw?.supportedModels ?? item.supportedModels,
        allowedRouteIds: raw?.allowedRouteIds ?? item.allowedRouteIds,
        siteWeightMultipliers: raw?.siteWeightMultipliers ?? item.siteWeightMultipliers,
        excludedSiteIds: raw?.excludedSiteIds ?? item.excludedSiteIds,
        excludedCredentialRefs: raw?.excludedCredentialRefs ?? item.excludedCredentialRefs,
        lastUsedAt: raw?.lastUsedAt ?? item.lastUsedAt,
      };
    })
  ), [rawItemMap, summaryItems]);

  const groupSuggestions = useMemo(
    () => uniqStrings(managedItems.map((item) => item.groupName || '')).sort((a, b) => a.localeCompare(b)),
    [managedItems],
  );

  const tagSuggestions = useMemo(
    () => uniqStrings(managedItems.flatMap((item) => item.tags || [])).sort((a, b) => a.localeCompare(b)),
    [managedItems],
  );

  const groupFilterOptions = useMemo(
    () => [
      { value: '__all__', label: tr('pages.downstreamKeys.allprimaryGroup') },
      { value: '__ungrouped__', label: tr('pages.downstreamKeys.ungrouped') },
      ...groupSuggestions.map((group) => ({ value: group, label: group })),
    ],
    [groupSuggestions],
  );

  const parsedSearch = useMemo(() => splitSearchInput(deferredSearch), [deferredSearch]);
  const activeTagFilters = useMemo(
    () => normalizeTags([...selectedTags, ...parsedSearch.inlineTags]),
    [parsedSearch.inlineTags, selectedTags],
  );
  const searchMatcher = useMemo(() => buildSearchMatcher(parsedSearch.textSearch), [parsedSearch.textSearch]);

  const visibleItems = useMemo(() => managedItems.filter((item) => {
    if (status === 'enabled' && !item.enabled) return false;
    if (status === 'disabled' && item.enabled) return false;
    if (groupFilter === '__ungrouped__' && item.groupName) return false;
    if (groupFilter !== '__all__' && groupFilter !== '__ungrouped__' && item.groupName !== groupFilter) return false;
    if (activeTagFilters.length > 0) {
      const itemTags = new Set((item.tags || []).map((tag) => tag.toLowerCase()));
      const matches = tagMatchMode === 'all'
        ? activeTagFilters.every((tag) => itemTags.has(tag.toLowerCase()))
        : activeTagFilters.some((tag) => itemTags.has(tag.toLowerCase()));
      if (!matches) return false;
    }
    if (!searchMatcher) return true;
    const haystack = [
      item.name,
      item.description || '',
      item.keyMasked,
      item.groupName || '',
      ...(item.tags || []),
      ...(item.supportedModels || []),
      ...((item.allowedRouteIds || []).map((id) => {
        const route = routeMap.get(id);
        return route ? routeTitle(route) : String(id);
      })),
    ].join(' ');
    return searchMatcher(haystack);
  }).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const lastA = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const lastB = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    if (lastA !== lastB) return lastB - lastA;
    return a.name.localeCompare(b.name);
  }), [activeTagFilters, groupFilter, managedItems, routeMap, searchMatcher, status, tagMatchMode]);

  const visibleIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const selectedVisibleCount = useMemo(() => selectedIds.filter((id) => visibleIds.includes(id)).length, [selectedIds, visibleIds]);
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => managedItems.some((item) => item.id == id)));
    setSelectedId((current) => (current && managedItems.some((item) => item.id === current) ? current : null));
  }, [managedItems]);

  const selectedItem = useMemo(
    () => managedItems.find((item) => item.id === selectedId) || null,
    [managedItems, selectedId],
  );

  const editingItem = useMemo(
    () => managedItems.find((item) => item.id === editingId) || null,
    [editingId, managedItems],
  );

  const statusOptions = useMemo(() => [
    { value: 'all', label: tr('pages.downstreamKeys.allstatus') },
    { value: 'enabled', label: tr('pages.downstreamKeys.enabled2') },
    { value: 'disabled', label: tr('pages.downstreamKeys.disabled2') },
  ], []);

  const totals = useMemo(() => visibleItems.reduce((acc, item) => {
    acc.tokens += Number(item.rangeUsage?.totalTokens || 0);
    acc.requests += Number(item.rangeUsage?.totalRequests || 0);
    acc.cost += Number(item.rangeUsage?.totalCost || 0);
    if (item.enabled) acc.enabled += 1;
    return acc;
  }, { tokens: 0, requests: 0, cost: 0, enabled: 0 }), [visibleItems]);

  useEffect(() => {
    if (!editorOpen || editingId !== null || !createDefaultsPending) {
      return;
    }

    const defaultSelections = buildDefaultRouteSelections(routeOptions);
    if (defaultSelections.selectedModels.length === 0 && defaultSelections.selectedGroupRouteIds.length === 0) {
      return;
    }

    setEditorForm((prev) => {
      if (prev.selectedModels.length > 0 || prev.selectedGroupRouteIds.length > 0) {
        return prev;
      }
      return {
        ...prev,
        selectedModels: defaultSelections.selectedModels,
        selectedGroupRouteIds: defaultSelections.selectedGroupRouteIds,
      };
    });
    setCreateDefaultsPending(false);
  }, [createDefaultsPending, editorOpen, editingId, routeOptions]);

  const openCreate = () => {
    setEditingId(null);
    setEditorForm(buildEditorForm(null, routeOptions, true));
    setCreateDefaultsPending(true);
    setEditorOpen(true);
  };

  const resetBatchMetadataForm = () => {
    setBatchMetadataForm({
      groupOperation: 'keep',
      groupName: '',
      tagOperation: 'keep',
      tags: [],
    });
  };

  const openEdit = (item: ManagedItem) => {
    setEditingId(item.id);
    setCreateDefaultsPending(false);
    setEditorForm(buildEditorForm(rawItemMap.get(item.id) || item));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setCreateDefaultsPending(false);
    setEditorForm(buildEditorForm());
  };

  const withRowLoading = async (key: string, action: () => Promise<void>) => {
    setRowLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await action();
    } finally {
      setRowLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const saveKey = async () => {
    const name = editorForm.name.trim();
    const key = editorForm.key.trim();
    if (!name) {
      toast.info(tr('pages.downstreamKeys.keyname'));
      return;
    }
    if (!key) {
      toast.info(tr('pages.downstreamKeys.enterDownstreamKey'));
      return;
    }
    if (!key.startsWith('sk-')) {
      toast.info(tr('pages.downstreamKeys.downstreamKeysSk'));
      return;
    }

    let siteWeightMultipliers: Record<number, number> = {};
    const rawWeights = editorForm.siteWeightMultipliersText.trim();
    if (rawWeights && rawWeights !== '{}') {
      try {
        const parsed = JSON.parse(rawWeights);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          toast.info(tr('pages.downstreamKeys.sitesmultiplierJson'));
          return;
        }
        siteWeightMultipliers = Object.fromEntries(
          Object.entries(parsed)
            .map(([siteId, value]) => [Math.trunc(Number(siteId)), Number(value)])
            .filter(([siteId, value]) => Number.isFinite(siteId) && siteId > 0 && Number.isFinite(value) && value > 0),
        ) as Record<number, number>;
      } catch {
        toast.info(tr('pages.downstreamKeys.sitesmultiplierJsonFailed'));
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name,
        key,
        description: editorForm.description.trim(),
        groupName: editorForm.groupName.trim() || null,
        tags: normalizeTags(editorForm.tags),
        enabled: editorForm.enabled,
        expiresAt: editorForm.expiresAt ? new Date(editorForm.expiresAt).toISOString() : null,
        maxCost: editorForm.maxCost.trim() ? Number(editorForm.maxCost.trim()) : null,
        maxRequests: editorForm.maxRequests.trim() ? Number(editorForm.maxRequests.trim()) : null,
        supportedModels: uniqStrings(editorForm.selectedModels),
        allowedRouteIds: uniqIds(editorForm.selectedGroupRouteIds).filter((id) => routeMap.has(id) && isGroupRouteOption(routeMap.get(id)!)),
        siteWeightMultipliers,
        excludedSiteIds: normalizeExcludedSiteIds(editorForm.excludedSiteIds),
        excludedCredentialRefs: normalizeExcludedCredentialRefs(editorForm.excludedCredentialRefs),
      };
      if (editingId) {
        await api.updateDownstreamApiKey(editingId, payload);
        toast.success(tr('pages.downstreamKeys.downstreamKeyUpdated'));
      } else {
        await api.createDownstreamApiKey(payload);
        toast.success(tr('pages.downstreamKeys.downstreamKeyCreated'));
      }
      closeEditor();
      await load();
    } catch (err: any) {
      toast.error(err?.message || tr('pages.downstreamKeys.savedownstreamKeysfailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (id: number, checked: boolean) => {
    setSelectedIds((current) => checked ? uniqIds([...current, id]) : current.filter((item) => item !== id));
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelectedIds((current) => uniqIds([...current, ...visibleIds]));
  };

  const batchRun = async (
    action: 'enable' | 'disable' | 'delete' | 'resetUsage' | 'updateMetadata',
    ids: number[],
  ) => {
    if (ids.length === 0) return;
    setBatchActionLoading(true);
    const actionLabel = action === 'enable'
      ? tr('pages.accounts.enabled')
      : action === 'disable'
        ? tr('pages.accounts.disabled')
        : action === 'delete'
          ? tr('pages.accounts.delete2')
          : action === 'resetUsage'
            ? tr('pages.downstreamKeys.clearUsageBatch')
            : tr('pages.downstreamKeys.batchGroup');
    try {
      const payload = action === 'updateMetadata'
        ? {
            ids,
          action,
          groupOperation: batchMetadataForm.groupOperation,
          groupName: batchMetadataForm.groupOperation === 'set' ? batchMetadataForm.groupName.trim() : undefined,
          tagOperation: batchMetadataForm.tagOperation,
          tags: batchMetadataForm.tagOperation === 'append' ? normalizeTags(batchMetadataForm.tags) : undefined,
        }
        : { ids, action };
      const result = await api.batchDownstreamApiKeys(payload as any);
      const successIds = Array.isArray(result?.successIds) ? result.successIds.map((id: unknown) => Number(id)) : [];
      const failedItems = Array.isArray(result?.failedItems) ? result.failedItems : [];
      const failedIds = failedItems.map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id) && id > 0);
      const successCount = successIds.length;
      if (failedIds.length > 0) {
        toast.info(`${actionLabel}完成：成功 ${successCount}，失败 ${failedIds.length}`);
      } else {
        toast.success(`${actionLabel}完成：成功 ${successCount}`);
      }
      setSelectedIds(failedIds);
      if (action === 'updateMetadata' && failedIds.length === 0) {
        setBatchMetadataOpen(false);
        resetBatchMetadataForm();
      }
      await load();
    } catch (err: any) {
      toast.error(err?.message || `${actionLabel}失败`);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const toggleEnabled = async (item: ManagedItem) => {
    await withRowLoading(`toggle-${item.id}`, async () => {
      await api.updateDownstreamApiKey(item.id, { enabled: !item.enabled });
      await load();
      toast.success(item.enabled ? tr('pages.downstreamKeys.disabledKey') : tr('pages.downstreamKeys.enabledKey'));
    });
  };

  const resetUsage = async (item: ManagedItem) => {
    await withRowLoading(`reset-${item.id}`, async () => {
      await api.resetDownstreamApiKeyUsage(item.id);
      await load();
      toast.success(tr('pages.downstreamKeys.keyUsageCleared'));
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const target = deleteConfirm;
    setDeleteConfirm(null);

    if (target.mode === 'single') {
      await withRowLoading(`delete-${target.item.id}`, async () => {
        await api.deleteDownstreamApiKey(target.item.id);
        toast.success(tr('pages.downstreamKeys.downstreamKeysdeleted'));
        await load();
      });
      return;
    }

    await batchRun('delete', target.ids);
  };

  const addTagFilter = (raw: string) => {
    const text = raw.trim();
    if (!text || parseInlineRegex(text)) return;
    const next = normalizeTags([...selectedTags, ...parseTagText(text)]);
    setSelectedTags(next);
  };

  const openBatchMetadata = () => {
    resetBatchMetadataForm();
    setBatchMetadataOpen(true);
  };

  const runBatchMetadata = async () => {
    if (batchMetadataForm.groupOperation === 'set' && !batchMetadataForm.groupName.trim()) {
      toast.info(tr('pages.downstreamKeys.enterBatchPrimaryGroup'));
      return;
    }
    if (batchMetadataForm.tagOperation === 'append' && normalizeTags(batchMetadataForm.tags).length === 0) {
      toast.info(tr('pages.downstreamKeys.enterLeastOneBatchTag'));
      return;
    }
    await batchRun('updateMetadata', selectedIds);
  };

  const filterControls = (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[280px] flex-[1_1_420px] flex-wrap items-center gap-2">
          <SearchInput
            className="flex-[1_1_320px]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tr('pages.downstreamKeys.searchnameNotesModelPrimaryGroupTags')}
          />
          <InlineToggle value={tagMatchMode} onChange={setTagMatchMode} />
        </div>
        <div className="min-w-[170px]">
          <ModernSelect value={status} onChange={(value) => setStatus((value as Status) || 'all')} options={statusOptions} />
        </div>
        <div className="min-w-[170px]">
          <ModernSelect value={groupFilter} onChange={(value) => setGroupFilter(String(value || '__all__'))} options={groupFilterOptions} />
        </div>
        <Button type="button" variant="outline" onClick={() => { setSearchInput(''); setStatus('all'); setGroupFilter('__all__'); setSelectedTags([]); setTagMatchMode('any'); }}>
          {tr('pages.downstreamKeys.resetfilter')}
        </Button>
      </div>

      {(activeTagFilters.length > 0 || tagSuggestions.length > 0) ? (
        <div className="flex flex-wrap gap-1.5">
          {activeTagFilters.map((tag) => {
            const fromPinnedTags = selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase());
            return (
              <Button type="button" variant="outline"
                key={tag}
               
               
                onClick={() => {
                  if (fromPinnedTags) {
                    setSelectedTags((current) => current.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
                    return;
                  }
                  setSearchInput((current) => current
                    .split(/[\r\n,，]+/g)
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .filter((item) => item.toLowerCase() !== tag.toLowerCase())
                    .join(', '));
                }}
              >
                {tag} ×
              </Button>
            );
          })}
          {tagSuggestions.filter((tag) => !activeTagFilters.some((current) => current.toLowerCase() === tag.toLowerCase())).slice(0, 8).map((tag) => (
            <Button type="button" variant="outline" key={tag} onClick={() => addTagFilter(tag)}>
              {tag}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const empty = !loading && visibleItems.length === 0;

  return (
    <PageShell>
      <PageHeader
        title={tr('app.downstreamKeys')}
        description={tr('pages.downstreamKeys.keyPrimaryGroupTagsQuotaModelGroups')}
        actions={(
          <PageActionBar>
            <RangeToggle range={range} onChange={setRange} />
            <SecondaryActionButton
              type="button"
              icon={RotateCcw}
              loading={loading}
              loadingLabel={tr('pages.downstreamKeys.refreshing')}
              onClick={() => void load()}
              disabled={loading}
            >
              {tr('pages.accounts.refresh')}
            </SecondaryActionButton>
            <CreateActionButton
              type="button"
              label={tr('pages.downstreamKeys.newDownstreamKey')}
              onClick={openCreate}
            />
          </PageActionBar>
        )}
      />

      <Card className="flex flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">{tr('pages.downstreamKeys.rangeOverview')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tr('pages.downstreamKeys.filterViewingkeyUsageCost')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tr('pages.downstreamKeys.currentRange')}</Badge>
            <Badge variant="success">
              {range === '24h' ? tr('pages.downstreamKeys.24Hours') : range === '7d' ? tr('pages.downstreamKeys.7Days') : tr('pages.downstreamKeys.all')}
            </Badge>
            <Badge variant="warning">
              Tokens {formatCompactTokens(totals.tokens)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <SummaryMetric label={tr('pages.downstreamKeys.visibleKey')} value={String(visibleItems.length)} />
          <SummaryMetric label={tr('pages.downstreamKeys.enabledCount')} value={String(totals.enabled)} />
          <SummaryMetric label={tr('pages.downstreamKeys.selectedCount')} value={String(selectedIds.length)} />
          <SummaryMetric label={tr('components.charts.downstreamKeyTrendChart.requests')} value={totals.requests.toLocaleString()} />
          <SummaryMetric label={tr('pages.downstreamKeys.cost')} value={formatMoney(totals.cost)} />
          <SummaryMetric label={tr('pages.downstreamKeys.filterstatus')} value={statusOptions.find((item) => item.value === status)?.label || tr('pages.downstreamKeys.allstatus')} />
        </div>
      </Card>

      {isMobile && selectedIds.length > 0 ? (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={`已选 ${selectedIds.length} 个密钥`}
        >
          <Button type="button" variant="outline" onClick={openBatchMetadata} disabled={batchActionLoading}>{isMobile ? tr('pages.downstreamKeys.groupTags') : tr('pages.downstreamKeys.batchGroupTags')}</Button>
          <Button type="button" variant="outline" onClick={() => void batchRun('enable', selectedIds)} disabled={batchActionLoading}>{isMobile ? tr('pages.downstreamKeys.enabled') : tr('pages.accounts.enabled')}</Button>
          <Button type="button" variant="outline" onClick={() => void batchRun('disable', selectedIds)} disabled={batchActionLoading}>{isMobile ? tr('pages.downstreamKeys.disabled') : tr('pages.accounts.disabled')}</Button>
          <Button type="button" variant="outline" onClick={() => void batchRun('resetUsage', selectedIds)} disabled={batchActionLoading}>{isMobile ? tr('pages.downstreamKeys.clear') : tr('pages.downstreamKeys.clearUsageBatch')}</Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteConfirm({ mode: 'batch', ids: [...selectedIds] })} disabled={batchActionLoading}>{isMobile ? tr('pages.accounts.delete3') : tr('pages.accounts.delete2')}</Button>
        </ResponsiveBatchActionBar>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{tr('pages.downstreamKeys.filter')}</div>
              <div className="mt-1 text-xs text-muted-foreground">{tr('pages.downstreamKeys.nameStatusPrimaryGroupTagsDownstreamKeys')}</div>
            </div>
            {isMobile && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setShowFilters(true)}>
                  {tr('components.mobileFilterSheet.filter')}
                </Button>
                <Button type="button" variant="outline"
                 
                 
                  onClick={() => toggleSelectAllVisible(!allVisibleSelected)}
                >
                  {allVisibleSelected ? tr('pages.accounts.cancelselectAll') : tr('pages.downstreamKeys.selectVisible')}
                </Button>
              </div>
            )}
          </div>
          <ResponsiveFilterPanel
            isMobile={isMobile}
            mobileOpen={showFilters}
            onMobileClose={() => setShowFilters(false)}
            mobileTitle={tr('pages.downstreamKeys.filterdownstreamKeys')}
            mobileContent={filterControls}
            desktopContent={filterControls}
          />
        </div>

        {loading ? (
          <DownstreamKeysLoadingSkeleton isMobile={isMobile} />
        ) : empty ? (
          <EmptyStateBlock title={tr('pages.downstreamKeys.noDownstreamKeys')} description={tr('pages.downstreamKeys.itemskeyFilteritemsViewing')} />
        ) : isMobile ? (
          <div className="grid gap-3">
            {visibleItems.map((row, index) => {
              const loadingToggle = !!rowLoading[`toggle-${row.id}`];
              const loadingReset = !!rowLoading[`reset-${row.id}`];
              const loadingDelete = !!rowLoading[`delete-${row.id}`];
              const checked = selectedIds.includes(row.id);
              return (
                <MobileCard
                  key={row.id}
                  className={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}
                  title={row.name}
                  headerActions={(
                    <div className="flex items-center gap-2">
                      <StatusBadge enabled={row.enabled} />
                      <Checkbox
                       
                        aria-label={`选择 ${row.name}`}
                        checked={checked}
                        onCheckedChange={(checked) => toggleSelection(row.id, checked === true)}          />
                    </div>
                  )}
                  footerActions={(
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedId(row.id); setDrawerOpen(true); }}>{tr('pages.downstreamKeys.viewing')}</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>{tr('pages.accounts.edit')}</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void toggleEnabled(row)} disabled={loadingToggle}>{loadingToggle ? tr('pages.downstreamKeys.processing') : (row.enabled ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled'))}</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void resetUsage(row)} disabled={loadingReset}>{loadingReset ? tr('pages.downstreamKeys.processing') : tr('pages.downstreamKeys.clearUsage')}</Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteConfirm({ mode: 'single', item: row })} disabled={loadingDelete}>{loadingDelete ? tr('pages.downstreamKeys.processing') : tr('pages.accounts.delete3')}</Button>
                    </>
                  )}
                >
                  <MobileField
                    label={tr('pages.downstreamKeys.key')}
                    value={(
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">{row.keyMasked}</span>
                        <DownstreamKeyCopyIconButton fullKey={row.key} />
                      </span>
                    )}
                    stacked
                  />
                  {row.description ? <MobileField label={tr('pages.downstreamKeys.notes')} value={row.description} stacked /> : null}
                  <MobileField label={tr('pages.downstreamKeys.primaryGroup')} value={row.groupName || tr('pages.downstreamKeys.ungrouped')} />
                  <MobileField label={tr('pages.downstreamKeys.tags2')} value={summarizeTags(row.tags || [])} stacked />
                  <MobileField label={tr('components.modelAnalysisPanel.model')} value={summarizeModelLimit(row.supportedModels || [])} stacked />
                  <MobileField label={tr('pages.downstreamKeys.groups')} value={summarizeRouteLimit(row.allowedRouteIds || [], routeMap)} stacked />
                  <MobileField label={tr('pages.downstreamKeys.multiplier2')} value={summarizeSiteWeightMultipliers(row.siteWeightMultipliers || {})} stacked />
                  <MobileField label={tr('pages.downstreamKeys.quota')} value={`${row.maxRequests == null ? tr('pages.downstreamKeys.unlimited') : row.maxRequests.toLocaleString()} / ${row.maxCost == null ? tr('pages.downstreamKeys.costunlimited') : formatMoney(row.maxCost)}`} stacked />
                  <MobileField label={tr('pages.downstreamKeys.usage')} value={`${(row.rangeUsage?.totalRequests || 0).toLocaleString()} 请求 · ${formatCompactTokens(row.rangeUsage?.totalTokens || 0)}`} stacked />
                  <MobileField label={tr('pages.downstreamKeys.recentUsage')} value={formatIso(row.lastUsedAt)} stacked />
                </MobileCard>
              );
            })}
          </div>
        ) : (
          <DataTable minWidth={1120} density="compact">
            <DataTableToolbar className="border-b bg-muted/30 px-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {selectedIds.length > 0
                    ? `已选 ${selectedIds.length} 个密钥 / 共 ${visibleItems.length} 个`
                    : `${visibleItems.length} 个密钥`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tr('pages.downstreamKeys.nameStatusPrimaryGroupTagsDownstreamKeys')}
                </div>
              </div>
              <TableActionBar>
                {selectedIds.length > 0 ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={openBatchMetadata} disabled={batchActionLoading}>
                      <Tags className="size-4" />
                      <span className="sr-only">{tr('pages.downstreamKeys.batchGroupTags')}</span>
                      {tr('pages.downstreamKeys.groupTags')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void batchRun('enable', selectedIds)} disabled={batchActionLoading}>
                      <Power className="size-4" />
                      {tr('pages.accounts.enabled')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void batchRun('disable', selectedIds)} disabled={batchActionLoading}>
                      <PowerOff className="size-4" />
                      {tr('pages.accounts.disabled')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void batchRun('resetUsage', selectedIds)} disabled={batchActionLoading}>
                      <RotateCcw className="size-4" />
                      {tr('pages.downstreamKeys.clearUsageBatch')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds([])} disabled={batchActionLoading}>
                      {tr('pages.accounts.cancelselectAll')}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteConfirm({ mode: 'batch', ids: [...selectedIds] })} disabled={batchActionLoading}>
                      <Trash2 className="size-4" />
                      {tr('pages.accounts.delete2')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => toggleSelectAllVisible(true)} disabled={visibleItems.length === 0}>
                    {tr('pages.downstreamKeys.selectVisible')}
                  </Button>
                )}
              </TableActionBar>
            </DataTableToolbar>
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42px]">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)} />
                  </TableHead>
                  <TableHead>{tr('pages.downstreamKeys.keyinfo')}</TableHead>
                  <TableHead>{tr('pages.downstreamKeys.authorizationScope')}</TableHead>
                  <TableHead className="text-right">{tr('pages.downstreamKeys.quota')}</TableHead>
                  <TableHead className="text-right">{tr('pages.downstreamKeys.usage')}</TableHead>
                  <TableHead>{tr('pages.downstreamKeys.recentUsage')}</TableHead>
                  <TableHead className="text-right">{tr('pages.accounts.actions2')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((row, index) => {
                  const loadingToggle = !!rowLoading[`toggle-${row.id}`];
                  const loadingReset = !!rowLoading[`reset-${row.id}`];
                  const loadingDelete = !!rowLoading[`delete-${row.id}`];
                  const checked = selectedIds.includes(row.id);
                  return (
                    <TableRow
                      key={row.id}
                      className={`animate-slide-up stagger-${Math.min(index + 1, 5)} row-selectable ${checked ? 'row-selected' : ''}`.trim()}
                      data-state={checked ? 'selected' : undefined}
                      onClick={() => { setSelectedId(row.id); setDrawerOpen(true); }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={checked} onCheckedChange={(checked) => toggleSelection(row.id, checked === true)} />
                      </TableCell>
                      <TableCell>
                        <div className="mb-1.5 flex items-center gap-2">
                          <strong className="text-foreground">{row.name}</strong>
                          <StatusBadge enabled={row.enabled} />
                        </div>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{row.keyMasked}</span>
                          <DownstreamKeyCopyIconButton fullKey={row.key} />
                        </div>
                        {row.description ? <div className="max-w-80 text-xs text-muted-foreground">{row.description}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <ToneBadge tone={row.groupName ? 'info' : 'muted'}>
                            {row.groupName ? `主分组 · ${row.groupName}` : tr('pages.downstreamKeys.ungrouped')}
                          </ToneBadge>
                          <TagChips tags={row.tags || []} maxVisible={3} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5">
                          <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.model')}<span className="text-foreground">{summarizeModelLimit(row.supportedModels || [])}</span></div>
                          <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.groups3')}<span className="text-foreground">{summarizeRouteLimit(row.allowedRouteIds || [], routeMap)}</span></div>
                          <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.tags')}<span className="text-foreground">{summarizeTags(row.tags || [])}</span></div>
                          <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.multiplier')}<span className="text-foreground">{summarizeSiteWeightMultipliers(row.siteWeightMultipliers || {})}</span></div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="font-bold text-foreground">{row.maxRequests == null ? tr('pages.downstreamKeys.unlimited') : row.maxRequests.toLocaleString()}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.maxCost == null ? tr('pages.downstreamKeys.costunlimited') : `成本 ${formatMoney(row.maxCost)}`}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.expiresAt ? `到期 ${formatIso(row.expiresAt)}` : tr('pages.downstreamKeys.neverExpires')}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="font-bold text-foreground">{formatCompactTokens(row.rangeUsage?.totalTokens || 0)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{(row.rangeUsage?.totalRequests || 0).toLocaleString()} {tr('pages.downstreamKeys.request')}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.rangeUsage?.successRate == null ? '--' : `成功率 ${row.rangeUsage.successRate}%`}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatIso(row.lastUsedAt)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedId(row.id); setDrawerOpen(true); }}>
                            <Eye className="size-4" />
                            {tr('pages.downstreamKeys.viewing')}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                            <Pencil className="size-4" />
                            {tr('pages.accounts.edit')}
                          </Button>
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <Button type="button" variant="ghost" size="icon" aria-label={tr('pages.accounts.actions2')}>
                                <Ellipsis className="size-4" />
                              </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content align="end">
                              <DropdownMenu.Item onSelect={() => void toggleEnabled(row)} disabled={loadingToggle}>
                                {row.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                                {loadingToggle ? tr('pages.downstreamKeys.processing') : (row.enabled ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled'))}
                              </DropdownMenu.Item>
                              <DropdownMenu.Item onSelect={() => void resetUsage(row)} disabled={loadingReset}>
                                <RotateCcw className="size-4" />
                                {loadingReset ? tr('pages.downstreamKeys.processing') : tr('pages.downstreamKeys.clearUsage')}
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item variant="destructive" onSelect={() => setDeleteConfirm({ mode: 'single', item: row })} disabled={loadingDelete}>
                                <Trash2 className="size-4" />
                                {loadingDelete ? tr('pages.downstreamKeys.processing') : tr('pages.accounts.delete3')}
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Root>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </section>

      <DownstreamKeyEditorModal
        open={editorOpen}
        editingItem={editingItem}
        form={editorForm}
        onChange={(updater) => setEditorForm((prev) => updater(prev))}
        onClose={closeEditor}
        onSave={() => void saveKey()}
        saving={saving}
        routeOptions={routeOptions}
        groupSuggestions={groupSuggestions}
        tagSuggestions={tagSuggestions}
        exclusionSourceLoading={exclusionSourceLoading}
        siteOptions={exclusionSiteOptions}
        credentialOptions={exclusionCredentialOptions}
      />

      <CenteredModal
        open={batchMetadataOpen}
        onClose={() => { setBatchMetadataOpen(false); resetBatchMetadataForm(); }}
        title={tr('pages.downstreamKeys.batchGroupTags2')}
        maxWidth={720}
        bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => { setBatchMetadataOpen(false); resetBatchMetadataForm(); }} disabled={batchActionLoading}>{tr('app.cancel')}</Button>
            <Button type="button" onClick={() => void runBatchMetadata()} disabled={batchActionLoading}>
              {batchActionLoading ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.downstreamKeys.applySelectedKeys')}
            </Button>
          </>
        )}
      >
        <InfoNote>
          {tr('pages.downstreamKeys.selectedActionPrefix')} {selectedIds.length} {tr('pages.downstreamKeys.keySettingsprimaryGroupAppendTagsModelGroups')}
        </InfoNote>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.primaryGroupactions')}</div>
            <ModernSelect
              value={batchMetadataForm.groupOperation}
              onChange={(value) => setBatchMetadataForm((prev) => ({ ...prev, groupOperation: String(value) as BatchMetadataForm['groupOperation'] }))}
              options={[
                { value: 'keep', label: tr('pages.downstreamKeys.doNotChangePrimaryGroup') },
                { value: 'set', label: tr('pages.downstreamKeys.setAllPrimaryGroup') },
                { value: 'clear', label: tr('pages.downstreamKeys.clearprimaryGroup') },
              ]}
            />
            <Input
              value={batchMetadataForm.groupName}
              onChange={(e) => setBatchMetadataForm((prev) => ({ ...prev, groupName: e.target.value }))}
              disabled={batchMetadataForm.groupOperation !== 'set'}
              placeholder={tr('pages.downstreamKeys.vip')}
              list="downstream-group-suggestions"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.tagsactions')}</div>
            <ModernSelect
              value={batchMetadataForm.tagOperation}
              onChange={(value) => setBatchMetadataForm((prev) => ({ ...prev, tagOperation: String(value) as BatchMetadataForm['tagOperation'] }))}
              options={[
                { value: 'keep', label: tr('pages.downstreamKeys.doNotChangeTags') },
                { value: 'append', label: tr('pages.downstreamKeys.appendTags') },
              ]}
            />
            <div className={batchMetadataForm.tagOperation === 'append' ? '' : 'pointer-events-none opacity-60'}>
              <TagInput
                tags={batchMetadataForm.tags}
                onChange={(tags) => setBatchMetadataForm((prev) => ({ ...prev, tags }))}
                suggestions={tagSuggestions}
                placeholder={tr('pages.downstreamKeys.appendTagsBatch')}
              />
            </div>
          </div>
        </div>
      </CenteredModal>

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => void confirmDelete()}
        title={tr('pages.downstreamKeys.deletedownstreamKeys')}
        confirmText={tr('components.deleteConfirmModal.delete')}
        loading={batchActionLoading || (deleteConfirm?.mode === 'single' && !!rowLoading[`delete-${deleteConfirm.item.id}`])}
        description={deleteConfirm?.mode === 'single'
          ? <>{tr('pages.downstreamKeys.deletekey')} <strong>{deleteConfirm.item.name}</strong> {tr('pages.accounts.textqcmnqj')}</>
          : <>{tr('pages.accounts.confirmDeleteSelectedPrefix')} <strong>{deleteConfirm?.ids.length || 0}</strong> {tr('pages.downstreamKeys.keys')}</>}
      />

      <DownstreamKeyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={selectedItem}
        initialRange={range}
      />
    </PageShell>
  );
}
