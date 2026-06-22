import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BrandGlyph, InlineBrandIcon, hashColor, type BrandInfo } from '../../components/BrandIcon.js';
import CenteredModal from '../../components/CenteredModal.js';
import ModernSelect from '../../components/ModernSelect.js';
import SearchInput from '../../components/SearchInput.js';
import { tr } from '../../i18n.js';
import type { RouteEndpointCatalogItem, RouteIconOption, RouteSummaryRow } from './types.js';
import type { RouteRoutingStrategy } from './types.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select/index.js';
import {
  routeGraphNodeToEditorForm,
  stringifyRouteGraphJson,
  updateCandidateSelectorMacroFromEditor,
  validateRouteGraphNodeDraft,
  type RouteGraphEditorForm,
  type RouteGraphSnapshotNode,
} from './routeGraphSnapshot.js';
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

type ManualRoutePanelProps = {
  show: boolean;
  editingRouteId: number | null;
  form: RouteEditorForm;
  setForm: Dispatch<SetStateAction<RouteEditorForm>>;
  saving: boolean;
  canSave: boolean;
  routeIconSelectOptions: RouteIconOption[];
  previewModelSamples: string[];
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
      className="gap-2"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
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
  { id: 'type', label: tr('pages.programLogs.type'), detail: tr('pages.tokenRoutes.manualRoutePanel.selectNode') },
  { id: 'match', label: tr('pages.tokenRoutes.manualRoutePanel.match'), detail: tr('pages.tokenRoutes.manualRoutePanel.model') },
  { id: 'backend', label: tr('pages.tokenRoutes.manualRoutePanel.target'), detail: tr('pages.tokenRoutes.manualRoutePanel.backendConnection') },
  { id: 'options', label: tr('pages.oAuthManagement.strategy'), detail: tr('pages.tokenRoutes.manualRoutePanel.displayBehavior') },
  { id: 'review', label: tr('pages.tokenRoutes.manualRoutePanel.check'), detail: tr('pages.tokenRoutes.manualRoutePanel.save') },
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
  previewModelSamples,
  exactSourceRouteOptions,
  routeEndpointCatalog = [],
  sourceEndpointTypesByRouteId,
  currentRouteNodeJson,
  onSave,
  onCancel,
}: ManualRoutePanelProps) {
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourcePickerSelection, setSourcePickerSelection] = useState<number[]>([]);
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
  const editingDirectChannelsNode = editingRouteId !== null && backendKind === 'channels';
  const displayName = form.presentation.displayName;
  const displayIcon = form.presentation.displayIcon;
  const modelPattern = form.match.requestedModelPattern;
  const sourceRouteIds = form.backend.kind === 'routes' ? form.backend.routeIds : [];

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

  const previewMatchedModels = useMemo(() => {
    const normalizedPattern = modelPattern.trim();
    if (!normalizedPattern || modelPatternError) return [] as string[];
    return previewModelSamples.filter((modelName) => matchesModelPattern(modelName, normalizedPattern));
  }, [modelPattern, modelPatternError, previewModelSamples]);

  const catalogRouteIds = useMemo(
    () => new Set(routeEndpointCatalog.map((endpoint) => endpoint.routeId).filter((routeId): routeId is number => Number.isFinite(Number(routeId)))),
    [routeEndpointCatalog],
  );

  const selectableSourceRouteOptions = useMemo(
    () => exactSourceRouteOptions.filter((route) => catalogRouteIds.size === 0 || catalogRouteIds.has(route.id)),
    [catalogRouteIds, exactSourceRouteOptions],
  );

  const sourceRouteBrandById = useMemo(() => {
    const next = new Map<number, BrandInfo | null>();
    for (const route of selectableSourceRouteOptions) {
      next.set(route.id, resolveRouteBrand(route));
    }
    return next;
  }, [selectableSourceRouteOptions]);

  const sourceBrandList = useMemo(() => {
    const grouped = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;

    for (const route of selectableSourceRouteOptions) {
      const brand = sourceRouteBrandById.get(route.id) || null;
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
  }, [selectableSourceRouteOptions, sourceRouteBrandById]);

  const sourceSiteList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const route of selectableSourceRouteOptions) {
      const seenSites = new Set<string>();
      for (const siteName of route.siteNames || []) {
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
  }, [selectableSourceRouteOptions]);

  const sourceEndpointTypeList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const route of selectableSourceRouteOptions) {
      const endpointTypes = sourceEndpointTypesByRouteId[route.id] || [];
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
  }, [selectableSourceRouteOptions, sourceEndpointTypesByRouteId]);

  const filteredSourceRoutes = useMemo(() => {
    let list = [...selectableSourceRouteOptions];

    if (activeSourceBrand) {
      if (activeSourceBrand === '__other__') {
        list = list.filter((route) => !(sourceRouteBrandById.get(route.id) || null));
      } else {
        list = list.filter((route) => (sourceRouteBrandById.get(route.id)?.name || '') === activeSourceBrand);
      }
    }

    if (activeSourceSite) {
      list = list.filter((route) => (route.siteNames || []).includes(activeSourceSite));
    }

    if (activeSourceEndpointType) {
      list = list.filter((route) => (sourceEndpointTypesByRouteId[route.id] || []).includes(activeSourceEndpointType));
    }

    const normalizedSearch = sourceSearch.trim().toLowerCase();
    if (normalizedSearch) {
      list = list.filter((route) => {
        const label = renderRouteOptionLabel(route).toLowerCase();
        const routePattern = getRouteRequestedModelPattern(route).toLowerCase();
        const brandName = (sourceRouteBrandById.get(route.id)?.name || '').toLowerCase();
        const siteText = (route.siteNames || []).join(' ').toLowerCase();
        const endpointTypes = (sourceEndpointTypesByRouteId[route.id] || []).join(' ').toLowerCase();
        return (
          label.includes(normalizedSearch)
          || routePattern.includes(normalizedSearch)
          || brandName.includes(normalizedSearch)
          || siteText.includes(normalizedSearch)
          || endpointTypes.includes(normalizedSearch)
        );
      });
    }

    return list.sort((a, b) => {
      if (a.channelCount === b.channelCount) {
        return renderRouteOptionLabel(a).localeCompare(renderRouteOptionLabel(b), undefined, { sensitivity: 'base' });
      }
      return b.channelCount - a.channelCount;
    });
  }, [
    activeSourceBrand,
    activeSourceEndpointType,
    activeSourceSite,
    selectableSourceRouteOptions,
    sourceEndpointTypesByRouteId,
    sourceRouteBrandById,
    sourceSearch,
  ]);

  const selectedSourceRoutes = useMemo(() => {
    const routeById = new Map(selectableSourceRouteOptions.map((route) => [route.id, route]));
    return sourceRouteIds
      .map((routeId) => routeById.get(routeId))
      .filter((route): route is RouteSummaryRow => !!route);
  }, [selectableSourceRouteOptions, sourceRouteIds]);

  const sourcePickerSelectionSet = useMemo(
    () => new Set(sourcePickerSelection),
    [sourcePickerSelection],
  );
  const selectedSourceRouteIdSet = useMemo(
    () => new Set(sourceRouteIds),
    [sourceRouteIds],
  );

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
        : { kind: 'channels' },
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

  const validationItems = useMemo(() => {
    const items: Array<{ ok: boolean; label: string; detail: string }> = [];
    if (backendKind === 'routes') {
      items.push({
        ok: !!displayName.trim(),
        label: tr('pages.tokenRoutes.manualRoutePanel.publicModelName'),
        detail: displayName.trim() || tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
      });
      items.push({
        ok: sourceRouteIds.length > 0,
        label: tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes'),
        detail: sourceRouteIds.length > 0
          ? tr('pages.tokenRoutes.manualRoutePanel.selectedCount').replace('{count}', String(sourceRouteIds.length))
          : tr('pages.tokenRoutes.manualRoutePanel.notSelected'),
      });
    } else {
      items.push({
        ok: !!modelPattern.trim() && !modelPatternError,
        label: tr('pages.tokenRoutes.manualRoutePanel.matchRule'),
        detail: modelPatternError || modelPattern.trim() || tr('pages.tokenRoutes.manualRoutePanel.notFilled'),
      });
      items.push({
        ok: previewMatchedModels.length > 0 || previewModelSamples.length === 0 || isExactModelPattern(modelPattern),
        label: tr('pages.tokenRoutes.manualRoutePanel.preview'),
        detail: previewModelSamples.length === 0
          ? tr('pages.tokenRoutes.manualRoutePanel.noSamples')
          : tr('pages.tokenRoutes.manualRoutePanel.matchedCount')
            .replace('{matched}', String(previewMatchedModels.length))
            .replace('{total}', String(previewModelSamples.length)),
      });
    }
    if (form.modelMapping.trim()) {
      try {
        const parsed = JSON.parse(form.modelMapping);
        items.push({
          ok: !!parsed && typeof parsed === 'object' && !Array.isArray(parsed),
          label: tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.json'),
        });
      } catch {
        items.push({
          ok: false,
          label: tr('pages.tokenRoutes.manualRoutePanel.modelMappingJson'),
          detail: tr('pages.tokenRoutes.manualRoutePanel.jsonMistake'),
        });
      }
    }
    items.push({
      ok: currentFormNodeJson.ownership === 'manual',
      label: tr('pages.tokenRoutes.manualRoutePanel.ownership'),
      detail: tr('pages.tokenRoutes.manualRoutePanel.manualNode'),
    });
    return items;
  }, [backendKind, currentFormNodeJson.ownership, displayName, form.modelMapping, modelPattern, modelPatternError, previewMatchedModels.length, previewModelSamples.length, sourceRouteIds.length]);

  const canGoNext = useMemo(() => {
    if (wizardStep === 'type') return true;
    if (wizardStep === 'match') {
      return backendKind === 'routes'
        ? !!displayName.trim()
        : !!modelPattern.trim() && !modelPatternError;
    }
    if (wizardStep === 'backend') {
      return backendKind === 'channels' || sourceRouteIds.length > 0;
    }
    return true;
  }, [backendKind, displayName, modelPattern, modelPatternError, sourceRouteIds.length, wizardStep]);

  const setRouteType = (nextKind: 'routes' | 'channels') => {
    setForm((current) => ({
      ...current,
      backend: nextKind === 'routes' ? { kind: 'routes', routeIds: [] } : { kind: 'channels' },
      advancedOpen: nextKind === 'channels',
    }));
    setWizardStep('match');
  };

  const goPreviousStep = () => {
    const index = getWizardStepIndex(wizardStep);
    setWizardStep(WIZARD_STEPS[Math.max(0, index - 1)]!.id);
  };

  const goNextStep = () => {
    const index = getWizardStepIndex(wizardStep);
    setWizardStep(WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, index + 1)]!.id);
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
    <Card>
      <CardContent className="flex flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-foreground">
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
          <span className="text-xs text-muted-foreground">{tr('pages.settings.routesstrategy')}</span>
          <ModernSelect
            value={form.routingStrategy}
            onChange={(nextValue) => setForm((current) => ({ ...current, routingStrategy: nextValue as RouteRoutingStrategy }))}
            options={[
              { value: 'weighted', label: tr('pages.tokenRoutes.manualRoutePanel.weightedRandom'), description: tr('pages.tokenRoutes.manualRoutePanel.channelsweightedRandomselect') },
              { value: 'round_robin', label: tr('pages.oAuthManagement.roundRobin'), description: tr('pages.tokenRoutes.manualRoutePanel.availablechannelsSelect') },
              { value: 'stable_first', label: tr('pages.settings.stableFirst'), description: tr('pages.tokenRoutes.manualRoutePanel.selectAvailablechannels') },
            ]}
            placeholder={tr('pages.tokenRoutes.manualRoutePanel.selectroutesstrategy')}
          />
        </label>

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
      </CardContent>
    </Card>
  );

  const openSourcePicker = () => {
    setSourcePickerSelection([...sourceRouteIds]);
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
    setForm((current) => ({
      ...current,
      backend: { kind: 'routes', routeIds: [...sourcePickerSelection] },
    }));
    setShowSourcePicker(false);
    setSourceSearch('');
    setActiveSourceBrand(null);
    setActiveSourceSite(null);
    setActiveSourceEndpointType(null);
  };

  const footer = (
    <>
      <Button variant="outline"
        type="button"
        onClick={onCancel}
       
       
      >
        {editingRouteId ? tr('pages.tokenRoutes.manualRoutePanel.canceledit') : tr('app.cancel')}
      </Button>
      {getWizardStepIndex(wizardStep) > 0 && (
        <Button variant="outline"
          type="button"
          onClick={goPreviousStep}
         
         
        >
          {tr('pages.tokenRoutes.manualRoutePanel.previousStep')}
        </Button>
      )}
      {wizardStep !== 'review' && (
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
      badge: `${sourceRouteIds.length} sources`,
    }
    : {
      title: tr('pages.tokenRoutes.manualRoutePanel.directChannels'),
      description: tr('pages.tokenRoutes.manualRoutePanel.exactGlobRegexRulesChannels'),
      badge: modelPattern.trim() || tr('pages.tokenRoutes.manualRoutePanel.matchRule'),
    };

  const typeStepContent = (
    <div className="grid gap-3 md:grid-cols-3">
      <Button
        type="button"
        variant={backendKind === 'routes' ? 'secondary' : 'outline'}
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={() => setRouteType('routes')}
      >
        <span className="text-xs font-medium text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelGroup')}</span>
        <span className="text-sm font-semibold">{tr('pages.tokenRoutes.manualRoutePanel.groupRoutes')}</span>
        <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelModel2')}</span>
        <span className="text-xs text-muted-foreground">{selectableSourceRouteOptions.length} {tr('pages.tokenRoutes.manualRoutePanel.availableSources')}</span>
      </Button>
      <Button
        type="button"
        variant={backendKind === 'channels' ? 'secondary' : 'outline'}
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={() => setRouteType('channels')}
      >
        <span className="text-xs font-medium text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.directChannels')}</span>
        <span className="text-sm font-semibold">{tr('pages.tokenRoutes.manualRoutePanel.rulesChannels')}</span>
        <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.modelmatchrulesChannelsSupportedExactGlobRe')}</span>
        <span className="text-xs text-muted-foreground">{previewModelSamples.length} {tr('pages.tokenRoutes.manualRoutePanel.preview2')}</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={openJsonPanel}
      >
        <span className="text-xs font-medium text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.advancedNode')}</span>
        <span className="text-sm font-semibold">{tr('pages.tokenRoutes.manualRoutePanel.json2')}</span>
        <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.importCheckEditManualJson')}</span>
        <span className="text-xs text-muted-foreground">graph-native</span>
      </Button>
    </div>
  );

  const matchStepContent = backendKind === 'routes' ? (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-medium">
        <span>{tr('pages.tokenRoutes.manualRoutePanel.model3')}</span>
        <Input
          placeholder={tr('pages.tokenRoutes.manualRoutePanel.modelClaudeOpus46')}
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
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.model2')}</div>
          <div className="text-xs text-muted-foreground">
            {selectedSourceRoutes.length > 0
              ? tr('pages.tokenRoutes.manualRoutePanel.selectedSourceModels').replace('{count}', String(selectedSourceRoutes.length))
              : tr('pages.tokenRoutes.manualRoutePanel.notSelectedModel')}
          </div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('pages.tokenRoutes.manualRoutePanel.selectModel')}
        </Button>
      </div>
      {selectedSourceRoutes.length > 0 && (
        <div className="grid gap-2">
          {selectedSourceRoutes.map((route, index) => (
            <div
              key={`selected-${route.id}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border p-3"
            >
              <span>{index + 1}</span>
              <div>
                <b>{renderRouteOptionLabel(route)}</b>
                <small>{tr('pages.tokenRoutes.manualRoutePanel.priorityBand')} {index}</small>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline"
                  type="button"
                 
                  disabled={index === 0}
                  onClick={() => setForm((current) => ({
                    ...current,
                    backend: {
                      kind: 'routes',
                      routeIds: moveSourceRouteId(current.backend.kind === 'routes' ? current.backend.routeIds : [], route.id, -1),
                    },
                  }))}
                >
                  {tr('pages.sites.moveUp')}
                </Button>
                <Button variant="outline"
                  type="button"
                 
                  disabled={index === selectedSourceRoutes.length - 1}
                  onClick={() => setForm((current) => ({
                    ...current,
                    backend: {
                      kind: 'routes',
                      routeIds: moveSourceRouteId(current.backend.kind === 'routes' ? current.backend.routeIds : [], route.id, 1),
                    },
                  }))}
                >
                  {tr('pages.sites.moveDown')}
                </Button>
                <Button variant="outline"
                  type="button"
                 
                  onClick={() => setForm((current) => ({
                    ...current,
                    backend: {
                      kind: 'routes',
                      routeIds: toggleSourceRouteId(current.backend.kind === 'routes' ? current.backend.routeIds : [], route.id),
                    },
                  }))}
                >
                  {tr('pages.settings.remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
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
          <span>{tr('pages.tokenRoutes.manualRoutePanel.groups2')}</span>
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
        <div className="text-xs text-muted-foreground">
          {modelPattern.trim()
            ? `${tr('pages.tokenRoutes.manualRoutePanel.rulePreviewMatchedSamples')} ${previewMatchedModels.length} / ${previewModelSamples.length}`
            : tr('pages.tokenRoutes.manualRoutePanel.exactModelGlobAvailableUsageRe')}
        </div>
      )}
      {previewMatchedModels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previewMatchedModels.slice(0, 12).map((modelName) => (
            <code key={modelName}>{modelName}</code>
          ))}
        </div>
      )}
    </div>
  );

  const backendStepContent = backendKind === 'routes' ? (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.model2')}</div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.manualRoutePanel.selectedOutOfTotal')
              .replace('{selected}', String(selectedSourceRoutes.length))
              .replace('{total}', String(selectableSourceRouteOptions.length))}
          </div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('pages.tokenRoutes.manualRoutePanel.selectModel')}
        </Button>
      </div>
      <SearchField value={sourceSearch} onChange={setSourceSearch} placeholder={tr('pages.tokenRoutes.manualRoutePanel.searchModel')} />
      <div className="grid gap-2 md:grid-cols-2">
        {filteredSourceRoutes.slice(0, 18).map((route) => {
          const selected = selectedSourceRouteIdSet.has(route.id);
          const label = renderRouteOptionLabel(route);
          const brand = sourceRouteBrandById.get(route.id) || null;
          return (
            <Button
              key={route.id}
              type="button"
              variant={selected ? 'secondary' : 'outline'}
              className="h-auto grid justify-start gap-1 p-3 text-left"
              onClick={() => setForm((current) => ({
                ...current,
                backend: {
                  kind: 'routes',
                  routeIds: toggleSourceRouteId(current.backend.kind === 'routes' ? current.backend.routeIds : [], route.id),
                },
              }))}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                {brand ? <BrandGlyph brand={brand} size={16} fallbackText={label} /> : <InlineBrandIcon model={getRouteRequestedModelPattern(route)} size={16} />}
                <span>{label}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {route.channelCount} {tr('pages.tokenRoutes.channels')} · {(route.siteNames || []).slice(0, 2).join(', ') || tr('pages.tokenRoutes.manualRoutePanel.nonesites')}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  ) : (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.automaticmodel')}</div>
      <div className="text-xs text-muted-foreground">
        {tr('pages.tokenRoutes.manualRoutePanel.saveModelavailableSitesrulesModelEndpointRulespreviewSelect')}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <span><b>{previewMatchedModels.length}</b>{tr('pages.tokenRoutes.manualRoutePanel.zh')}</span>
        <span><b>{previewModelSamples.length}</b>{tr('pages.tokenRoutes.manualRoutePanel.previewmodel')}</span>
        <span><b>{form.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}</b>{tr('pages.tokenRoutes.manualRoutePanel.status')}</span>
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
      {backendKind === 'channels' && (
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('pages.tokenRoutes.manualRoutePanel.groups')}</span>
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
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.saveCheck')}</div>
          <div className="grid gap-2">
            {validationItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border p-3">
                <span className={item.ok ? 'text-muted-foreground' : 'text-destructive'}>{item.ok ? 'OK' : '!'}</span>
                <div className="min-w-0">
                  <b className="block break-words">{item.label}</b>
                  <small className="block break-words text-muted-foreground">{item.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid min-w-0 gap-2">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.manualRoutePanel.payloadPreview')}</div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs">{stringifyRouteGraphJson(currentFormNodeJson)}</pre>
        </div>
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
      <Button variant="outline"
        type="button"
        onClick={closeSourcePicker}
       
       
      >
        {tr('app.cancel')}
      </Button>
      <Button variant="outline"
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
        maxWidth={jsonPanelOpen ? 1180 : 860}
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
                  {tr('pages.tokenRoutes.manualRoutePanel.json3')}
                </Button>
                <Button variant="outline"
                  type="button"
                 
                  onClick={jsonPanelOpen ? () => setJsonPanelOpen(false) : openJsonPanel}
                >
                  {jsonPanelOpen ? tr('pages.tokenRoutes.manualRoutePanel.closeJson') : tr('pages.tokenRoutes.manualRoutePanel.jsonHighEdit')}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.type')}</div>
                <div className="mt-1 break-words text-sm font-medium">{routeTypeSummary.badge}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.visibility')}</div>
                <div className="mt-1 break-words text-sm font-medium">{currentFormNodeJson.visibility}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{tr('backend')}</div>
                <div className="mt-1 break-words text-sm font-medium">{currentFormNodeJson.backend.kind}</div>
              </div>
            </div>

            <div className="grid min-h-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <nav className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:content-start lg:overflow-visible lg:pb-0" aria-label={tr('pages.tokenRoutes.manualRoutePanel.routes')}>
                {WIZARD_STEPS.map((step, index) => {
                  const active = step.id === wizardStep;
                  const done = getWizardStepIndex(wizardStep) > index;
                  return (
                    <Button
                      key={step.id}
                      type="button"
                      variant={active ? 'secondary' : 'outline'}
                      className={`h-auto min-w-40 justify-start p-3 text-left lg:min-w-0 ${done ? 'opacity-80' : ''}`.trim()}
                      onClick={() => setWizardStep(step.id)}
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">{index + 1}</span>
                      <span className="grid gap-1 text-sm">
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </span>
                    </Button>
                  );
                })}
              </nav>

              <section className="grid min-w-0 gap-3 rounded-lg border p-3">
                {editingDirectChannelsNode ? (
                  <div className="grid gap-1 rounded-lg border p-3">
                    <div className="text-sm font-medium">{tr('Direct Channels')}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr('pages.tokenRoutes.manualRoutePanel.channelsMatchAvailablemodelMatchautomaticchannels')}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-1">
                  <div className="text-sm font-medium">{WIZARD_STEPS[getWizardStepIndex(wizardStep)]?.label}</div>
                  <div className="text-xs text-muted-foreground">{WIZARD_STEPS[getWizardStepIndex(wizardStep)]?.detail}</div>
                </div>

                {wizardContentByStep[wizardStep]}
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
                <ToneBadge tone="-info">
                  manual
                </ToneBadge>
              </div>

              <div className="flex flex-wrap gap-2">
                <ToneBadge tone="-muted">
                  {currentFormNodeJson.backend.kind}
                </ToneBadge>
                <ToneBadge tone="-muted">
                  {currentFormNodeJson.visibility}
                </ToneBadge>
                <ToneBadge tone="-muted">
                  {currentFormNodeJson.ownership}
                </ToneBadge>
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
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">
                {tr('pages.tokenRoutes.manualRoutePanel.selectedSourceModels').replace('{count}', String(sourcePickerSelection.length))}
              </div>
              <div className="text-xs text-muted-foreground">
                {tr('pages.tokenRoutes.manualRoutePanel.candidatesOutOfTotal')
                  .replace('{filtered}', String(filteredSourceRoutes.length))
                  .replace('{total}', String(selectableSourceRouteOptions.length))}
              </div>
            </div>
          </div>

          <SearchField
            value={sourceSearch}
            onChange={setSourceSearch}
            placeholder={tr('pages.tokenRoutes.manualRoutePanel.searchModel')}
          />

          <div className="grid shrink-0 gap-3 rounded-lg border p-3">
            <div className="grid gap-3">
              <FilterRow label={tr('pages.models.brands')}>
                <FilterChip
                  active={!activeSourceBrand}
                  label={tr('components.notificationPanel.all')}
                  count={selectableSourceRouteOptions.length}
                  icon={<span className="text-[10px]">✦</span>}
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
                    icon={<span className="text-[10px]">?</span>}
                    onClick={() => setActiveSourceBrand(activeSourceBrand === '__other__' ? null : '__other__')}
                  />
                ) : null}
              </FilterRow>

              {sourceSiteList.length > 0 ? (
                <FilterRow label={tr('components.searchModal.sites2')}>
                  <FilterChip
                    active={!activeSourceSite}
                    label={tr('components.notificationPanel.all')}
                    count={selectableSourceRouteOptions.length}
                  icon={<span className="text-[10px]">⚡</span>}
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
                  count={selectableSourceRouteOptions.length}
                  icon={<span className="text-[10px]">⚙</span>}
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
                      icon={iconModel ? <InlineBrandIcon model={iconModel} size={12} /> : <span className="text-[10px]">⚙</span>}
                      onClick={() => setActiveSourceEndpointType(activeSourceEndpointType === endpointType ? null : endpointType)}
                    />
                  );
                })}
                {sourceEndpointTypeList.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.noneendpointCapabilities')}</span>
                ) : null}
              </FilterRow>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto pr-1">
            {filteredSourceRoutes.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">
                {selectableSourceRouteOptions.length === 0
                  ? tr('pages.tokenRoutes.manualRoutePanel.modelRoutes')
                  : tr('pages.tokenRoutes.manualRoutePanel.matchModel')}
              </div>
            ) : (
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-stretch gap-2.5"
              >
                {filteredSourceRoutes.map((route) => {
                  const selected = sourcePickerSelectionSet.has(route.id);
                  const label = renderRouteOptionLabel(route);
                  const brand = sourceRouteBrandById.get(route.id) || null;
                  const endpointTypes = (sourceEndpointTypesByRouteId[route.id] || []).slice(0, 3);
                  const siteNames = Array.from(new Set((route.siteNames || []).filter((siteName) => String(siteName || '').trim())));

                  return (
                    <Button variant="outline"
                      key={route.id}
                      type="button"
                      onClick={() => setSourcePickerSelection((current) => toggleSourceRouteId(current, route.id))}
                      className="h-auto w-full justify-start p-0 text-left"
                     
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
                                {brand ? <BrandGlyph brand={brand} size={18} fallbackText={label} /> : <InlineBrandIcon model={getRouteRequestedModelPattern(route)} size={18} />}
                              </span>
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="truncate text-[13px] font-semibold text-foreground">
                                  {label}
                                </span>
                                {label !== getRouteRequestedModelPattern(route) ? (
                                  <code className="truncate text-[11px] text-muted-foreground">
                                    {getRouteRequestedModelPattern(route)}
                                  </code>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <ToneBadge tone={selected ? 'info' : 'muted'} className="shrink-0 text-[10px]">
                            {selected ? tr('pages.downstreamKeys.selectedzh') : tr('pages.tokenRoutes.manualRoutePanel.selectable')}
                          </ToneBadge>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <ToneBadge tone="-info">
                            {route.channelCount} {tr('pages.tokenRoutes.channels')}
                          </ToneBadge>
                          <ToneBadge tone="-muted">
                            {siteNames.length} {tr('components.searchModal.sites2')}
                          </ToneBadge>
                          {endpointTypes.map((endpointType) => (
                            <ToneBadge tone="-muted" key={`${route.id}-${endpointType}`}>
                              {endpointType}
                            </ToneBadge>
                          ))}
                        </div>

                        {siteNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {siteNames.slice(0, 3).map((siteName) => (
                              <ToneBadge
                                tone="-muted"
                                key={`${route.id}-${siteName}`}
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
      </CenteredModal>
    </>
  );
}
