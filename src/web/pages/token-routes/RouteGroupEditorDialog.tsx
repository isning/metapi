import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react';

import type {
  RouteGroupExplicitSourceReference,
  RouteGroupManagementListItem,
  RouteGroupSourceCatalogItem,
} from '../../../shared/routeGroupManagement.js';
import {
  isExactModelPattern,
  matchesModelPattern,
  parseModelRegexPattern,
} from '../../../shared/modelPatternMatcher.js';
import type { DispatcherPolicy, RouteFailureBackoffOverride, RouteFilter } from '../../../shared/routeGraph.js';
import { api, type DispatchPolicyRegistryPayload } from '../../api.js';
import CenteredModal from '../../components/CenteredModal.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import { useToast } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { tr } from '../../i18n.js';
import { DispatcherPolicySelect } from './DispatcherPolicySelect.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';
import { FilterOperationsEditor } from './NodeForm.js';
import {
  RouteGroupSourcePicker,
  routeGroupSourceKey as sourceKey,
  routeGroupSourceKindLabel as sourceKindLabel,
  routeGroupSourceReferenceKey as sourceReferenceKey,
} from './RouteGroupSourcePicker.js';
import {
  routeGroupCapabilities,
  routeGroupCommandErrorMessage,
  routeGroupPolicyLabel as policyLabel,
} from './routeGroupPresentation.js';

type GroupForm = {
  publicName: string;
  upstreamName: string;
  displayName: string;
  displayIcon: string;
  visibility: "public" | "internal";
  enabled: boolean;
  sourceMode: "explicit" | "model_pattern";
  sourcePattern: string;
  sources: RouteGroupExplicitSourceReference[];
  filters: RouteFilter[];
  dispatcherPolicy: DispatcherPolicy;
  failureBackoff: RouteFailureBackoffOverride | null;
};

type GroupEditorStep = "match" | "sources" | "options" | "review";

const GROUP_EDITOR_STEPS: Array<{
  id: GroupEditorStep;
  label: string;
  detail: string;
}> = [
  {
    id: "match",
    label: tr("pages.tokenRoutes.routeGroupEditor.model"),
    detail: tr("pages.tokenRoutes.routeGroupEditor.modelDescription"),
  },
  {
    id: "sources",
    label: tr("pages.tokenRoutes.routeGroupEditor.sources"),
    detail: tr("pages.tokenRoutes.routeGroupEditor.sourcesDescription"),
  },
  {
    id: "options",
    label: tr("pages.tokenRoutes.routeGroupEditor.options"),
    detail: tr("pages.tokenRoutes.routeGroupEditor.visibilityAndPolicy"),
  },
  {
    id: "review",
    label: tr("pages.tokenRoutes.routeGroupEditor.review"),
    detail: tr("pages.tokenRoutes.routeGroupEditor.reviewDescription"),
  },
];

const EMPTY_FORM: GroupForm = {
  publicName: "",
  upstreamName: "",
  displayName: "",
  displayIcon: "",
  visibility: "public",
  enabled: true,
  sourceMode: "explicit",
  sourcePattern: "",
  sources: [],
  filters: [],
  dispatcherPolicy: { kind: "inherit_default" },
  failureBackoff: null,
};

