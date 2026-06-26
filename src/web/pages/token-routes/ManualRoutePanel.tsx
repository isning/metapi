import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BrandGlyph, InlineBrandIcon, hashColor, type BrandInfo } from '../../components/BrandIcon.js';
import CenteredModal from '../../components/CenteredModal.js';
import ModernSelect from '../../components/ModernSelect.js';
import SearchInput from '../../components/SearchInput.js';
import { tr } from '../../i18n.js';
import type { RouteEndpointCatalogItem, RouteIconOption, RouteSummaryRow } from './types.js';
import type { RouteRoutingStrategy } from './types.js';
import { Button } from '../../components/ui/button/index.js';
import { ArrowDown, ArrowUp, Braces, Download, LoaderCircle, Settings2, Trash2, X } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select/index.js';
import {
  routeGraphNodeToEditorForm,
  getCandidateSelectorEndpointIds,
  routeEndpointIdFromRouteId,
  stringifyRouteGraphJson,
  updateCandidateSelectorMacroFromEditor,
  validateRouteGraphNodeDraft,
  type RouteGraphEditorForm,
  type RouteGraphSnapshotNode,
} from './routeGraphSnapshot.js';
import { FilterOperationsEditor } from './NodeForm.js';
import type { RouteFilter } from './routeGraphTypes.js';
import {
  ROUTE_ICON_NONE_VALUE,
  getModelPatternError,
  getRouteBackendRouteIds,
  getRouteDisplayIcon,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  isExactModelPattern,
  isRouteIconNoneValue,
  isRouteBackendReferences,
  matchesModelPattern,
  normalizeRouteDisplayIconValue,
  resolveEndpointTypeIconModel,
  resolveRouteBrand,
  resolveRouteTitle,
  siteAvatarLetters,
} from './utils.js';

type RouteEditorForm = RouteGraphEditorForm;
type RouteWizardStep = 'type' | 'match' | 'backend' | 'options' | 'review';
type SourcePickerItem = {
  endpointId: string;
  routeIds: number[];
  label: string;
  modelPattern: string;
  brand: BrandInfo | null;
  endpointKind: RouteEndpointCatalogItem['endpointKind'] | 'route';
  exposure: RouteEndpointCatalogItem['exposure'] | null;
  resolutionStatus: RouteEndpointCatalogItem['resolutionStatus'] | 'resolved';
  ownerKind: RouteEndpointCatalogItem['ownerKind'] | 'route';
  sourceKind: RouteEndpointCatalogItem['sourceKind'] | 'route';
  enabled: boolean;
  displayIcon: string | null;
  upstreamModels: string[];
  siteNames: string[];
  endpointTypes: string[];
  targetCount: number;
  selectable: boolean;
};

type ManualRoutePanelProps = {
  show: boolean;
  editingRouteId: number | null;
  form: RouteEditorForm;
  setForm: Dispatch<SetStateAction<RouteEditorForm>>;
  saving: boolean;
  canSave: boolean;
  routeIconSelectOptions: RouteIconOption[];
  modelMatchPreviewEndpoints: RouteEndpointCatalogItem[];
  exactSourceRouteOptions: RouteSummaryRow[];
  routeEndpointCatalog?: RouteEndpointCatalogItem[];
  sourceEndpointTypesByRouteId: Record<number, string[]>;
  currentRouteNodeJson?: RouteGraphSnapshotNode | null;
  onSave: () => void;
  onCancel: () => void;
};

function renderRouteOptionLabel(route: RouteSummaryRow): string {
  return resolveRouteTitle(route);
}

