import { useEffect, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';

import type {
  RouteGroupCandidateCatalogItem,
  RouteGroupManagementFallbackStage,
  RouteGroupManagementListItem,
} from '../../../shared/routeGroupManagement.js';
import { api } from '../../api.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import { useToast } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { Input } from '../../components/ui/input/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { tr } from '../../i18n.js';
import {
  labelForRouteGroup as labelForGroup,
  routeGroupCommandErrorMessage,
} from './routeGroupPresentation.js';

export function RouteGroupCandidatePicker({
  group,
  stages,
  open,
  onClose,
  onCreated,
}: {
  group: RouteGroupManagementListItem;
  stages: RouteGroupManagementFallbackStage[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<RouteGroupCandidateCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stageId, setStageId] = useState("");
  const [saving, setSaving] = useState(false);
  const editableStages = stages.filter(
    (stage) => stage.candidateManagement === "explicit",
  );
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCatalog([]);
    setCatalogPage(1);
    setCatalogHasMore(false);
    setSelectedIds(new Set());
    setStageId(editableStages[0]?.id || "");
  }, [group.id, open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCatalogLoading(true);
    const timeout = globalThis.setTimeout(
      () => {
        api
          .getRouteGroupCandidateCatalog(group.id, { q: query || undefined, page: catalogPage, pageSize: 50 })
          .then((result) => {
            if (!active) return;
            setCatalog((current) => catalogPage === 1
              ? result.items
              : Array.from(new Map([...current, ...result.items].map((item) => [item.sourceRef, item])).values()));
            setCatalogHasMore(result.pageInfo.hasMore);
          })
          .catch((error: unknown) => {
            if (active)
              toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.candidatePickerLoadFailed"));
          })
          .finally(() => {
            if (active) setCatalogLoading(false);
          });
      },
      query ? 150 : 0,
    );
    return () => {
      active = false;
      globalThis.clearTimeout(timeout);
    };
  }, [catalogPage, group.id, open, query, toast]);
  const save = async () => {
    const sourceRefs = catalog
      .filter((item) => selectedIds.has(item.sourceRef) && !item.alreadyMember)
      .map((item) => item.sourceRef);
    if (!sourceRefs.length || !stageId) {
      toast.error(tr("pages.tokenRoutes.invalidCandidate"));
      return;
    }
    setSaving(true);
    try {
      const result = await api.batchAddCandidates(
        group.id,
        sourceRefs,
        stageId,
      );
      if (result.errors.length) toast.error(result.errors.join("\n"));
      toast.success(tr("pages.tokenRoutes.candidateAdded"));
      onCreated();
      onClose();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.failedCreateCandidate"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <Dialog.Content className="sm:max-w-xl">
        <Dialog.Header>
          <Dialog.Title>{tr("pages.tokenRoutes.addCandidates")}</Dialog.Title>
          <Dialog.Description>{labelForGroup(group)}</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-3 py-2">
          <Input
            value={query}
            placeholder={tr("pages.tokenRoutes.candidatePickerSearch")}
            onChange={(event) => {
              setQuery(event.target.value);
              setCatalogPage(1);
            }}
          />
          <label className="grid gap-1.5 text-sm">
            <span>{tr("pages.tokenRoutes.fallbackStage")}</span>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editableStages.map((stage, index) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.label ||
                      `${tr("pages.tokenRoutes.fallbackStage")} ${index + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
            {catalogLoading && catalogPage === 1 ? (
              [1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-16 w-full" />
              ))
            ) : catalog.length ? (
              <>{catalog.map((item) => {
                const selected = selectedIds.has(item.sourceRef);
                return (
                  <Button
                    key={item.sourceRef}
                    type="button"
                    variant="outline"
                    disabled={item.alreadyMember}
                    className={`grid h-auto min-w-0 justify-start gap-1 rounded-md border p-2.5 text-left transition-colors ${selected ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"} ${item.alreadyMember ? "cursor-not-allowed opacity-60" : ""}`}
                    onClick={() =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(item.sourceRef)) next.delete(item.sourceRef);
                        else next.add(item.sourceRef);
                        return next;
                      })
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-sm border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {item.accountLabel}
                      </span>
                      {item.siteName ? (
                        <ToneBadge tone="-muted">{item.siteName}</ToneBadge>
                      ) : null}
                      {item.alreadyMember ? (
                        <ToneBadge tone="-muted">
                          {tr("pages.tokenRoutes.candidatePickerExisting")}
                        </ToneBadge>
                      ) : null}
                    </div>
                    <div className="ml-6 flex min-w-0 flex-wrap items-center gap-1.5">
                      <ToneBadge tone="-info">{item.sourceModel}</ToneBadge>
                      {item.tokenName ? (
                        <ToneBadge tone="">{item.tokenName}</ToneBadge>
                      ) : null}
                      {!item.enabled ? (
                        <ToneBadge tone="-warning">
                          {tr("common.disabled")}
                        </ToneBadge>
                      ) : null}
                    </div>
                  </Button>
                );
              })}
              {catalogHasMore && (
                <Button type="button" variant="ghost" disabled={catalogLoading} onClick={() => setCatalogPage((current) => current + 1)}>
                  {catalogLoading && <LoaderCircle className="size-4 animate-spin" />}
                  {tr("common.loadMore")}
                </Button>
              )}</>
            ) : (
              <EmptyStateBlock
                className="rounded-md border bg-muted/20 p-6"
                title={tr("pages.tokenRoutes.candidatePickerEmpty")}
              />
            )}
          </div>
        </div>
        <Dialog.Footer>
          <span className="mr-auto text-xs text-muted-foreground">
            {tr("pages.tokenRoutes.candidatePickerSelected").replace(
              "{count}",
              String(selectedIds.size),
            )}
          </span>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {tr("common.cancel")}
          </Button>
          <Button disabled={saving || !selectedIds.size} onClick={save}>
            {saving && <LoaderCircle className="size-4 animate-spin" />}
            {tr("pages.tokenRoutes.candidatePickerAdd").replace(
              "{count}",
              String(selectedIds.size),
            )}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