export function RouteGroupEditorDialog({
  open,
  group,
  onClose,
  onSaved,
  policyRegistry,
}: {
  open: boolean;
  group: RouteGroupManagementListItem | null;
  onClose: () => void;
  onSaved: () => void;
  policyRegistry: DispatchPolicyRegistryPayload | null;
}) {
  const toast = useToast();
  const [form, setForm] = useState<GroupForm>(EMPTY_FORM);
  const [catalog, setCatalog] = useState<RouteGroupSourceCatalogItem[]>([]);
  const [sourceCatalogCursor, setSourceCatalogCursor] = useState<string | null>(null);
  const [sourceCatalogNextCursor, setSourceCatalogNextCursor] = useState<string | null>(null);
  const [sourceCatalogLoading, setSourceCatalogLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcePickerSelection, setSourcePickerSelection] = useState<string[]>(
    [],
  );
  const [sourcePickerSite, setSourcePickerSite] = useState<string | null>(null);
  const [sourcePickerKind, setSourcePickerKind] = useState<
    RouteGroupExplicitSourceReference["kind"] | "all"
  >("all");
  const [saving, setSaving] = useState(false);
  const [wizardStep, setWizardStep] = useState<GroupEditorStep>("match");
  const capabilities = routeGroupCapabilities(group);
  const isAutomatic = group?.kind === "automatic";

  useEffect(() => {
    if (!open) return;
    setForm(
      group
        ? {
            publicName: group.model.publicName || "",
            upstreamName: group.model.upstreamName || "",
            displayName: group.presentation.displayName || "",
            displayIcon: group.presentation.displayIcon || "",
            visibility: group.visibility,
            enabled: group.enabled,
            sourceMode: group.sourceSelection.kind,
            sourcePattern:
              group.sourceSelection.kind === "model_pattern"
                ? group.sourceSelection.pattern
                : "",
            sources:
              group.sourceSelection.kind === "explicit"
                ? group.sourceSelection.sources.map((source) => source.source)
                : [],
            filters: group.filters?.operations || [],
            dispatcherPolicy: group.dispatcherPolicy || {
              kind: "inherit_default",
            },
            failureBackoff: group.failureBackoff || null,
          }
        : EMPTY_FORM,
    );
    setSourcePickerOpen(false);
    setSourcePickerSelection([]);
    setSourcePickerSite(null);
    setSourcePickerKind("all");
    setQuery("");
    setWizardStep("match");
  // Initialize only when opening or switching groups. The workspace may
  // refresh the projection object while this dialog is open; that must not
  // overwrite edits that have not been saved yet.
  }, [group?.id, open]);

  useEffect(() => {
    if (!open || !sourcePickerOpen) return;
    let active = true;
    setSourceCatalogLoading(true);
    api
      .getRouteGroupSourceCatalog({
        q: query,
        ...(group ? { excludeGroupKey: group.id } : {}),
        ...(sourceCatalogCursor ? { cursor: sourceCatalogCursor } : {}),
        limit: 50,
      })
      .then((page) => {
        if (!active) return;
        setCatalog((current) => sourceCatalogCursor
          ? Array.from(new Map([...current, ...page.items].map((item) => [sourceKey(item), item])).values())
          : page.items);
        setSourceCatalogNextCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (active)
          toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.candidatesLoadFailed"));
      }).finally(() => { if (active) setSourceCatalogLoading(false); });
    return () => {
      active = false;
    };
  }, [group, open, query, sourceCatalogCursor, sourcePickerOpen, toast]);

  const sourceItems = useMemo(() => {
    const items = new Map<string, RouteGroupSourceCatalogItem>();
    for (const item of catalog) items.set(sourceKey(item), item);
    for (const item of group?.sourceSelection.kind === "explicit"
      ? group.sourceSelection.sources
      : []) {
      const key = sourceReferenceKey(item.source);
      if (!items.has(key)) items.set(key, item);
    }
    return Array.from(items.values());
  }, [catalog, group?.sourceSelection]);
  const sourcePatternError = useMemo(() => {
    if (form.sourceMode !== "model_pattern") return null;
    if (!form.sourcePattern.trim())
      return tr("pages.tokenRoutes.routeGroupEditor.sourcePatternRequired");
    return parseModelRegexPattern(form.sourcePattern).error
      ? tr("pages.tokenRoutes.routeGroupEditor.invalidPattern")
      : null;
  }, [form.sourceMode, form.sourcePattern]);
  const sourcePatternMatches = useMemo(
    () =>
      form.sourceMode === "model_pattern" && !sourcePatternError
        ? sourceItems.filter(
            (source) =>
              source.source.kind === "execution_target" &&
              Boolean(source.modelName) &&
              matchesModelPattern(source.modelName!, form.sourcePattern),
          )
        : [],
    [form.sourceMode, form.sourcePattern, sourceItems, sourcePatternError],
  );
  const visibleSteps = GROUP_EDITOR_STEPS;
  const currentStep =
    visibleSteps.find((step) => step.id === wizardStep) || visibleSteps[0]!;
  const currentStepIndex = Math.max(
    0,
    visibleSteps.findIndex((step) => step.id === currentStep.id),
  );
  const canAdvance =
    (currentStep.id !== "match" || Boolean(form.publicName.trim())) &&
    (currentStep.id !== "sources" ||
      form.sourceMode !== "model_pattern" ||
      !sourcePatternError);
  const goPreviousStep = () =>
    setWizardStep(visibleSteps[Math.max(0, currentStepIndex - 1)]!.id);
  const goNextStep = () =>
    setWizardStep(
      visibleSteps[Math.min(visibleSteps.length - 1, currentStepIndex + 1)]!.id,
    );

  const save = async () => {
    const presentation = {
      displayName: form.displayName || null,
      displayIcon: form.displayIcon || null,
    };
    const payload = {
      visibility: form.visibility,
      enabled: form.enabled,
      dispatcherPolicy: form.dispatcherPolicy,
      failureBackoff: form.failureBackoff,
      ...(capabilities.canEditGeneratedFields
        ? {
            presentation,
            model: {
              publicName: form.publicName.trim(),
              upstreamName: form.upstreamName.trim() || null,
            },
            sourceSelection:
              form.sourceMode === "model_pattern"
                ? {
                    kind: "model_pattern" as const,
                    pattern: form.sourcePattern.trim(),
                  }
                : { kind: "explicit" as const, sources: form.sources },
          }
        : {}),
      filters: { operations: form.filters },
    };
    if (capabilities.canEditGeneratedFields && !form.publicName.trim()) {
      toast.error(tr("pages.tokenRoutes.modelNameRequired"));
      return;
    }
    if (capabilities.canEditGeneratedFields && sourcePatternError) {
      toast.error(sourcePatternError);
      return;
    }
    setSaving(true);
    try {
      if (group) {
        await api.updateRouteGroup(group.id, payload);
      } else {
        await api.addRouteGroup({
          ...payload,
          model: {
            publicName: form.publicName.trim(),
            upstreamName: form.upstreamName.trim() || null,
          },
          presentation,
          sourceSelection: form.sourceMode === "model_pattern"
            ? {
                kind: "model_pattern",
                pattern: form.sourcePattern.trim(),
              }
            : { kind: "explicit", sources: form.sources },
        });
      }
      toast.success(
        group
          ? tr("pages.tokenRoutes.groups")
          : tr("pages.tokenRoutes.groupCreated"),
      );
      onSaved();
      onClose();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.groupsfailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeSource = (source: RouteGroupSourceCatalogItem) => {
    const key = sourceKey(source);
    setForm((current) => {
      const selected = current.sources.some(
        (item) => sourceReferenceKey(item) === key,
      );
      return {
        ...current,
        sources: selected
          ? current.sources.filter((item) => sourceReferenceKey(item) !== key)
          : [...current.sources, source.source],
      };
    });
  };

  const openSourcePicker = () => {
    setSourcePickerSelection(form.sources.map(sourceReferenceKey));
    setSourcePickerSite(null);
    setSourcePickerKind("all");
    setQuery("");
    setCatalog([]);
    setSourceCatalogCursor(null);
    setSourceCatalogNextCursor(null);
    setSourcePickerOpen(true);
  };

  const closeSourcePicker = () => {
    setSourcePickerOpen(false);
    setSourcePickerSelection([]);
    setSourcePickerSite(null);
    setSourcePickerKind("all");
  };

  const toggleSourcePickerSelection = (source: RouteGroupSourceCatalogItem) => {
    const key = sourceKey(source);
    setSourcePickerSelection((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const confirmSourcePickerSelection = () => {
    const sourcesByKey = new Map<string, RouteGroupExplicitSourceReference>();
    for (const source of form.sources)
      sourcesByKey.set(sourceReferenceKey(source), source);
    for (const source of sourceItems)
      sourcesByKey.set(sourceKey(source), source.source);
    setForm((current) => ({
      ...current,
      sources: sourcePickerSelection.flatMap((key) => {
        const source = sourcesByKey.get(key);
        return source ? [source] : [];
      }),
    }));
    closeSourcePicker();
  };

  const moveSource = (index: number, direction: -1 | 1) => {
    setForm((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.sources.length) return current;
      const sources = [...current.sources];
      [sources[index], sources[nextIndex]] = [
        sources[nextIndex]!,
        sources[index]!,
      ];
      return { ...current, sources };
    });
  };

  const selectedSources = form.sources.map((source) => {
    const key = sourceReferenceKey(source);
    return (
      sourceItems.find((item) => sourceKey(item) === key) ||
      ({
        source,
        label: source.kind === "route_group"
          ? source.id
          : tr("pages.tokenRoutes.routeGroupSourceKinds.executionTarget"),
        modelName: null,
        siteName: null,
        enabled: true,
      } satisfies RouteGroupSourceCatalogItem)
    );
  });
  const sourcePickerSelectionSet = useMemo(
    () => new Set(sourcePickerSelection),
    [sourcePickerSelection],
  );
  const sourcePickerSites = useMemo(
    () =>
      Array.from(
        new Set(
          sourceItems
            .map((source) => source.siteName?.trim())
            .filter((site): site is string => Boolean(site)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [sourceItems],
  );
  const filteredSourcePickerItems = useMemo(
    () =>
      sourceItems.filter(
        (source) =>
          (sourcePickerSite === null || source.siteName === sourcePickerSite) &&
          (sourcePickerKind === "all" ||
            source.source.kind === sourcePickerKind),
      ),
    [sourceItems, sourcePickerKind, sourcePickerSite],
  );

  const stepContent: Record<GroupEditorStep, React.ReactNode> = {
    match: (
      <div className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            <span>{tr("pages.tokenRoutes.modelName")}</span>
            <Input
              value={form.publicName}
              disabled={!capabilities.canEditGeneratedFields}
              onChange={(event) =>
                setForm((old) => ({ ...old, publicName: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <span>{tr("pages.tokenRoutes.nodeForm.upstreamModel")}</span>
            <Input
              value={form.upstreamName}
              disabled={!capabilities.canEditGeneratedFields}
              onChange={(event) =>
                setForm((old) => ({ ...old, upstreamName: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="rounded-md border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
          {tr("pages.tokenRoutes.routeGroupEditor.publicModelDescription")}
        </div>
      </div>
    ),
    sources: (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-1">
          <Button
            type="button"
            size="sm"
            variant={form.sourceMode === "explicit" ? "secondary" : "ghost"}
            disabled={!capabilities.canEditGeneratedFields}
            onClick={() =>
              setForm((current) => ({ ...current, sourceMode: "explicit" }))
            }
          >
            <ListChecks className="size-4" />
            {tr("pages.tokenRoutes.routeGroupEditor.explicitSources")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={
              form.sourceMode === "model_pattern" ? "secondary" : "ghost"
            }
            disabled={!capabilities.canEditGeneratedFields}
            onClick={() =>
              setForm((current) => ({
                ...current,
                sourceMode: "model_pattern",
              }))
            }
          >
            <Search className="size-4" />
            {tr("pages.tokenRoutes.routeGroupEditor.patternSources")}
          </Button>
        </div>
        {form.sourceMode === "model_pattern" ? (
          <div className="grid gap-3 rounded-md border bg-background/70 p-4">
            <label className="grid gap-2 text-sm font-medium">
              <span>
                {tr("pages.tokenRoutes.routeGroupEditor.sourcePattern")}
              </span>
              <Input
                value={form.sourcePattern}
                disabled={!capabilities.canEditGeneratedFields}
                placeholder="re:^deepseek-(v3|v4)"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sourcePattern: event.currentTarget.value,
                  }))
                }
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ToneBadge tone={sourcePatternError ? "-warning" : "-info"}>
                {sourcePatternError
                  ? tr("pages.tokenRoutes.routeGroupEditor.invalidPattern")
                  : isExactModelPattern(form.sourcePattern)
                    ? tr("pages.tokenRoutes.routeGroupEditor.exactPattern")
                    : form.sourcePattern.trim().toLowerCase().startsWith("re:")
                      ? tr("pages.tokenRoutes.routeGroupEditor.regexPattern")
                      : tr("pages.tokenRoutes.routeGroupEditor.globPattern")}
              </ToneBadge>
              <span className="text-muted-foreground">
                {sourcePatternError ||
                  tr(
                    "pages.tokenRoutes.routeGroupEditor.patternMatches",
                  ).replace("{count}", String(sourcePatternMatches.length))}
              </span>
            </div>
            {sourcePatternMatches.length ? (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto border-t pt-3">
                {sourcePatternMatches.slice(0, 24).map((source) => (
                  <ToneBadge key={sourceKey(source)} tone="-muted">
                    {source.modelName}
                    {source.siteName ? ` @ ${source.siteName}` : ""}
                  </ToneBadge>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  {tr("pages.tokenRoutes.routeGroupSources")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tr(
                    "pages.tokenRoutes.routeGroupEditor.selectedSources",
                  ).replace("{count}", String(form.sources.length))}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!capabilities.canEditGeneratedFields}
                onClick={openSourcePicker}
              >
                <Plus className="size-4" />
                {tr("pages.tokenRoutes.routeGroupEditor.sources")}
              </Button>
            </div>
            {selectedSources.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedSources.map((source, index) => (
                  <div
                    key={sourceReferenceKey(source.source)}
                    className="grid min-w-0 gap-2 rounded-md border bg-background/70 p-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {source.label}
                        </div>
                        {source.modelName ? (
                          <code className="mt-1 block truncate text-xs text-muted-foreground">
                            {source.modelName}
                          </code>
                        ) : null}
                      </div>
                      {!source.enabled ? (
                        <ToneBadge tone="-warning">
                          {tr("common.disabled")}
                        </ToneBadge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {source.siteName ? (
                        <ToneBadge tone="-muted">{source.siteName}</ToneBadge>
                      ) : null}
                      <ToneBadge tone="-info">
                        {sourceKindLabel(source.source)}
                      </ToneBadge>
                    </div>
                    <div className="flex justify-end gap-1 border-t pt-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghostMuted"
                        disabled={
                          !capabilities.canEditGeneratedFields || index === 0
                        }
                        aria-label={tr("pages.sites.moveUp")}
                        onClick={() => moveSource(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghostMuted"
                        disabled={
                          !capabilities.canEditGeneratedFields ||
                          index === selectedSources.length - 1
                        }
                        aria-label={tr("pages.sites.moveDown")}
                        onClick={() => moveSource(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghostDestructive"
                        disabled={!capabilities.canEditGeneratedFields}
                        aria-label={tr("pages.settings.remove")}
                        onClick={() => removeSource(source)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyStateBlock
                className="rounded-md border border-dashed bg-muted/20 p-6"
                title={tr("pages.tokenRoutes.routeGroupEditor.noSources")}
              />
            )}
          </>
        )}
      </div>
    ),
    options: (
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            <span>{tr("pages.tokenRoutes.displayName")}</span>
            <Input
              value={form.displayName}
              disabled={!capabilities.canEditGeneratedFields}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  displayName: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <span>{tr("pages.tokenRoutes.icon")}</span>
            <Input
              value={form.displayIcon}
              disabled={!capabilities.canEditGeneratedFields}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  displayIcon: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              disabled={!capabilities.canEditGroup}
              onCheckedChange={(enabled) =>
                setForm((old) => ({ ...old, enabled }))
              }
            />
            {tr("common.enabled")}
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={form.visibility === "public"}
              disabled={!capabilities.canEditGroup}
              onCheckedChange={(checked) =>
                setForm((old) => ({
                  ...old,
                  visibility: checked ? "public" : "internal",
                }))
              }
            />
            {tr("pages.tokenRoutes.routeGroupTabs.public")}
          </label>
        </div>
        <label className="grid gap-2 text-sm font-medium">
          <span>{tr("pages.tokenRoutes.dispatchPolicy")}</span>
          <DispatcherPolicySelect
            value={form.dispatcherPolicy}
            registry={policyRegistry}
            disabled={!capabilities.canEditGroup}
            onChange={(dispatcherPolicy) =>
              setForm((old) => ({
                ...old,
                dispatcherPolicy: dispatcherPolicy || { kind: "inherit_default" },
              }))
            }
          />
        </label>
        <FailureBackoffEditor
          value={form.failureBackoff}
          onChange={(failureBackoff) => setForm((old) => ({ ...old, failureBackoff }))}
        />
        <section className="grid gap-2 border-t pt-4">
          <span className="text-sm font-medium">
            {tr("pages.tokenRoutes.routeGroupEditor.filters")}
          </span>
          <FilterOperationsEditor
            value={form.filters}
            disabled={!capabilities.canEditGroup}
            onChange={(filters) => setForm((old) => ({ ...old, filters }))}
          />
        </section>
      </div>
    ),
    review: (
      <div className="grid gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="text-xs text-muted-foreground">
              {tr("pages.tokenRoutes.modelName")}
            </div>
            <div className="mt-1 break-words text-sm font-medium">
              {form.publicName || "-"}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="text-xs text-muted-foreground">
              {tr("pages.tokenRoutes.routeGroupSources")}
            </div>
            <div className="mt-1 text-sm font-medium">
              {form.sourceMode === "model_pattern"
                ? form.sourcePattern || "-"
                : form.sources.length}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="text-xs text-muted-foreground">
              {tr("pages.tokenRoutes.visibility")}
            </div>
            <div className="mt-1 text-sm font-medium">
              {form.visibility === "public"
                ? tr("pages.tokenRoutes.public")
                : tr("pages.tokenRoutes.internal")}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-2.5">
            <div className="text-xs text-muted-foreground">
              {tr("pages.tokenRoutes.dispatchPolicy")}
            </div>
            <div className="mt-1 text-sm font-medium">
              {policyLabel(form.dispatcherPolicy, policyRegistry)}
            </div>
          </div>
        </div>
        <div className="rounded-md border bg-background/60 p-3 text-xs text-muted-foreground">
          {tr("pages.tokenRoutes.routeGroupEditor.reviewDescription")}
        </div>
      </div>
    ),
  };

  return (
    <>
      <CenteredModal
        open={open}
        onClose={onClose}
        title={
          group
            ? tr("pages.accounts.edit")
            : tr("pages.tokenRoutes.createGroup")
        }
        maxWidth={980}
        closeOnEscape
        footer={
          <>
            <Button variant="outline" type="button" onClick={onClose}>
              {group
                ? tr("pages.tokenRoutes.routeGroupEditor.cancelEdit")
                : tr("app.cancel")}
            </Button>
            {currentStepIndex > 0 && (
              <Button
                data-testid="route-group-form-previous"
                variant="outline"
                type="button"
                onClick={goPreviousStep}
              >
                {tr("pages.tokenRoutes.routeGroupEditor.previous")}
              </Button>
            )}
            {currentStep.id !== "review" && (
              <Button
                data-testid="route-group-form-next"
                type="button"
                onClick={goNextStep}
                disabled={!canAdvance}
              >
                {tr("pages.tokenRoutes.routeGroupEditor.next")}
              </Button>
            )}
            <Button
              data-testid="route-group-form-save"
              type="button"
              disabled={
                saving ||
                (capabilities.canEditGeneratedFields &&
                  (!form.publicName.trim() || Boolean(sourcePatternError)))
              }
              onClick={save}
            >
              {saving && <LoaderCircle className="size-4 animate-spin" />}
              {group
                ? tr("pages.tokenRoutes.routeGroupEditor.save")
                : tr("pages.tokenRoutes.routeGroupEditor.create")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
            <div>
              <div className="text-sm font-semibold">
                {tr("pages.tokenRoutes.routeGroupEditor.groupMode")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {isAutomatic
                  ? tr("pages.tokenRoutes.routeGroupOverrideDescription")
                  : tr("pages.tokenRoutes.routeGroupSources")}
              </div>
            </div>
            <ToneBadge tone={isAutomatic ? "-info" : "-warning"}>
              {isAutomatic
                ? tr("pages.tokenRoutes.automatic")
                : tr("pages.tokenRoutes.manual")}
            </ToneBadge>
          </div>
          <div className="grid min-h-0 gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
            <nav
              className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:content-start lg:overflow-visible lg:pb-0"
              aria-label={tr("pages.tokenRoutes.routeGroupEditor.steps")}
            >
              {visibleSteps.map((step, index) => (
                <Button
                  key={step.id}
                  type="button"
                  variant={currentStep.id === step.id ? "secondary" : "outline"}
                  className="h-auto min-w-36 justify-start rounded-md p-2.5 text-left lg:min-w-0"
                  onClick={() => setWizardStep(step.id)}
                >
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-xs">
                    {index + 1}
                  </span>
                  <span className="grid min-w-0 gap-0.5 text-sm">
                    <strong>{step.label}</strong>
                    <small className="whitespace-normal break-words text-muted-foreground">
                      {step.detail}
                    </small>
                  </span>
                </Button>
              ))}
            </nav>
            <section className="grid min-w-0 content-start gap-3 rounded-md border bg-background/60 p-4">
              <div className="grid gap-1">
                <div className="text-sm font-medium">{currentStep.label}</div>
                <div className="text-xs text-muted-foreground">
                  {currentStep.detail}
                </div>
              </div>
              {stepContent[currentStep.id]}
            </section>
          </div>
        </div>
      </CenteredModal>
      <RouteGroupSourcePicker
        open={sourcePickerOpen}
        onClose={closeSourcePicker}
        onConfirm={confirmSourcePickerSelection}
        selectedCount={sourcePickerSelection.length}
        sourceKind={sourcePickerKind}
        onSourceKindChange={setSourcePickerKind}
        site={sourcePickerSite}
        onSiteChange={setSourcePickerSite}
        sites={sourcePickerSites}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setCatalog([]);
          setSourceCatalogCursor(null);
        }}
        items={filteredSourcePickerItems}
        totalItemCount={sourceItems.length}
        isSelected={(source) => sourcePickerSelectionSet.has(sourceKey(source))}
        onToggle={toggleSourcePickerSelection}
        hasMore={Boolean(sourceCatalogNextCursor)}
        loading={sourceCatalogLoading}
        onLoadMore={() => {
          if (sourceCatalogNextCursor)
            setSourceCatalogCursor(sourceCatalogNextCursor);
        }}
      />
    </>
  );
}