function getEndpointMatchModelNames(endpoint: RouteEndpointCatalogItem): string[] {
  const names = [
    endpoint.modelPattern,
    ...(endpoint.upstreamModels || []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (names.length === 0) {
    const fallback = String(endpoint.label || endpoint.publicModelName || endpoint.endpointId || '').trim();
    if (fallback) names.push(fallback);
  }
  return Array.from(new Set(names));
}

function endpointMatchesModelPattern(endpoint: RouteEndpointCatalogItem, pattern: string): boolean {
  return getEndpointMatchModelNames(endpoint)
    .some((modelName) => matchesModelPattern(modelName, pattern));
}

function formatPreviewEndpointLabel(endpoint: RouteEndpointCatalogItem): string {
  const modelName = getEndpointMatchModelNames(endpoint)[0] || endpoint.label || endpoint.endpointId;
  const siteNames = Array.from(new Set((endpoint.siteNames || [])
    .map((siteName) => String(siteName || '').trim())
    .filter(Boolean)));
  if (siteNames.length === 0) return modelName;
  const suffix = siteNames.length > 1 ? ` +${siteNames.length - 1}` : '';
  return `${modelName} @ ${siteNames[0]}${suffix}`;
}

export function toggleSourceRouteId(sourceRouteIds: number[], routeId: number): number[] {
  if (sourceRouteIds.includes(routeId)) {
    return sourceRouteIds.filter((id) => id !== routeId);
  }
  return [...sourceRouteIds, routeId];
}

export function moveSourceRouteId(sourceRouteIds: number[], routeId: number, direction: -1 | 1): number[] {
  const index = sourceRouteIds.indexOf(routeId);
  if (index < 0) return sourceRouteIds;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sourceRouteIds.length) return sourceRouteIds;
  const next = [...sourceRouteIds];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

function toggleSourceEndpointId(sourceEndpointIds: string[], endpointId: string): string[] {
  if (sourceEndpointIds.includes(endpointId)) {
    return sourceEndpointIds.filter((id) => id !== endpointId);
  }
  return [...sourceEndpointIds, endpointId];
}

function moveSourceEndpointId(sourceEndpointIds: string[], endpointId: string, direction: -1 | 1): string[] {
  const index = sourceEndpointIds.indexOf(endpointId);
  if (index < 0) return sourceEndpointIds;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sourceEndpointIds.length) return sourceEndpointIds;
  const next = [...sourceEndpointIds];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
}) {
  return (
    <SearchInput
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

function FilterChip({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className="max-w-full gap-2 overflow-hidden"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined ? <ToneBadge tone="-muted">{count}</ToneBadge> : null}
    </Button>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export const WIZARD_STEPS: Array<{ id: RouteWizardStep; label: string; detail: string }> = [
  { id: 'type', label: tr('pages.tokenRoutes.manualRoutePanel.routeMode'), detail: tr('pages.tokenRoutes.manualRoutePanel.chooseRouteMode') },
  { id: 'match', label: tr('pages.tokenRoutes.manualRoutePanel.entry'), detail: tr('pages.tokenRoutes.manualRoutePanel.entryRule') },
  { id: 'backend', label: tr('pages.tokenRoutes.manualRoutePanel.candidates'), detail: tr('pages.tokenRoutes.manualRoutePanel.candidatesOrTargets') },
  { id: 'options', label: tr('pages.tokenRoutes.manualRoutePanel.routingOptions'), detail: tr('pages.tokenRoutes.manualRoutePanel.visibilityAndStrategy') },
  { id: 'review', label: tr('pages.tokenRoutes.manualRoutePanel.confirm'), detail: tr('pages.tokenRoutes.manualRoutePanel.reviewBeforeSave') },
];

export function getWizardStepIndex(step: RouteWizardStep): number {
  return Math.max(0, WIZARD_STEPS.findIndex((item) => item.id === step));
}

export default function ManualRoutePanel({
  show,
  editingRouteId,
  form,
  setForm,
  saving,
  canSave,
  routeIconSelectOptions,
  modelMatchPreviewEndpoints,
  exactSourceRouteOptions,
  routeEndpointCatalog = [],
  sourceEndpointTypesByRouteId,
  currentRouteNodeJson,
  onSave,
  onCancel,
}: ManualRoutePanelProps) {
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourcePickerSelection, setSourcePickerSelection] = useState<string[]>([]);
  const [activeSourceBrand, setActiveSourceBrand] = useState<string | null>(null);
  const [activeSourceSite, setActiveSourceSite] = useState<string | null>(null);
  const [activeSourceEndpointType, setActiveSourceEndpointType] = useState<string | null>(null);
  const [jsonPanelOpen, setJsonPanelOpen] = useState(false);
  const [nodeJsonDraft, setNodeJsonDraft] = useState('');
  const [nodeJsonMessage, setNodeJsonMessage] = useState('');
  const [wizardStep, setWizardStep] = useState<RouteWizardStep>('type');

  useEffect(() => {
    if (!show) {
      setShowSourcePicker(false);
      setSourceSearch('');
      setSourcePickerSelection([]);
      setActiveSourceBrand(null);
      setActiveSourceSite(null);
      setActiveSourceEndpointType(null);
      setJsonPanelOpen(false);
      setNodeJsonDraft('');
      setNodeJsonMessage('');
      setWizardStep('type');
    } else if (editingRouteId !== null) {
      setWizardStep('match');
    } else {
      setWizardStep('match');
    }
  }, [editingRouteId, show]);

  const backendKind = form.backend.kind;
  const displayName = form.presentation.displayName;
  const displayIcon = form.presentation.displayIcon;
  const modelPattern = form.match.requestedModelPattern;
  const sourceRouteIds = form.backend.kind === 'routes' ? form.backend.routeIds : [];
  const sourceEndpointIds = useMemo(() => {
    const macroEndpointIds = form.backend.kind === 'routes' ? getCandidateSelectorEndpointIds(form.macro || null) : [];
    return macroEndpointIds.length > 0 ? macroEndpointIds : sourceRouteIds.map(routeEndpointIdFromRouteId);
  }, [form.backend.kind, form.macro, sourceRouteIds]);

  const modelPatternError = useMemo(
    () => getModelPatternError(modelPattern),
    [modelPattern],
  );

  const routeIconOptionValues = useMemo(
    () => new Set(routeIconSelectOptions.map((option) => option.value)),
    [routeIconSelectOptions],
  );

  const routeIconSelectValue = routeIconOptionValues.has(normalizeRouteDisplayIconValue(displayIcon))
    ? normalizeRouteDisplayIconValue(displayIcon)
    : '';

  const previewMatchedEndpoints = useMemo(() => {
    const normalizedPattern = modelPattern.trim();
    if (!normalizedPattern || modelPatternError) return [] as RouteEndpointCatalogItem[];
    return modelMatchPreviewEndpoints.filter((endpoint) => endpointMatchesModelPattern(endpoint, normalizedPattern));
  }, [modelMatchPreviewEndpoints, modelPattern, modelPatternError]);

  const selectableSourceRouteOptions = useMemo(
    () => exactSourceRouteOptions,
    [exactSourceRouteOptions],
  );

  const sourceRouteBrandById = useMemo(() => {
    const next = new Map<number, BrandInfo | null>();
    for (const route of selectableSourceRouteOptions) {
      next.set(route.id, resolveRouteBrand(route));
    }
    return next;
  }, [selectableSourceRouteOptions]);

  const sourceRouteById = useMemo(
    () => new Map(selectableSourceRouteOptions.map((route) => [route.id, route])),
    [selectableSourceRouteOptions],
  );

  const sourceEndpointItems = useMemo<SourcePickerItem[]>(() => {
    const catalogRouteIds = new Set(
      routeEndpointCatalog
        .flatMap((endpoint) => [endpoint.routeId, ...(endpoint.sourceRouteIds || [])])
        .map((routeId) => Number(routeId))
        .filter((routeId) => Number.isFinite(routeId) && routeId > 0)
        .map((routeId) => Math.trunc(routeId)),
    );

    const routeItems = selectableSourceRouteOptions
      .filter((route) => !catalogRouteIds.has(route.id))
      .map((route): SourcePickerItem => {
        const label = renderRouteOptionLabel(route);
        return {
          endpointId: routeEndpointIdFromRouteId(route.id),
          routeIds: [route.id],
          label,
          modelPattern: getRouteRequestedModelPattern(route),
          brand: sourceRouteBrandById.get(route.id) || null,
          endpointKind: 'route',
          exposure: route.visibility || null,
          resolutionStatus: 'resolved',
          ownerKind: 'route',
          sourceKind: 'route',
          enabled: route.enabled,
          displayIcon: getRouteDisplayIcon(route),
          upstreamModels: [getRouteRequestedModelPattern(route)].filter(Boolean),
          siteNames: route.siteNames || [],
          endpointTypes: sourceEndpointTypesByRouteId[route.id] || [],
          targetCount: route.targetCount,
          selectable: true,
        };
      });

    const catalogItems = routeEndpointCatalog.map((endpoint): SourcePickerItem => {
      const routeIds = Array.from(new Set(
        [endpoint.routeId, ...(endpoint.sourceRouteIds || [])]
          .map((routeId) => Number(routeId))
          .filter((routeId) => Number.isFinite(routeId) && routeId > 0)
          .map((routeId) => Math.trunc(routeId)),
      ));
      const primaryRoute = routeIds.map((routeId) => sourceRouteById.get(routeId)).find(Boolean) || null;
      const label = endpoint.label || endpoint.publicModelName || endpoint.modelPattern || endpoint.endpointId;
      return {
        endpointId: endpoint.endpointId,
        routeIds,
        label,
        modelPattern: endpoint.modelPattern || (primaryRoute ? getRouteRequestedModelPattern(primaryRoute) : ''),
        brand: primaryRoute ? sourceRouteBrandById.get(primaryRoute.id) || null : null,
        endpointKind: endpoint.endpointKind,
        exposure: endpoint.exposure,
        resolutionStatus: endpoint.resolutionStatus,
        ownerKind: endpoint.ownerKind,
        sourceKind: endpoint.sourceKind,
        enabled: endpoint.enabled,
        displayIcon: endpoint.displayIcon,
        upstreamModels: endpoint.upstreamModels || [],
        siteNames: endpoint.siteNames || primaryRoute?.siteNames || [],
        endpointTypes: endpoint.tags || [],
        targetCount: Number.isFinite(Number(endpoint.targetCount))
          ? Math.max(0, Math.trunc(Number(endpoint.targetCount)))
          : (primaryRoute?.targetCount || routeIds.length),
        selectable: routeIds.length > 0 && endpoint.resolutionStatus !== 'unresolved',
      };
    });

    const byEndpointId = new Map<string, SourcePickerItem>();
    for (const item of routeItems) byEndpointId.set(item.endpointId, item);
    for (const item of catalogItems) byEndpointId.set(item.endpointId, item);
    return Array.from(byEndpointId.values());
  }, [routeEndpointCatalog, selectableSourceRouteOptions, sourceEndpointTypesByRouteId, sourceRouteBrandById, sourceRouteById]);

  const sourceBrandList = useMemo(() => {
    const grouped = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;

    for (const item of sourceEndpointItems) {
      const brand = item.brand;
      if (!brand) {
        otherCount += 1;
        continue;
      }
      const existing = grouped.get(brand.name);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(brand.name, { count: 1, brand });
      }
    }

    return {
      list: [...grouped.entries()].sort((a, b) => {
        if (a[1].count === b[1].count) {
          return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
        }
        return b[1].count - a[1].count;
      }) as [string, { count: number; brand: BrandInfo }][],
      otherCount,
    };
  }, [sourceEndpointItems]);

  const sourceSiteList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const item of sourceEndpointItems) {
      const seenSites = new Set<string>();
      for (const siteName of item.siteNames || []) {
        const normalizedSite = String(siteName || '').trim();
        if (!normalizedSite || seenSites.has(normalizedSite)) continue;
        seenSites.add(normalizedSite);
        grouped.set(normalizedSite, (grouped.get(normalizedSite) || 0) + 1);
      }
    }

    return [...grouped.entries()].sort((a, b) => {
      if (a[1] === b[1]) {
        return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
      }
      return b[1] - a[1];
    }) as [string, number][];
  }, [sourceEndpointItems]);

  const sourceEndpointTypeList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const item of sourceEndpointItems) {
      const endpointTypes = item.endpointTypes || [];
      for (const endpointType of endpointTypes) {
        const normalizedType = String(endpointType || '').trim();
        if (!normalizedType) continue;
        grouped.set(normalizedType, (grouped.get(normalizedType) || 0) + 1);
      }
    }

    return [...grouped.entries()].sort((a, b) => {
      if (a[1] === b[1]) {
        return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
      }
      return b[1] - a[1];
    }) as [string, number][];
  }, [sourceEndpointItems]);

  const filteredSourceItems = useMemo(() => {
    let list = [...sourceEndpointItems];

    if (activeSourceBrand) {
      if (activeSourceBrand === '__other__') {
        list = list.filter((item) => !item.brand);
      } else {
        list = list.filter((item) => (item.brand?.name || '') === activeSourceBrand);
      }
    }

    if (activeSourceSite) {
      list = list.filter((item) => (item.siteNames || []).includes(activeSourceSite));
    }

    if (activeSourceEndpointType) {
      list = list.filter((item) => (item.endpointTypes || []).includes(activeSourceEndpointType));
    }

    const normalizedSearch = sourceSearch.trim().toLowerCase();
    if (normalizedSearch) {
      list = list.filter((item) => {
        const label = item.label.toLowerCase();
        const routePattern = item.modelPattern.toLowerCase();
        const brandName = (item.brand?.name || '').toLowerCase();
        const siteText = (item.siteNames || []).join(' ').toLowerCase();
        const endpointTypes = (item.endpointTypes || []).join(' ').toLowerCase();
        const endpointText = [
          item.endpointId,
          item.endpointKind,
          item.ownerKind,
          item.sourceKind,
          ...item.upstreamModels,
        ].join(' ').toLowerCase();
        return (
          label.includes(normalizedSearch)
          || routePattern.includes(normalizedSearch)
          || brandName.includes(normalizedSearch)
          || siteText.includes(normalizedSearch)
          || endpointTypes.includes(normalizedSearch)
          || endpointText.includes(normalizedSearch)
        );
      });
    }

    return list.sort((a, b) => {
      if (a.endpointKind === b.endpointKind) {
        if (a.targetCount === b.targetCount) {
          return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
        }
        return b.targetCount - a.targetCount;
      }
      return a.endpointKind === 'route_product' ? -1 : 1;
    });
  }, [
    activeSourceBrand,
    activeSourceEndpointType,
    activeSourceSite,
    sourceEndpointItems,
    sourceSearch,
  ]);

  const selectedSourceItems = useMemo(() => {
    const itemById = new Map(sourceEndpointItems.map((item) => [item.endpointId, item]));
    return sourceEndpointIds
      .map((endpointId) => itemById.get(endpointId))
      .filter((item): item is SourcePickerItem => !!item);
  }, [sourceEndpointItems, sourceEndpointIds]);

  const sourceItemByEndpointId = useMemo(
    () => new Map(sourceEndpointItems.map((item) => [item.endpointId, item])),
    [sourceEndpointItems],
  );

  const getRouteIdsForSourceEndpointIds = (endpointIds: string[]): number[] => Array.from(new Set(
    endpointIds.flatMap((endpointId) => sourceItemByEndpointId.get(endpointId)?.routeIds || []),
  ));

  const sourcePickerSelectionSet = useMemo(
    () => new Set(sourcePickerSelection),
    [sourcePickerSelection],
  );
  const activeSourceFilterCount = [
    activeSourceBrand,
    activeSourceSite,
    activeSourceEndpointType,
  ].filter(Boolean).length;
  const macroFilterOperations = useMemo<RouteFilter[]>(() => {
    const filters = form.macro?.config?.filters;
    return filters && Array.isArray(filters.operations) ? filters.operations : [];
  }, [form.macro]);
  const updateMacroFilterOperations = (operations: RouteFilter[]) => {
    setForm((current) => {
      if (!current.macro) return current;
      const nextConfig = { ...current.macro.config };
      if (operations.length > 0) {
        nextConfig.filters = { operations };
      } else {
        delete nextConfig.filters;
      }
      return {
        ...current,
        macro: {
          ...current.macro,
          config: nextConfig,
        },
      };
    });
  };
  const clearSourceFilters = () => {
    setActiveSourceBrand(null);
    setActiveSourceSite(null);
    setActiveSourceEndpointType(null);
  };

  const applySourceEndpointIdsToForm = (endpointIds: string[]) => {
    const routeIds = getRouteIdsForSourceEndpointIds(endpointIds);
    setForm((current) => ({
      ...current,
      backend: { kind: 'routes', routeIds },
      macro: updateCandidateSelectorMacroFromEditor({
        macro: current.macro || currentRouteNodeJson?.macro || null,
        id: currentRouteNodeJson?.id,
        stableId: currentRouteNodeJson?.macro?.id || currentRouteNodeJson?.stableId,
        displayName: current.presentation.displayName.trim() || current.match.displayName || displayName.trim() || 'model-group',
        displayIcon: current.presentation.displayIcon,
        visibility: current.visibility,
        enabled: current.enabled,
        routingStrategy: current.routingStrategy,
        routeIds,
        endpointIds,
      }),
    }));
  };

  const autoBrandIconEnabled = !isRouteIconNoneValue(displayIcon);
  const hasExplicitIconValue = !!normalizeRouteDisplayIconValue(displayIcon);

  const currentFormNodeJson = useMemo<RouteGraphSnapshotNode>(() => {
    let modelMapping: Record<string, string> | null = null;
    if (form.modelMapping.trim()) {
      try {
        const parsed = JSON.parse(form.modelMapping) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          modelMapping = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter(([, value]) => typeof value === 'string' && value.trim())
              .map(([key, value]) => [key, String(value).trim()]),
          );
        }
      } catch {
        modelMapping = null;
      }
    }
    return {
      ...(currentRouteNodeJson?.id ? { id: currentRouteNodeJson.id } : {}),
      ...(currentRouteNodeJson?.stableId ? { stableId: currentRouteNodeJson.stableId } : {}),
      ownership: 'manual',
      visibility: form.visibility,
      enabled: form.enabled,
      match: {
        kind: 'model',
        requestedModelPattern: backendKind === 'routes' ? '' : modelPattern.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      },
      presentation: {
        displayName: displayName.trim() || null,
        displayIcon: normalizeRouteDisplayIconValue(displayIcon) || null,
      },
      backend: backendKind === 'routes'
        ? { kind: 'routes', routeIds: sourceRouteIds }
        : { kind: 'supply' },
      ...(backendKind === 'routes' && displayName.trim() ? {
        macro: updateCandidateSelectorMacroFromEditor({
          macro: form.macro || currentRouteNodeJson?.macro || null,
          id: currentRouteNodeJson?.id,
          stableId: currentRouteNodeJson?.macro?.id || currentRouteNodeJson?.stableId,
          displayName: displayName.trim(),
          displayIcon,
          visibility: form.visibility,
          enabled: form.enabled,
          routingStrategy: form.routingStrategy,
          routeIds: sourceRouteIds,
        }),
      } : {}),
      routingStrategy: form.routingStrategy,
      modelMapping,
    };
  }, [backendKind, currentRouteNodeJson, displayIcon, displayName, form.enabled, form.modelMapping, form.routingStrategy, form.visibility, modelPattern, sourceRouteIds]);

  const saveIssues = useMemo(() => {
    const items: Array<{ label: string; detail: string }> = [];
    if (backendKind === 'routes') {
      if (!displayName.trim()) {
        items.push({
          label: tr('pages.tokenRoutes.manualRoutePanel.publicModelName'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
        });
      }
      if (sourceRouteIds.length === 0) {
        items.push({
          label: tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.notSelected'),
        });
      }
    } else {
      if (!modelPattern.trim() || modelPatternError) {
        items.push({
          label: tr('pages.tokenRoutes.manualRoutePanel.matchRule'),
          detail: modelPatternError || tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
        });
      }
      if (modelPattern.trim() && previewMatchedEndpoints.length === 0 && modelMatchPreviewEndpoints.length > 0 && !isExactModelPattern(modelPattern)) {
        items.push({
          label: tr('pages.tokenRoutes.manualRoutePanel.preview'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.noMatchedPreviewEndpoints'),
        });
      }
    }
    if (form.modelMapping.trim()) {
      try {
        const parsed = JSON.parse(form.modelMapping);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          items.push({
            label: tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'),
            detail: tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'),
          });
        }
      } catch {
        items.push({
          label: tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'),
        });
      }
    }
    return items;
  }, [backendKind, displayName, form.modelMapping, modelMatchPreviewEndpoints.length, modelPattern, modelPatternError, previewMatchedEndpoints.length, sourceRouteIds.length]);

  const routingStrategyLabel = form.routingStrategy === 'round_robin'
    ? tr('pages.oAuthManagement.roundRobin')
    : form.routingStrategy === 'stable_first'
      ? tr('pages.settings.stableFirst')
      : tr('pages.tokenRoutes.manualRoutePanel.weightedRandom');
  const visibilityLabel = form.visibility === 'internal'
    ? tr('pages.tokenRoutes.routeGroupTabs.internal')
    : tr('pages.tokenRoutes.routeGroupTabs.public');
  const routeModeLabel = backendKind === 'routes'
    ? tr('pages.tokenRoutes.manualRoutePanel.modelGroup')
    : tr('pages.tokenRoutes.manualRoutePanel.directTargets');
  const previewMatchSummary = !modelPattern.trim()
    ? tr('pages.tokenRoutes.manualRoutePanel.enterMatchRuleToPreview')
    : modelMatchPreviewEndpoints.length === 0
      ? tr('pages.tokenRoutes.manualRoutePanel.endpointCatalogPreviewUnavailable')
      : previewMatchedEndpoints.length === 0
        ? tr('pages.tokenRoutes.manualRoutePanel.noMatchedPreviewEndpointsShort')
        : tr('pages.tokenRoutes.manualRoutePanel.matchedPreviewEndpoints')
          .replace('{count}', String(previewMatchedEndpoints.length));
  const previewMatchTone = !modelPattern.trim() || modelMatchPreviewEndpoints.length === 0
    ? '-muted'
    : previewMatchedEndpoints.length === 0
      ? '-warning'
      : '-success';
  const previewEndpointRatio = tr('pages.tokenRoutes.manualRoutePanel.previewEndpointRatio')
    .replace('{matched}', String(previewMatchedEndpoints.length))
    .replace('{total}', String(modelMatchPreviewEndpoints.length));
  const previewEndpointOverflowCount = Math.max(0, previewMatchedEndpoints.length - 10);

  const saveSummaryItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (backendKind === 'routes') {
      items.push({
        label: tr('pages.tokenRoutes.manualRoutePanel.publicModelName'),
        value: displayName.trim() || tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
      });
      items.push({
        label: tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes'),
        value: sourceRouteIds.length > 0
          ? tr('pages.tokenRoutes.manualRoutePanel.selectedSourceEndpoints').replace('{count}', String(selectedSourceItems.length))
          : tr('pages.tokenRoutes.manualRoutePanel.notSelected'),
      });
    } else {
      items.push({
        label: tr('pages.tokenRoutes.manualRoutePanel.matchRule'),
        value: modelPattern.trim() || tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
      });
    }
    items.push({
      label: tr('pages.tokenRoutes.manualRoutePanel.visibility'),
      value: visibilityLabel,
    });
    items.push({
      label: tr('pages.settings.routingStrategy'),
      value: routingStrategyLabel,
    });
    if (form.modelMapping.trim()) {
      items.push({
        label: tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'),
        value: saveIssues.some((item) => item.label === tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'))
          ? tr('pages.tokenRoutes.manualRoutePanel.jsonMistake')
          : tr('pages.tokenRoutes.manualRoutePanel.modelMappingWillApply'),
      });
    }
    return items;
  }, [backendKind, displayName, form.modelMapping, modelPattern, routingStrategyLabel, saveIssues, selectedSourceItems.length, sourceRouteIds.length, visibilityLabel]);

  const canGoNext = useMemo(() => {
    if (wizardStep === 'type') return true;
    if (wizardStep === 'match') {
      return backendKind === 'routes'
        ? !!displayName.trim()
        : !!modelPattern.trim() && !modelPatternError;
    }
    if (wizardStep === 'backend') {
      return backendKind === 'supply' || sourceRouteIds.length > 0;
    }
    return true;
  }, [backendKind, displayName, modelPattern, modelPatternError, sourceRouteIds.length, wizardStep]);

  const visibleWizardSteps = useMemo(() => {
    const baseSteps = editingRouteId === null
      ? WIZARD_STEPS
      : WIZARD_STEPS.filter((step) => step.id !== 'type');
    return backendKind === 'supply'
      ? baseSteps.filter((step) => step.id !== 'backend')
      : baseSteps;
  }, [backendKind, editingRouteId]);
  const getVisibleWizardStepIndex = (step: RouteWizardStep): number => {
    const index = visibleWizardSteps.findIndex((item) => item.id === step);
    return Math.max(0, index);
  };
  const currentWizardStep = visibleWizardSteps[getVisibleWizardStepIndex(wizardStep)] || WIZARD_STEPS[getWizardStepIndex(wizardStep)] || WIZARD_STEPS[0]!;

  useEffect(() => {
    if (visibleWizardSteps.some((step) => step.id === wizardStep)) return;
    setWizardStep(visibleWizardSteps[0]?.id || 'match');
  }, [visibleWizardSteps, wizardStep]);

  const setRouteType = (nextKind: 'routes' | 'supply') => {
    setForm((current) => ({
      ...current,
      backend: nextKind === 'routes' ? { kind: 'routes', routeIds: [] } : { kind: 'supply' },
      advancedOpen: nextKind === 'supply',
    }));
    setWizardStep('match');
  };

  const goPreviousStep = () => {
    const index = getVisibleWizardStepIndex(wizardStep);
    setWizardStep(visibleWizardSteps[Math.max(0, index - 1)]!.id);
  };

  const goNextStep = () => {
    const index = getVisibleWizardStepIndex(wizardStep);
    setWizardStep(visibleWizardSteps[Math.min(visibleWizardSteps.length - 1, index + 1)]!.id);
  };

  const openJsonPanel = () => {
    setNodeJsonDraft(stringifyRouteGraphJson(currentFormNodeJson));
    setNodeJsonMessage('');
    setJsonPanelOpen(true);
  };

  const applyNodeJsonDraft = () => {
    try {
      const parsed = JSON.parse(nodeJsonDraft) as unknown;
      const validation = validateRouteGraphNodeDraft(parsed);
      if (!validation.ok) {
        setNodeJsonMessage(validation.message);
        return;
      }
      const next = routeGraphNodeToEditorForm(validation.node);
      setForm((current) => ({
        ...current,
        match: next.match,
        backend: next.backend,
        presentation: next.presentation,
        routingStrategy: next.routingStrategy,
        visibility: next.visibility,
        enabled: next.enabled,
        modelMapping: next.modelMapping,
        advancedOpen: next.advancedOpen,
        macro: next.macro,
      }));
      setNodeJsonDraft(stringifyRouteGraphJson(validation.node));
      setNodeJsonMessage(tr('pages.tokenRoutes.manualRoutePanel.jsonAppliedSave'));
    } catch {
      setNodeJsonMessage(tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'));
    }
  };

  const exportNodeJson = () => {
    const blob = new Blob([stringifyRouteGraphJson(currentFormNodeJson)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `metapi-route-node-${currentFormNodeJson.id || 'draft'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatNodeJsonDraft = () => {
    try {
      const parsed = JSON.parse(nodeJsonDraft) as unknown;
      setNodeJsonDraft(stringifyRouteGraphJson(parsed));
      setNodeJsonMessage(tr('pages.tokenRoutes.manualRoutePanel.jsonFormat'));
    } catch {
      setNodeJsonMessage(tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'));
    }
  };

  const validateNodeJsonDraft = () => {
    try {
      const parsed = JSON.parse(nodeJsonDraft) as unknown;
      const validation = validateRouteGraphNodeDraft(parsed);
      setNodeJsonMessage(validation.ok ? tr('pages.tokenRoutes.manualRoutePanel.json4') : validation.message);
    } catch {
      setNodeJsonMessage(tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'));
    }
  };

  const advancedRouteControls = (
    <div className="grid gap-3 rounded-md border bg-background/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Settings2 className="size-4 text-muted-foreground" />
          {tr('pages.downstreamKeys.downstreamKeyEditorModal.highConfiguration')}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={form.enabled}
            onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked === true }))}
          />
          {tr('pages.tokenRoutes.manualRoutePanel.enabledroutes')}
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.visibility')}</span>
        <Select
          value={form.visibility}
          onValueChange={(nextValue) => setForm((current) => ({
            ...current,
            visibility: nextValue === 'internal' ? 'internal' : 'public',
          }))}
        >
          <SelectTrigger>
            <SelectValue placeholder={tr('pages.tokenRoutes.manualRoutePanel.visibility')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">{tr('pages.tokenRoutes.routeGroupTabs.public')}</SelectItem>
            <SelectItem value="internal">{tr('pages.tokenRoutes.routeGroupTabs.internal')}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{tr('pages.settings.routingStrategy')}</span>
        <ModernSelect
          value={form.routingStrategy}
          onChange={(nextValue) => setForm((current) => ({ ...current, routingStrategy: nextValue as RouteRoutingStrategy }))}
          options={[
            { value: 'weighted', label: tr('pages.tokenRoutes.manualRoutePanel.weightedRandom'), description: tr('pages.tokenRoutes.manualRoutePanel.targetsweightedRandomselect') },
            { value: 'round_robin', label: tr('pages.oAuthManagement.roundRobin'), description: tr('pages.tokenRoutes.manualRoutePanel.availabletargetsSelect') },
            { value: 'stable_first', label: tr('pages.settings.stableFirst'), description: tr('pages.tokenRoutes.manualRoutePanel.selectAvailabletargets') },
          ]}
          placeholder={tr('pages.tokenRoutes.manualRoutePanel.selectRoutingStrategy')}
        />
      </label>

      {backendKind === 'routes' && form.macro ? (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
          <div>
            <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.requestFilters')}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {tr('pages.tokenRoutes.routeGraphWorkbench.macroFilterDescription')}
            </div>
          </div>
          <FilterOperationsEditor
            readonly={false}
            operations={macroFilterOperations}
            onChange={updateMacroFilterOperations}
          />
        </div>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelJson')}</span>
        <JsonCodeEditor
          value={form.modelMapping}
          onChange={(value) => setForm((current) => ({ ...current, modelMapping: value }))}
          placeholder='{"public-model":"upstream-model"}'
          minHeight={160}
          maxHeight={360}
          ariaLabel={tr('pages.tokenRoutes.manualRoutePanel.modelJson')}
        />
        <span className="text-xs leading-relaxed text-muted-foreground">
          {tr('pages.tokenRoutes.manualRoutePanel.modelModel')}
        </span>
      </label>
    </div>
  );

  const openSourcePicker = () => {
    setSourcePickerSelection([...sourceEndpointIds]);
    setSourceSearch('');
    setActiveSourceBrand(null);
    setActiveSourceSite(null);
    setActiveSourceEndpointType(null);
    setShowSourcePicker(true);
  };

  const closeSourcePicker = () => {
    setShowSourcePicker(false);
    setSourceSearch('');
    setActiveSourceBrand(null);
    setActiveSourceSite(null);
    setActiveSourceEndpointType(null);
  };

  const confirmSourcePicker = () => {
    applySourceEndpointIdsToForm(sourcePickerSelection);
    setShowSourcePicker(false);
    setSourceSearch('');
    setActiveSourceBrand(null);
    setActiveSourceSite(null);
    setActiveSourceEndpointType(null);
  };

  const footer = (
    <>
      <Button variant="outline" type="button" onClick={onCancel}>
        {editingRouteId ? tr('pages.tokenRoutes.manualRoutePanel.canceledit') : tr('app.cancel')}
      </Button>
      {getVisibleWizardStepIndex(wizardStep) > 0 && (
        <Button variant="outline" type="button" onClick={goPreviousStep}>
          {tr('pages.tokenRoutes.manualRoutePanel.previousStep')}
        </Button>
      )}
      {currentWizardStep.id !== 'review' && (
        <Button
          type="button"
          onClick={goNextStep}
          disabled={!canGoNext}
        >
          {tr('pages.tokenRoutes.manualRoutePanel.nextStep')}
        </Button>
      )}
      <Button
        type="button"
        onClick={onSave}
        disabled={!canSave}
      >
        {saving ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />{' '}
            {tr('pages.accounts.saving')}
          </>
        ) : (
          editingRouteId ? tr('pages.tokenRoutes.manualRoutePanel.saveRouteGroup') : tr('pages.tokenRoutes.manualRoutePanel.createRouteGroup')
        )}
      </Button>
    </>
  );

  const routeTypeSummary = backendKind === 'routes'
    ? {
      title: tr('pages.tokenRoutes.manualRoutePanel.modelGroupModelgroup'),
      description: tr('pages.tokenRoutes.manualRoutePanel.modelsModelRoutes'),
      badge: tr('pages.tokenRoutes.manualRoutePanel.selectedSourceEndpoints').replace('{count}', String(selectedSourceItems.length)),
    }
    : {
      title: tr('pages.tokenRoutes.manualRoutePanel.directTargets'),
      description: tr('pages.tokenRoutes.manualRoutePanel.exactGlobRegexRulesTargets'),
      badge: modelPattern.trim() || tr('pages.tokenRoutes.manualRoutePanel.matchRule'),
    };

  const typeStepContent = (
    <div className="grid gap-3 md:grid-cols-2">
      <Button
        type="button"
        variant={backendKind === 'routes' ? 'secondary' : 'outline'}
        className="h-auto min-w-0 whitespace-normal grid justify-start gap-2 rounded-md p-3.5 text-left"
        onClick={() => setRouteType('routes')}
      >
        <span className="min-w-0 whitespace-normal break-words text-xs font-medium leading-snug text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.publicAggregation')}</span>
        <span className="min-w-0 whitespace-normal break-words text-sm font-semibold leading-snug">{tr('pages.tokenRoutes.manualRoutePanel.selectSourceEndpoints')}</span>
        <span className="min-w-0 whitespace-normal break-words text-xs leading-relaxed text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelModel2')}</span>
        <span className="min-w-0 whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {tr('pages.tokenRoutes.manualRoutePanel.availableSourceEndpoints').replace('{count}', String(sourceEndpointItems.length))}
        </span>
      </Button>
      <Button
        type="button"
        variant={backendKind === 'supply' ? 'secondary' : 'outline'}
        className="h-auto min-w-0 whitespace-normal grid justify-start gap-2 rounded-md p-3.5 text-left"
        onClick={() => setRouteType('supply')}
      >
        <span className="min-w-0 whitespace-normal break-words text-xs font-medium leading-snug text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.ruleGeneratedTargets')}</span>
        <span className="min-w-0 whitespace-normal break-words text-sm font-semibold leading-snug">{tr('pages.tokenRoutes.manualRoutePanel.matchModelRules')}</span>
        <span className="min-w-0 whitespace-normal break-words text-xs leading-relaxed text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelmatchrulesTargetsSupportedExactGlobRe')}</span>
        <span className="min-w-0 whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {tr('pages.tokenRoutes.manualRoutePanel.generatedTargetsMaintained')}
        </span>
      </Button>
    </div>
  );

  const selectedSourceList = selectedSourceItems.length > 0 ? (
    <div className="grid gap-2 md:grid-cols-2">
      {selectedSourceItems.map((item, index) => {
        const label = item.label;
        const brand = item.brand;
        const siteNames = Array.from(new Set((item.siteNames || []).filter((siteName) => String(siteName || '').trim())));
        const endpointTypes = (item.endpointTypes || []).slice(0, 3);
        const secondaryModel = item.upstreamModels[0] || item.modelPattern;
        return (
          <div
            key={`selected-${item.endpointId}`}
            className="grid min-w-0 gap-2 rounded-md border bg-background/70 p-3"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                {brand ? <BrandGlyph brand={brand} size={18} fallbackText={label} /> : <InlineBrandIcon model={item.modelPattern || label} size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <b className="min-w-0 flex-1 break-all text-sm leading-snug" title={label}>{label}</b>
                  <ToneBadge tone="-info" className="shrink-0 text-xs">
                    {tr('pages.tokenRoutes.manualRoutePanel.sourceCandidate')} #{index + 1}
                  </ToneBadge>
                </div>
                {secondaryModel && secondaryModel !== label ? (
                  <code className="mt-1 block break-all text-xs leading-snug text-muted-foreground" title={secondaryModel}>
                    {secondaryModel}
                  </code>
                ) : null}
                <code className="mt-1 block break-all text-xs leading-snug text-muted-foreground/80" title={item.endpointId}>
                  {item.endpointId}
                </code>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ToneBadge tone="-muted">{item.endpointKind}</ToneBadge>
              <ToneBadge tone="-muted">{item.targetCount} {tr('pages.tokenRoutes.targets')}</ToneBadge>
              {endpointTypes.map((endpointType) => (
                <ToneBadge tone="-muted" key={`selected-${item.endpointId}-${endpointType}`}>
                  {endpointType}
                </ToneBadge>
              ))}
              {siteNames.slice(0, 2).map((siteName) => (
                <ToneBadge tone="-muted" key={`selected-${item.endpointId}-${siteName}`}>
                  {siteName}
                </ToneBadge>
              ))}
              {siteNames.length > 2 ? (
                <ToneBadge tone="-muted">+{siteNames.length - 2}</ToneBadge>
              ) : null}
            </div>

            <div className="flex justify-end gap-1.5 border-t pt-2">
              <Button
                variant="ghostMuted"
                size="icon"
                type="button"
                aria-label={tr('pages.sites.moveUp')}
                data-tooltip={tr('pages.sites.moveUp')}
                disabled={index === 0}
                onClick={() => applySourceEndpointIdsToForm(moveSourceEndpointId(sourceEndpointIds, item.endpointId, -1))}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghostMuted"
                size="icon"
                type="button"
                aria-label={tr('pages.sites.moveDown')}
                data-tooltip={tr('pages.sites.moveDown')}
                disabled={index === selectedSourceItems.length - 1}
                onClick={() => applySourceEndpointIdsToForm(moveSourceEndpointId(sourceEndpointIds, item.endpointId, 1))}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghostDestructive"
                size="icon"
                type="button"
                aria-label={tr('pages.settings.remove')}
                data-tooltip={tr('pages.settings.remove')}
                onClick={() => applySourceEndpointIdsToForm(toggleSourceEndpointId(sourceEndpointIds, item.endpointId))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
      {tr('pages.tokenRoutes.manualRoutePanel.notSelectedModel')}
    </div>
  );

  const directRulePreviewPanel = (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="text-sm font-semibold">{tr('pages.tokenRoutes.manualRoutePanel.rulePreview')}</div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            {tr('pages.tokenRoutes.manualRoutePanel.matchPreviewScopeHint')}
          </div>
        </div>
        <ToneBadge tone={previewMatchTone} className="shrink-0">
          {previewMatchSummary}
        </ToneBadge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-background/70 p-3">
          <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.matchedEndpointCount')}</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
            {modelPattern.trim() && modelMatchPreviewEndpoints.length > 0 ? previewEndpointRatio : '--'}
          </div>
        </div>
        <div className="rounded-md border bg-background/70 p-3">
          <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.generatedTargetSource')}</div>
          <div className="mt-1 text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.availableEndpointCatalog')}</div>
        </div>
      </div>

      {previewMatchedEndpoints.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.matchedEndpointExamples')}</div>
          <div className="flex flex-wrap gap-2">
            {previewMatchedEndpoints.slice(0, 10).map((endpoint) => (
              <span
                key={endpoint.endpointId}
                title={endpoint.endpointId}
                className="inline-flex max-w-full items-center rounded-md border bg-background px-2 py-1 text-xs leading-snug text-foreground"
              >
                <span className="max-w-[240px] truncate">{formatPreviewEndpointLabel(endpoint)}</span>
              </span>
            ))}
            {previewEndpointOverflowCount > 0 ? (
              <ToneBadge tone="-muted">
                {tr('pages.tokenRoutes.manualRoutePanel.moreMatchedEndpoints').replace('{count}', String(previewEndpointOverflowCount))}
              </ToneBadge>
            ) : null}
          </div>
        </div>
      ) : modelPattern.trim() ? (
        <div className="rounded-md border border-dashed bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {modelMatchPreviewEndpoints.length === 0
            ? tr('pages.tokenRoutes.manualRoutePanel.endpointCatalogPreviewUnavailable')
            : tr('pages.tokenRoutes.manualRoutePanel.noMatchedPreviewEndpoints')}
        </div>
      ) : null}
    </div>
  );

  const matchStepContent = backendKind === 'routes' ? (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-medium">
        <span>{tr('pages.tokenRoutes.manualRoutePanel.model3')}</span>
        <Input
          placeholder={tr('pages.tokenRoutes.manualRoutePanel.model3')}
          value={displayName}
          onChange={(event) => setForm((current) => ({
            ...current,
            match: { ...current.match, displayName: event.target.value.trim() ? event.target.value : null },
            presentation: { ...current.presentation, displayName: event.target.value },
          }))}
        />
      </label>
      <div className="text-xs text-muted-foreground">
        {tr('pages.tokenRoutes.manualRoutePanel.publicModelRequestModelGroupRequestedmodelpattern')}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes')}</div>
          <div className="text-xs text-muted-foreground">
            {selectedSourceItems.length > 0
              ? tr('pages.tokenRoutes.manualRoutePanel.selectedSourceModels').replace('{count}', String(selectedSourceItems.length))
              : tr('pages.tokenRoutes.manualRoutePanel.notSelectedModel')}
          </div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('pages.tokenRoutes.manualRoutePanel.selectModel')}
        </Button>
      </div>
      {selectedSourceList}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
         
          checked={autoBrandIconEnabled}
          onCheckedChange={(value) => {
            const checked = value === true;
            setForm((current) => ({
              ...current,
              presentation: {
                ...current.presentation,
                displayIcon: checked
                  ? (isRouteIconNoneValue(current.presentation.displayIcon) ? '' : current.presentation.displayIcon)
                  : ROUTE_ICON_NONE_VALUE,
              },
            }));
          }}
        />
        <span>{tr('pages.tokenRoutes.automaticbrands')}</span>
      </label>
    </div>
  ) : (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('pages.tokenRoutes.manualRoutePanel.displayName')}</span>
          <Input
            placeholder={tr('pages.tokenRoutes.manualRoutePanel.claude46')}
            value={displayName}
            onChange={(event) => setForm((current) => ({
              ...current,
              match: { ...current.match, displayName: event.target.value.trim() ? event.target.value : null },
              presentation: { ...current.presentation, displayName: event.target.value },
            }))}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('pages.settings.modelmatch')}</span>
          <Input
            placeholder={tr('pages.tokenRoutes.manualRoutePanel.modelmatchGpt4oClaudeReClaude')}
            value={modelPattern}
            onChange={(event) => setForm((current) => ({
              ...current,
              match: { ...current.match, requestedModelPattern: event.target.value },
            }))}
          />
        </label>
      </div>
      {modelPatternError ? (
        <div className="text-sm text-destructive">{modelPatternError}</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.manualRoutePanel.exactModelGlobAvailableUsageRe')}
          </div>
          {directRulePreviewPanel}
        </>
      )}
    </div>
  );

  const backendStepContent = backendKind === 'routes' ? (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes')}</div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.manualRoutePanel.selectedOutOfTotal')
              .replace('{selected}', String(selectedSourceItems.length))
              .replace('{total}', String(sourceEndpointItems.length))}
          </div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('pages.tokenRoutes.manualRoutePanel.selectModel')}
        </Button>
      </div>
      <div className="rounded-md border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
        {tr('pages.tokenRoutes.manualRoutePanel.selectedSourceOrderHint')}
      </div>
      {selectedSourceList}
    </div>
  ) : (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.automaticTargetPool')}</div>
      <div className="text-xs text-muted-foreground">
        {tr('pages.tokenRoutes.manualRoutePanel.saveModelavailableSitesrulesRouteEndpointRulespreviewSelect')}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.generatedTargetSource')}</div>
          <div className="mt-1 text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.availableEndpointCatalog')}</div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.status')}</div>
          <div className="mt-1 text-sm font-medium">{form.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}</div>
        </div>
      </div>
    </div>
  );

  const optionsStepContent = (
    <div className="grid gap-3">
      {advancedRouteControls}
      {backendKind === 'routes' && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
           
            checked={autoBrandIconEnabled}
            onCheckedChange={(value) => {
              const checked = value === true;
              setForm((current) => ({
                ...current,
                presentation: {
                  ...current.presentation,
                  displayIcon: checked
                    ? (isRouteIconNoneValue(current.presentation.displayIcon) ? '' : current.presentation.displayIcon)
                    : ROUTE_ICON_NONE_VALUE,
                },
              }));
            }}
          />
          <span>{tr('pages.tokenRoutes.automaticbrands')}</span>
        </label>
      )}
      {backendKind === 'supply' && (
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('pages.tokenRoutes.manualRoutePanel.displayIcon')}</span>
          <ModernSelect
            value={routeIconSelectValue}
            onChange={(nextValue) => setForm((current) => ({
              ...current,
              presentation: { ...current.presentation, displayIcon: nextValue },
            }))}
            options={routeIconSelectOptions}
            placeholder={tr('pages.tokenRoutes.manualRoutePanel.selectbrands')}
            emptyLabel={tr('pages.tokenRoutes.manualRoutePanel.noneBrands')}
          />
        </label>
      )}
    </div>
  );

  const reviewStepContent = (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
        <section className="grid content-start gap-2">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.saveSummary')}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {saveSummaryItems.map((item) => (
              <div key={item.label} className="min-w-0 rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="mt-1 break-words text-sm font-medium">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid content-start gap-2">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.saveCheck')}</div>
          {saveIssues.length === 0 ? (
            <div className="rounded-md border border-success/20 bg-success/10 p-3 text-sm">
              <ToneBadge tone="-success">{tr('pages.tokenRoutes.manualRoutePanel.readyToSave')}</ToneBadge>
            </div>
          ) : (
            <div className="grid gap-2">
              {saveIssues.map((item) => (
                <div key={`${item.label}-${item.detail}`} className="rounded-md border border-destructive/25 bg-destructive/10 p-3">
                  <ToneBadge tone="-danger">{tr('pages.tokenRoutes.manualRoutePanel.needsAttention')}</ToneBadge>
                  <div className="mt-2 break-words text-sm font-medium">{item.label}</div>
                  <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{item.detail}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );

  const wizardContentByStep: Record<RouteWizardStep, ReactNode> = {
    type: typeStepContent,
    match: matchStepContent,
    backend: backendStepContent,
    options: optionsStepContent,
    review: reviewStepContent,
  };

  const sourcePickerFooter = (
    <>
      <Button variant="outline" type="button" onClick={closeSourcePicker}>
        {tr('app.cancel')}
      </Button>
      <Button
        variant="outline"
        type="button"
        onClick={() => setSourcePickerSelection([])}
        disabled={sourcePickerSelection.length === 0}
      >
        {tr('components.notificationPanel.clear')}
      </Button>
      <Button
        type="button"
        onClick={confirmSourcePicker}
      >
        {tr('pages.tokenRoutes.manualRoutePanel.confirmSelectionCount').replace('{count}', String(sourcePickerSelection.length))}
      </Button>
    </>
  );

  return (
    <>
      <CenteredModal
        open={show}
        onClose={onCancel}
        title={editingRouteId ? tr('pages.tokenRoutes.manualRoutePanel.editgroups') : tr('pages.tokenRoutes.createGroup')}
        footer={footer}
        maxWidth={jsonPanelOpen ? 1180 : 960}
        closeOnEscape
      >
        <div className={jsonPanelOpen ? 'grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid min-h-0 gap-4'}>
          <div className="grid min-h-0 gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{routeTypeSummary.title}</div>
                <div className="text-sm text-muted-foreground">{routeTypeSummary.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={exportNodeJson}>
                  <Download />
                  {tr('pages.tokenRoutes.manualRoutePanel.json3')}
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={jsonPanelOpen ? () => setJsonPanelOpen(false) : openJsonPanel}
                >
                  <Braces />
                  {jsonPanelOpen ? tr('pages.tokenRoutes.manualRoutePanel.closeJson') : tr('pages.tokenRoutes.manualRoutePanel.jsonHighEdit')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
              <div className="rounded-md border bg-muted/20 p-2.5">
                <div className="text-xs text-muted-foreground">
                  {backendKind === 'routes'
                    ? tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes')
                    : tr('pages.tokenRoutes.manualRoutePanel.type')}
                </div>
                <div className="mt-1 break-words text-sm font-medium">{routeTypeSummary.badge}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2.5">
                <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.visibility')}</div>
                <div className="mt-1 break-words text-sm font-medium">{visibilityLabel}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2.5">
                <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.routeMode')}</div>
                <div className="mt-1 break-words text-sm font-medium">{routeModeLabel}</div>
              </div>
            </div>

            <div className="grid min-h-0 gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
              <nav className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:content-start lg:overflow-visible lg:pb-0" aria-label={tr('pages.tokenRoutes.manualRoutePanel.routes')}>
                {visibleWizardSteps.map((step, index) => {
                  const active = step.id === currentWizardStep.id;
                  const done = getVisibleWizardStepIndex(wizardStep) > index;
                  return (
                    <Button
                      key={step.id}
                      type="button"
                      variant={active ? 'secondary' : 'outline'}
                      className={`h-auto min-w-36 justify-start rounded-md p-2.5 text-left lg:min-w-0 ${done ? 'opacity-80' : ''}`.trim()}
                      onClick={() => setWizardStep(step.id)}
                    >
                      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs">{index + 1}</span>
                      <span className="grid min-w-0 gap-0.5 text-sm">
                        <strong>{step.label}</strong>
                        <small className="whitespace-normal break-words text-muted-foreground">{step.detail}</small>
                      </span>
                    </Button>
                  );
                })}
              </nav>

              <section className="grid min-w-0 content-start gap-3 rounded-md border bg-background/60 p-4">
                <div className="grid gap-1">
                  <div className="text-sm font-medium">{currentWizardStep.label}</div>
                  <div className="text-xs text-muted-foreground">{currentWizardStep.detail}</div>
                </div>

                {wizardContentByStep[currentWizardStep.id]}
              </section>

            </div>
          </div>

          {jsonPanelOpen && (
            <div className="grid min-h-0 gap-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.json2')}</div>
                  <div className="text-xs text-muted-foreground">
                    {tr('pages.tokenRoutes.manualRoutePanel.editManualFormSave')}
                  </div>
                </div>
              </div>

              <JsonCodeEditor
                value={nodeJsonDraft}
                onChange={(value) => {
                  setNodeJsonDraft(value);
                  setNodeJsonMessage('');
                }}
                minHeight={320}
                maxHeight={640}
              />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={formatNodeJsonDraft}>
                  {tr('pages.tokenRoutes.manualRoutePanel.format')}
                </Button>
                <Button variant="outline" type="button" onClick={validateNodeJsonDraft}>
                  {tr('pages.tokenRoutes.manualRoutePanel.check2')}
                </Button>
                <Button type="button" onClick={applyNodeJsonDraft}>
                  {tr('pages.tokenRoutes.manualRoutePanel.applyDraft')}
                </Button>
              </div>

              {nodeJsonMessage && (
                <div className="text-sm text-muted-foreground">
                  {nodeJsonMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </CenteredModal>

      <CenteredModal
        open={show && showSourcePicker}
        onClose={closeSourcePicker}
        title={tr('pages.tokenRoutes.manualRoutePanel.selectModel')}
        footer={sourcePickerFooter}
        maxWidth={980}
        closeOnEscape
      >
        <div className="grid min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="grid content-start gap-3 rounded-md border bg-muted/20 p-3 lg:max-h-[min(62vh,640px)] lg:overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.sourceFilters')}</div>
                <div className="text-xs text-muted-foreground">
                  {tr('pages.tokenRoutes.manualRoutePanel.selectedSourceModels').replace('{count}', String(sourcePickerSelection.length))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tr('pages.tokenRoutes.manualRoutePanel.candidatesOutOfTotal')
                    .replace('{filtered}', String(filteredSourceItems.length))
                    .replace('{total}', String(sourceEndpointItems.length))}
                </div>
              </div>
              {activeSourceFilterCount > 0 ? (
                <Button
                  variant="ghostMuted"
                  size="icon"
                  type="button"
                  aria-label={tr('pages.tokenRoutes.manualRoutePanel.clearFilters')}
                  data-tooltip={tr('pages.tokenRoutes.manualRoutePanel.clearFilters')}
                  onClick={clearSourceFilters}
                >
                  <X />
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3">
              <FilterRow label={tr('pages.models.brands')}>
                <FilterChip
                  active={!activeSourceBrand}
                  label={tr('components.notificationPanel.all')}
                  count={sourceEndpointItems.length}
                  onClick={() => setActiveSourceBrand(null)}
                />
                {sourceBrandList.list.map(([brandName, { count, brand }]) => (
                  <FilterChip
                    key={brandName}
                    active={activeSourceBrand === brandName}
                    label={brandName}
                    count={count}
                    icon={<BrandGlyph brand={brand} size={12} fallbackText={brandName} />}
                    onClick={() => setActiveSourceBrand(activeSourceBrand === brandName ? null : brandName)}
                  />
                ))}
                {sourceBrandList.otherCount > 0 ? (
                  <FilterChip
                    active={activeSourceBrand === '__other__'}
                    label={tr('pages.models.other')}
                    count={sourceBrandList.otherCount}
                    onClick={() => setActiveSourceBrand(activeSourceBrand === '__other__' ? null : '__other__')}
                  />
                ) : null}
              </FilterRow>

              {sourceSiteList.length > 0 ? (
                <FilterRow label={tr('components.searchModal.sites2')}>
                  <FilterChip
                    active={!activeSourceSite}
                    label={tr('components.notificationPanel.all')}
                    count={sourceEndpointItems.length}
                    onClick={() => setActiveSourceSite(null)}
                  />
                  {sourceSiteList.map(([siteName, count]) => (
                    <FilterChip
                      key={siteName}
                      active={activeSourceSite === siteName}
                      label={siteName}
                      count={count}
                      icon={(
                        <span
                          style={{
                            fontSize: 8,
                            background: hashColor(siteName),
                            color: 'white',
                            borderRadius: 3,
                            padding: '1px 2px',
                            lineHeight: 1,
                          }}
                        >
                          {siteAvatarLetters(siteName)}
                        </span>
                      )}
                      onClick={() => setActiveSourceSite(activeSourceSite === siteName ? null : siteName)}
                    />
                  ))}
                </FilterRow>
              ) : null}

              <FilterRow label={tr('pages.tokenRoutes.manualRoutePanel.capabilities')}>
                <FilterChip
                  active={!activeSourceEndpointType}
                  label={tr('components.notificationPanel.all')}
                  count={sourceEndpointItems.length}
                  onClick={() => setActiveSourceEndpointType(null)}
                />
                {sourceEndpointTypeList.map(([endpointType, count]) => {
                  const iconModel = resolveEndpointTypeIconModel(endpointType);
                  return (
                    <FilterChip
                      key={endpointType}
                      active={activeSourceEndpointType === endpointType}
                      label={endpointType}
                      count={count}
                      icon={iconModel ? <InlineBrandIcon model={iconModel} size={12} /> : <span className="text-xs">⚙</span>}
                      onClick={() => setActiveSourceEndpointType(activeSourceEndpointType === endpointType ? null : endpointType)}
                    />
                  );
                })}
                {sourceEndpointTypeList.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.noneendpointCapabilities')}</span>
                ) : null}
              </FilterRow>
            </div>
          </aside>

          <div className="grid min-h-0 gap-3">
            <div className="grid gap-2">
              <SearchField
                value={sourceSearch}
                onChange={setSourceSearch}
                placeholder={tr('pages.tokenRoutes.manualRoutePanel.searchModel')}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {tr('pages.tokenRoutes.manualRoutePanel.candidatesOutOfTotal')
                    .replace('{filtered}', String(filteredSourceItems.length))
                    .replace('{total}', String(sourceEndpointItems.length))}
                </span>
                <span>
                  {tr('pages.tokenRoutes.manualRoutePanel.selectedSourceModels').replace('{count}', String(sourcePickerSelection.length))}
                </span>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto pr-1 lg:max-h-[min(62vh,640px)]">
              {filteredSourceItems.length === 0 ? (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  {sourceEndpointItems.length === 0
                    ? tr('pages.tokenRoutes.manualRoutePanel.modelRoutes')
                    : tr('pages.tokenRoutes.manualRoutePanel.matchModel')}
                </div>
              ) : (
                <div
                  className="grid grid-cols-1 items-stretch gap-2.5 lg:grid-cols-2"
                >
                  {filteredSourceItems.map((item) => {
                    const selected = sourcePickerSelectionSet.has(item.endpointId);
                    const label = item.label;
                    const brand = item.brand;
                    const endpointTypes = (item.endpointTypes || []).slice(0, 3);
                    const siteNames = Array.from(new Set((item.siteNames || []).filter((siteName) => String(siteName || '').trim())));
                    const secondaryModel = item.upstreamModels[0] || item.modelPattern;

                    return (
                      <Button
                        variant={selected ? 'secondary' : 'outline'}
                        key={item.endpointId}
                        type="button"
                        onClick={() => {
                          if (!item.selectable) return;
                          setSourcePickerSelection((current) => toggleSourceEndpointId(current, item.endpointId));
                        }}
                        disabled={!item.selectable}
                        className="h-auto w-full justify-start p-0 text-left disabled:opacity-70"
                      >
                        <div className="flex w-full flex-col gap-3 px-[15px] py-3.5">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                              <Checkbox
                                checked={selected}
                                aria-readonly="true"
                                className="mt-0.5 pointer-events-none shrink-0 cursor-pointer"
                              />
                              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                                <span className="inline-flex size-[22px] shrink-0 items-center justify-center">
                                  {brand ? <BrandGlyph brand={brand} size={18} fallbackText={label} /> : <InlineBrandIcon model={item.modelPattern || label} size={18} />}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                  <span className="whitespace-normal break-all text-sm font-semibold leading-snug text-foreground" title={label}>
                                    {label}
                                  </span>
                                  {secondaryModel && label !== secondaryModel ? (
                                    <code className="whitespace-normal break-all text-xs leading-snug text-muted-foreground" title={secondaryModel}>
                                      {secondaryModel}
                                    </code>
                                  ) : null}
                                  <code className="whitespace-normal break-all text-xs leading-snug text-muted-foreground/80" title={item.endpointId}>
                                    {item.endpointId}
                                  </code>
                                </div>
                              </div>
                            </div>
                            <ToneBadge tone={selected ? 'info' : item.selectable ? 'muted' : 'warning'} className="shrink-0 text-xs">
                              {selected
                                ? tr('pages.downstreamKeys.selectedCount')
                                : item.selectable
                                  ? tr('pages.tokenRoutes.manualRoutePanel.selectable')
                                  : item.resolutionStatus}
                            </ToneBadge>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <ToneBadge tone="-info">
                              {item.endpointKind}
                            </ToneBadge>
                            <ToneBadge tone="-info">
                              {item.targetCount} {tr('pages.tokenRoutes.targets')}
                            </ToneBadge>
                            <ToneBadge tone="-muted">
                              {siteNames.length} {tr('components.searchModal.sites2')}
                            </ToneBadge>
                            <ToneBadge tone="-muted">
                              {item.sourceKind}
                            </ToneBadge>
                            {endpointTypes.map((endpointType) => (
                              <ToneBadge tone="-muted" key={`${item.endpointId}-${endpointType}`}>
                                {endpointType}
                              </ToneBadge>
                            ))}
                          </div>

                          {siteNames.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {siteNames.slice(0, 3).map((siteName) => (
                                <ToneBadge
                                  tone="-muted"
                                  key={`${item.endpointId}-${siteName}`}
                                >
                                  {siteName}
                                </ToneBadge>
                              ))}
                              {siteNames.length > 3 ? (
                                <ToneBadge tone="-muted">
                                  +{siteNames.length - 3}
                                </ToneBadge>
                              ) : null}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {tr('pages.tokenRoutes.manualRoutePanel.sitesinfo')}
                            </div>
                          )}
                        </div>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </CenteredModal>
    </>
  );
}
