import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { BrandGlyph, InlineBrandIcon, hashColor, type BrandInfo } from '../../components/BrandIcon.js';
import CenteredModal from '../../components/CenteredModal.js';
import ModernSelect from '../../components/ModernSelect.js';
import SearchInput from '../../components/SearchInput.js';
import { tr } from '../../i18n.js';
import type { RouteIconOption, RouteSummaryRow } from './types.js';
import type { RouteRoutingStrategy } from './types.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
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
  { id: 'type', label: '类型', detail: '选择节点' },
  { id: 'match', label: '匹配', detail: '对外模型' },
  { id: 'backend', label: '目标', detail: '后端连接' },
  { id: 'options', label: '策略', detail: '展示与行为' },
  { id: 'review', label: '检查', detail: '确认保存' },
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

  const sourceRouteBrandById = useMemo(() => {
    const next = new Map<number, BrandInfo | null>();
    for (const route of exactSourceRouteOptions) {
      next.set(route.id, resolveRouteBrand(route));
    }
    return next;
  }, [exactSourceRouteOptions]);

  const sourceBrandList = useMemo(() => {
    const grouped = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;

    for (const route of exactSourceRouteOptions) {
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
  }, [exactSourceRouteOptions, sourceRouteBrandById]);

  const sourceSiteList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const route of exactSourceRouteOptions) {
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
  }, [exactSourceRouteOptions]);

  const sourceEndpointTypeList = useMemo(() => {
    const grouped = new Map<string, number>();

    for (const route of exactSourceRouteOptions) {
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
  }, [exactSourceRouteOptions, sourceEndpointTypesByRouteId]);

  const filteredSourceRoutes = useMemo(() => {
    let list = [...exactSourceRouteOptions];

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
    exactSourceRouteOptions,
    sourceEndpointTypesByRouteId,
    sourceRouteBrandById,
    sourceSearch,
  ]);

  const selectedSourceRoutes = useMemo(() => {
    const routeById = new Map(exactSourceRouteOptions.map((route) => [route.id, route]));
    return sourceRouteIds
      .map((routeId) => routeById.get(routeId))
      .filter((route): route is RouteSummaryRow => !!route);
  }, [exactSourceRouteOptions, sourceRouteIds]);

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
      visibility: currentRouteNodeJson?.visibility || 'public',
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
          visibility: currentRouteNodeJson?.visibility || 'public',
          enabled: form.enabled,
          routingStrategy: form.routingStrategy,
          routeIds: sourceRouteIds,
        }),
      } : {}),
      routingStrategy: form.routingStrategy,
      modelMapping,
    };
  }, [backendKind, currentRouteNodeJson, displayIcon, displayName, form.enabled, form.modelMapping, form.routingStrategy, modelPattern, sourceRouteIds]);

  const validationItems = useMemo(() => {
    const items: Array<{ ok: boolean; label: string; detail: string }> = [];
    if (backendKind === 'routes') {
      items.push({
        ok: !!displayName.trim(),
        label: 'Public model name',
        detail: displayName.trim() || '未填写',
      });
      items.push({
        ok: sourceRouteIds.length > 0,
        label: 'Source routes',
        detail: sourceRouteIds.length > 0 ? `${sourceRouteIds.length} selected` : '未选择来源',
      });
    } else {
      items.push({
        ok: !!modelPattern.trim() && !modelPatternError,
        label: 'Match rule',
        detail: modelPatternError || modelPattern.trim() || '未填写',
      });
      items.push({
        ok: previewMatchedModels.length > 0 || previewModelSamples.length === 0 || isExactModelPattern(modelPattern),
        label: 'Preview',
        detail: previewModelSamples.length === 0 ? '暂无样本' : `${previewMatchedModels.length}/${previewModelSamples.length} matched`,
      });
    }
    if (form.modelMapping.trim()) {
      try {
        const parsed = JSON.parse(form.modelMapping);
        items.push({
          ok: !!parsed && typeof parsed === 'object' && !Array.isArray(parsed),
          label: 'Model mapping JSON',
          detail: '有效 JSON 对象',
        });
      } catch {
        items.push({
          ok: false,
          label: 'Model mapping JSON',
          detail: 'JSON 格式错误',
        });
      }
    }
    items.push({
      ok: currentFormNodeJson.ownership === 'manual',
      label: 'Ownership',
      detail: 'manual node',
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
        enabled: next.enabled,
        modelMapping: next.modelMapping,
        advancedOpen: next.advancedOpen,
        macro: next.macro,
      }));
      setNodeJsonDraft(stringifyRouteGraphJson(validation.node));
      setNodeJsonMessage('JSON 已应用到当前草稿，保存后才会写入。');
    } catch {
      setNodeJsonMessage('JSON 格式错误');
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
      setNodeJsonMessage('JSON 已格式化。');
    } catch {
      setNodeJsonMessage('JSON 格式错误');
    }
  };

  const validateNodeJsonDraft = () => {
    try {
      const parsed = JSON.parse(nodeJsonDraft) as unknown;
      const validation = validateRouteGraphNodeDraft(parsed);
      setNodeJsonMessage(validation.ok ? '节点 JSON 有效。' : validation.message);
    } catch {
      setNodeJsonMessage('JSON 格式错误');
    }
  };

  const advancedRouteControls = (
    <Card>
      <CardContent className="flex flex-col gap-3 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-foreground">
            {tr('高级配置')}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={form.enabled}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked === true }))}
            />
            {tr('启用路由')}
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{tr('路由策略')}</span>
          <ModernSelect
            value={form.routingStrategy}
            onChange={(nextValue) => setForm((current) => ({ ...current, routingStrategy: nextValue as RouteRoutingStrategy }))}
            options={[
              { value: 'weighted', label: tr('权重随机'), description: tr('按通道权重随机选择。') },
              { value: 'round_robin', label: tr('轮询'), description: tr('在可用通道之间轮流选择。') },
              { value: 'stable_first', label: tr('稳定优先'), description: tr('优先选择排序最靠前的可用通道。') },
            ]}
            placeholder={tr('选择路由策略')}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{tr('模型映射 JSON')}</span>
          <Textarea
            value={form.modelMapping}
            onChange={(event) => setForm((current) => ({ ...current, modelMapping: event.target.value }))}
            placeholder='{"public-model":"upstream-model"}'
            spellCheck={false}
            rows={3}
            className="min-h-19 resize-y font-mono text-xs leading-relaxed"
          />
          <span className="text-xs leading-relaxed text-muted-foreground">
            {tr('用于将对外模型名映射到上游模型名；留空表示不重写。')}
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
        {editingRouteId ? tr('取消编辑') : tr('取消')}
      </Button>
      {getWizardStepIndex(wizardStep) > 0 && (
        <Button variant="outline"
          type="button"
          onClick={goPreviousStep}
         
         
        >
          {tr('上一步')}
        </Button>
      )}
      {wizardStep !== 'review' && (
        <Button
          type="button"
          onClick={goNextStep}
          disabled={!canGoNext}
         
        >
          {tr('下一步')}
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
            {tr('保存中...')}
          </>
        ) : (
          tr(editingRouteId ? '保存群组' : '创建群组')
        )}
      </Button>
    </>
  );

  const routeTypeSummary = backendKind === 'routes'
    ? {
      title: 'Model Group / 模型分组',
      description: '对外暴露一个模型名，转发到多个已有模型路由。',
      badge: `${sourceRouteIds.length} sources`,
    }
    : {
      title: 'Direct Channels',
      description: '用 exact / glob / regex 规则直接维护通道池。',
      badge: modelPattern.trim() || 'match rule',
    };

  const typeStepContent = (
    <div className="grid gap-3 md:grid-cols-3">
      <Button
        type="button"
        variant={backendKind === 'routes' ? 'secondary' : 'outline'}
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={() => setRouteType('routes')}
      >
        <span className="text-xs font-medium text-muted-foreground">Model Group</span>
        <span className="text-sm font-semibold">{tr('分组聚合路由')}</span>
        <span className="text-xs text-muted-foreground">{tr('把多个已有精确模型合并成一个对外模型名，适合别名、聚合和迁移。')}</span>
        <span className="text-xs text-muted-foreground">{exactSourceRouteOptions.length} {tr('个可选来源')}</span>
      </Button>
      <Button
        type="button"
        variant={backendKind === 'channels' ? 'secondary' : 'outline'}
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={() => setRouteType('channels')}
      >
        <span className="text-xs font-medium text-muted-foreground">Direct Channels</span>
        <span className="text-sm font-semibold">{tr('规则直连通道')}</span>
        <span className="text-xs text-muted-foreground">{tr('用模型匹配规则生成并维护通道池，支持 exact、glob 和 re: 正则。')}</span>
        <span className="text-xs text-muted-foreground">{previewModelSamples.length} {tr('个预览样本')}</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-auto grid justify-start gap-2 p-3 text-left"
        onClick={openJsonPanel}
      >
        <span className="text-xs font-medium text-muted-foreground">Advanced Node</span>
        <span className="text-sm font-semibold">{tr('节点 JSON')}</span>
        <span className="text-xs text-muted-foreground">{tr('导入、校验或直接编辑当前 manual 节点 JSON。')}</span>
        <span className="text-xs text-muted-foreground">graph-native</span>
      </Button>
    </div>
  );

  const matchStepContent = backendKind === 'routes' ? (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-medium">
        <span>{tr('对外模型名')}</span>
        <Input
          placeholder={tr('对外模型名（例如 claude-opus-4-6）')}
          value={displayName}
          onChange={(event) => setForm((current) => ({
            ...current,
            match: { ...current.match, displayName: event.target.value.trim() ? event.target.value : null },
            presentation: { ...current.presentation, displayName: event.target.value },
          }))}
        />
      </label>
      <div className="text-xs text-muted-foreground">
        {tr('这个名字会作为 public model 暴露给下游请求。Model Group 的 requestedModelPattern 会保持为空。')}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr('来源模型')}</div>
          <div className="text-xs text-muted-foreground">
            {selectedSourceRoutes.length > 0
              ? `已选择 ${selectedSourceRoutes.length} 个来源模型`
              : tr('尚未选择来源模型。')}
          </div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('选择来源模型')}
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
                <small>{tr('Priority band')} {index}</small>
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
                  {tr('上移')}
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
                  {tr('下移')}
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
                  {tr('移除')}
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
        <span>{tr('自动品牌图标')}</span>
      </label>
    </div>
  ) : (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('群组显示名')}</span>
          <Input
            placeholder={tr('可选，例如 Claude 4.6')}
            value={displayName}
            onChange={(event) => setForm((current) => ({
              ...current,
              match: { ...current.match, displayName: event.target.value.trim() ? event.target.value : null },
              presentation: { ...current.presentation, displayName: event.target.value },
            }))}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('模型匹配')}</span>
          <Input
            placeholder={tr('模型匹配（gpt-4o、claude-*、re:^claude-.*$）')}
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
            ? `${tr('规则预览：命中样本')} ${previewMatchedModels.length} / ${previewModelSamples.length}`
            : tr('exact 直接填写模型名；glob 可用 *；正则请使用 re: 前缀。')}
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
          <div className="text-sm font-medium">{tr('来源模型')}</div>
          <div className="text-xs text-muted-foreground">{`已选择 ${selectedSourceRoutes.length} / ${exactSourceRouteOptions.length}`}</div>
        </div>
        <Button variant="outline" type="button" onClick={openSourcePicker}>
          {tr('选择来源模型')}
        </Button>
      </div>
      <SearchField value={sourceSearch} onChange={setSourceSearch} placeholder={tr('搜索来源模型')} />
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
                {route.channelCount} {tr('通道')} · {(route.siteNames || []).slice(0, 2).join(', ') || tr('无站点')}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  ) : (
    <div className="grid gap-3">
      <div className="text-sm font-medium">{tr('自动模型端点池')}</div>
      <div className="text-xs text-muted-foreground">
        {tr('保存后会按模型可用性和站点规则维护 model_endpoint。当前步骤展示规则预览，不直接选择单个 channel。')}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <span><b>{previewMatchedModels.length}</b>{tr('命中样本')}</span>
        <span><b>{previewModelSamples.length}</b>{tr('可预览模型')}</span>
        <span><b>{form.enabled ? tr('启用') : tr('禁用')}</b>{tr('初始状态')}</span>
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
          <span>{tr('自动品牌图标')}</span>
        </label>
      )}
      {backendKind === 'channels' && (
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr('群组图标')}</span>
          <ModernSelect
            value={routeIconSelectValue}
            onChange={(nextValue) => setForm((current) => ({
              ...current,
              presentation: { ...current.presentation, displayIcon: nextValue },
            }))}
            options={routeIconSelectOptions}
            placeholder={tr('图标（可选，选择品牌图标）')}
            emptyLabel={tr('暂无可选品牌图标')}
          />
        </label>
      )}
    </div>
  );

  const reviewStepContent = (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-sm font-medium">{tr('保存前检查')}</div>
          <div className="grid gap-2">
            {validationItems.map((item) => (
              <div key={item.label} className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border p-3">
                <span>{item.ok ? 'OK' : '!'}</span>
                <div>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium">Payload Preview</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border p-3 font-mono text-xs">{stringifyRouteGraphJson(currentFormNodeJson)}</pre>
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
        {tr('取消')}
      </Button>
      <Button variant="outline"
        type="button"
        onClick={() => setSourcePickerSelection([])}
       
        disabled={sourcePickerSelection.length === 0}
      >
        {tr('清空')}
      </Button>
      <Button
        type="button"
        onClick={confirmSourcePicker}
       
      >
        {`确认选择 (${sourcePickerSelection.length})`}
      </Button>
    </>
  );

  return (
    <>
      <CenteredModal
        open={show}
        onClose={onCancel}
        title={editingRouteId ? tr('编辑群组') : tr('新建群组')}
        footer={footer}
        maxWidth={jsonPanelOpen ? 1180 : 860}
        closeOnEscape
      >
        <div className={jsonPanelOpen ? 'grid gap-4 lg:grid-cols-[1fr_360px]' : 'grid gap-4'}>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{routeTypeSummary.title}</div>
                <div className="text-sm text-muted-foreground">{routeTypeSummary.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={exportNodeJson}>
                  {tr('导出节点 JSON')}
                </Button>
                <Button variant="outline"
                  type="button"
                 
                  onClick={jsonPanelOpen ? () => setJsonPanelOpen(false) : openJsonPanel}
                >
                  {jsonPanelOpen ? tr('关闭 JSON') : tr('JSON 高级编辑')}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
              <nav className="grid content-start gap-2" aria-label={tr('路由创建步骤')}>
                {WIZARD_STEPS.map((step, index) => {
                  const active = step.id === wizardStep;
                  const done = getWizardStepIndex(wizardStep) > index;
                  return (
                    <Button
                      key={step.id}
                      type="button"
                      variant={active ? 'secondary' : 'outline'}
                      className={`h-auto justify-start p-3 text-left ${done ? 'opacity-80' : ''}`.trim()}
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

              <section className="grid gap-3 rounded-lg border p-3">
                {editingDirectChannelsNode ? (
                  <div className="grid gap-1 rounded-lg border p-3">
                    <div className="text-sm font-medium">{tr('Direct Channels')}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr('该节点直接维护通道；修改 Match 后会按当前可用模型重新匹配自动通道。')}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-1">
                  <div className="text-sm font-medium">{WIZARD_STEPS[getWizardStepIndex(wizardStep)]?.label}</div>
                  <div className="text-xs text-muted-foreground">{WIZARD_STEPS[getWizardStepIndex(wizardStep)]?.detail}</div>
                </div>

                {wizardContentByStep[wizardStep]}
              </section>

              <aside className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{tr('实时预览')}</div>
                    <div className="text-xs text-muted-foreground">{tr('保存前会应用到同一份 graph-native 草稿。')}</div>
                  </div>
                  <ToneBadge tone={currentFormNodeJson.enabled ? 'success' : 'warning'} className="text-[11px]">
                    {currentFormNodeJson.enabled ? tr('已启用') : tr('已禁用')}
                  </ToneBadge>
                </div>

                <div className="grid gap-2">
                  <div className="text-sm font-medium">{tr('节点概要')}</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <span><b>{routeTypeSummary.badge}</b>{tr('当前类型')}</span>
                    <span><b>{currentFormNodeJson.visibility}</b>{tr('可见性')}</span>
                    <span><b>{currentFormNodeJson.backend.kind}</b>{tr('backend')}</span>
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="text-sm font-medium">{tr('校验状态')}</div>
                  <div className="grid gap-2">
                    {validationItems.map((item) => (
                      <div key={item.label} className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border p-3">
                        <span>{item.ok ? 'OK' : '!'}</span>
                        <div>
                          <b>{item.label}</b>
                          <small>{item.detail}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="text-sm font-medium">Payload Preview</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border p-3 font-mono text-xs">{stringifyRouteGraphJson(currentFormNodeJson)}</pre>
                </div>
              </aside>
            </div>
          </div>

          {jsonPanelOpen && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{tr('节点 JSON')}</div>
                  <div className="text-xs text-muted-foreground">
                    {tr('只允许编辑 manual 节点；应用后先进入表单草稿，点击保存才会写入。')}
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

              <Textarea
                className="min-h-80 rounded-md border bg-background p-3 font-mono text-xs"
                value={nodeJsonDraft}
                onChange={(event) => {
                  setNodeJsonDraft(event.target.value);
                  setNodeJsonMessage('');
                }}
                spellCheck={false}
              />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" onClick={formatNodeJsonDraft}>
                  {tr('格式化')}
                </Button>
                <Button variant="outline" type="button" onClick={validateNodeJsonDraft}>
                  {tr('校验')}
                </Button>
                <Button type="button" onClick={applyNodeJsonDraft}>
                  {tr('应用到草稿')}
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
        title={tr('选择来源模型')}
        footer={sourcePickerFooter}
        maxWidth={980}
        closeOnEscape
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">
                {`已选择 ${sourcePickerSelection.length} 个来源模型`}
              </div>
              <div className="text-xs text-muted-foreground">
                {`候选 ${filteredSourceRoutes.length} / ${exactSourceRouteOptions.length}`}
              </div>
            </div>
          </div>

          <SearchField
            value={sourceSearch}
            onChange={setSourceSearch}
            placeholder={tr('搜索来源模型')}
          />

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-3">
              <FilterRow label={tr('品牌')}>
                <FilterChip
                  active={!activeSourceBrand}
                  label={tr('全部')}
                  count={exactSourceRouteOptions.length}
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
                    label={tr('其他')}
                    count={sourceBrandList.otherCount}
                    icon={<span className="text-[10px]">?</span>}
                    onClick={() => setActiveSourceBrand(activeSourceBrand === '__other__' ? null : '__other__')}
                  />
                ) : null}
              </FilterRow>

              {sourceSiteList.length > 0 ? (
                <FilterRow label={tr('站点')}>
                  <FilterChip
                    active={!activeSourceSite}
                    label={tr('全部')}
                    count={exactSourceRouteOptions.length}
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

              <FilterRow label={tr('能力')}>
                <FilterChip
                  active={!activeSourceEndpointType}
                  label={tr('全部')}
                  count={exactSourceRouteOptions.length}
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
                  <span className="text-xs text-muted-foreground">{tr('暂无接口能力数据')}</span>
                ) : null}
              </FilterRow>
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto pr-1">
            {filteredSourceRoutes.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">
                {exactSourceRouteOptions.length === 0
                  ? tr('当前没有可选的精确模型路由。')
                  : tr('没有匹配的来源模型。')}
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
                            {selected ? tr('已选中') : tr('可选择')}
                          </ToneBadge>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <ToneBadge tone="-info">
                            {route.channelCount} {tr('通道')}
                          </ToneBadge>
                          <ToneBadge tone="-muted">
                            {siteNames.length} {tr('站点')}
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
                            {tr('当前未绑定站点信息')}
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
