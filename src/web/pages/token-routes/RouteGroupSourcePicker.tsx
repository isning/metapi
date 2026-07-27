import { Check, LoaderCircle } from 'lucide-react';

import type {
  RouteGroupExplicitSourceReference,
  RouteGroupSourceCatalogItem,
} from '../../../shared/routeGroupManagement.js';
import CenteredModal from '../../components/CenteredModal.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { tr } from '../../i18n.js';

export function routeGroupSourceKindLabel(
  source: RouteGroupExplicitSourceReference,
): string {
  return routeGroupSourceKindLabelForKind(source.kind);
}

export function routeGroupSourceKindLabelForKind(
  kind: RouteGroupExplicitSourceReference['kind'],
): string {
  return kind === 'execution_target'
    ? tr('pages.tokenRoutes.routeGroupSourceKinds.executionTarget')
    : tr('pages.tokenRoutes.routeGroupSourceKinds.routeGroup');
}

export function routeGroupSourceKey(source: RouteGroupSourceCatalogItem): string {
  return routeGroupSourceReferenceKey(source.source);
}

export function routeGroupSourceReferenceKey(
  source: RouteGroupExplicitSourceReference,
): string {
  return source.kind === 'execution_target'
    ? `${source.kind}:${source.sourceRef}`
    : `${source.kind}:${source.id}`;
}

export function RouteGroupSourcePicker({
  open,
  onClose,
  onConfirm,
  selectedCount,
  sourceKind,
  onSourceKindChange,
  site,
  onSiteChange,
  sites,
  query,
  onQueryChange,
  items,
  totalItemCount,
  isSelected,
  onToggle,
  hasMore,
  loading,
  onLoadMore,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selectedCount: number;
  sourceKind: RouteGroupExplicitSourceReference['kind'] | 'all';
  onSourceKindChange: (
    kind: RouteGroupExplicitSourceReference['kind'] | 'all',
  ) => void;
  site: string | null;
  onSiteChange: (site: string | null) => void;
  sites: string[];
  query: string;
  onQueryChange: (query: string) => void;
  items: RouteGroupSourceCatalogItem[];
  totalItemCount: number;
  isSelected: (source: RouteGroupSourceCatalogItem) => boolean;
  onToggle: (source: RouteGroupSourceCatalogItem) => void;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const selectedLabel = tr(
    'pages.tokenRoutes.routeGroupEditor.selectedSources',
  ).replace('{count}', String(selectedCount));

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      title={tr('pages.tokenRoutes.routeGroupSources')}
      maxWidth={980}
      closeOnEscape
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {selectedLabel}
          </span>
          <Button type="button" variant="outline" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {tr('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="grid content-start gap-3 rounded-md border bg-muted/20 p-3 lg:max-h-[min(56vh,620px)] lg:overflow-y-auto">
          <div className="grid gap-1">
            <span className="text-sm font-medium">
              {tr('pages.tokenRoutes.routeGroupEditor.sources')}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {items.length}/{totalItemCount}
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {tr('pages.tokenRoutes.routeGroupSources')}
            </span>
            <div className="flex flex-wrap gap-1">
              {(['all', 'execution_target', 'route_group'] as const).map(
                (kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={sourceKind === kind ? 'secondary' : 'outline'}
                    onClick={() => onSourceKindChange(kind)}
                  >
                    {kind === 'all'
                      ? tr('components.notificationPanel.all')
                      : routeGroupSourceKindLabelForKind(kind)}
                  </Button>
                ),
              )}
            </div>
          </div>
          {sites.length ? (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {tr('components.searchModal.sites2')}
              </span>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={site === null ? 'secondary' : 'outline'}
                  onClick={() => onSiteChange(null)}
                >
                  {tr('components.notificationPanel.all')}
                </Button>
                {sites.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={site === item ? 'secondary' : 'outline'}
                    onClick={() => onSiteChange(site === item ? null : item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
        <div className="grid min-h-0 gap-3">
          <Input
            value={query}
            placeholder={tr(
              'pages.tokenRoutes.routeGroupEditor.searchSources',
            )}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {items.length}/{totalItemCount}
            </span>
            <span>{selectedLabel}</span>
          </div>
          <div className="grid max-h-[min(56vh,620px)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {items.map((source) => {
              const selected = isSelected(source);
              return (
                <Button
                  key={routeGroupSourceKey(source)}
                  type="button"
                  variant="outline"
                  className={`h-auto min-w-0 justify-start p-0 text-left ${selected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/40'}`}
                  onClick={() => onToggle(source)}
                >
                  <span className="flex w-full min-w-0 flex-col gap-2 p-3">
                    <span className="flex min-w-0 items-start gap-2">
                      <span
                        aria-hidden
                        className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}`}
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {source.label}
                        </span>
                        {source.modelName ? (
                          <code className="mt-1 block truncate text-xs text-muted-foreground">
                            {source.modelName}
                          </code>
                        ) : null}
                      </span>
                      {!source.enabled ? (
                        <ToneBadge tone="-warning">
                          {tr('common.disabled')}
                        </ToneBadge>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {source.siteName ? (
                        <ToneBadge tone="-muted">{source.siteName}</ToneBadge>
                      ) : null}
                      <ToneBadge tone="-info">
                        {routeGroupSourceKindLabel(source.source)}
                      </ToneBadge>
                    </span>
                  </span>
                </Button>
              );
            })}
            {items.length === 0 ? (
              <EmptyStateBlock
                className="col-span-full rounded-md border bg-muted/20 p-6"
                title={tr('pages.tokenRoutes.routeGroupEditor.noSources')}
              />
            ) : null}
            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                className="col-span-full"
                disabled={loading}
                onClick={onLoadMore}
              >
                {loading && <LoaderCircle className="size-4 animate-spin" />}
                {tr('common.loadMore')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </CenteredModal>
  );
}
