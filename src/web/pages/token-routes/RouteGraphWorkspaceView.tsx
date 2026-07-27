import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Eye,
  Filter,
  GitBranch,
  Network,
  RefreshCw,
  Save,
  Search,
  Redo2,
  Undo2,
  Waypoints,
  XCircle,
} from 'lucide-react';
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphFocusRef,
  RouteGraphWorkspaceIndexFilters,
  RouteGraphWorkspaceIndexItem,
  RouteGraphWorkspaceIndexPage,
  RouteGraphWorkspacePortal,
  RouteGraphWorkspaceRepresentation,
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspaceRemovalImpact,
} from '../../../shared/routeGraphWorkspace.js';
import type { RouteGraphWorkspaceOperationBatch } from '../../../shared/routeGraphOperations.js';
import {
  api,
  type DispatchPolicyRegistryPayload,
  type RouteGraphEndpointCatalogItemPayload,
} from '../../api.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import DeleteConfirmModal from '../../components/DeleteConfirmModal.js';
import SegmentedTabBar from '../../components/SegmentedTabBar.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Input } from '../../components/ui/input/index.js';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
} from '../../components/ui/resizable/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { useIsMobile } from '../../components/useIsMobile.js';
import { tr } from '../../i18n.js';
import RouteGraphFocusInspector, {
  EmptyRouteGraphFocusInspector,
  RouteGraphDiagnosticsPanel,
  type RouteGraphFocusSelection,
} from './RouteGraphFocusInspector.js';
import RouteGraphNodeMenu from './RouteGraphNodeMenu.js';
import RouteGraphConnectionDialog from './RouteGraphConnectionDialog.js';
import { routeGraphCommandErrorMessage, routeGraphConnectionErrorCode, routeGraphConnectionErrorMessage } from './routeGraphConnectionErrors.js';
import {
  RouteGraphDirtyNavigationDialog,
  useRouteGraphDirtyNavigation,
} from './RouteGraphDirtyNavigation.js';
import {
  diffRouteGraphWorkspace,
  type RouteGraphWorkspaceSource,
} from './routeGraphWorkspace.js';
import {
  createPrimitiveNodeDraft,
} from './routeGraphWorkspaceAuthoring.js';
import { buildCandidateSelectorSurfacePorts } from '../../../shared/routeGraph.js';
import type {
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphNodeType,
} from './routeGraphTypes.js';

const RouteGraphFocusCanvas = lazy(() => import('./RouteGraphFocusCanvas.js'));

const FOCUS_KIND_PARAM = 'graphFocusKind';
const FOCUS_ID_PARAM = 'graphFocusId';
const REPRESENTATION_PARAM = 'graphRepresentation';
const INDEX_LIMIT = 40;
const inspectorLayoutStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined') window.localStorage?.setItem(key, value);
    } catch {
      // Storage can be unavailable in private or embedded browser contexts.
    }
  },
};

type WorkspaceLocation =
  | { kind: 'index' }
  | { kind: 'focus'; focus: RouteGraphFocusRef };

type NavigationTarget = {
  location: WorkspaceLocation;
  representation?: RouteGraphWorkspaceRepresentation;
  windowToken?: string;
  reload?: boolean;
};

type SelectedElement = RouteGraphFocusSelection;

function resolveSelectedElement(
  selected: SelectedElement | null,
  graph: RouteGraphWorkspaceSource,
  workspace: RouteGraphFocusedWorkspace,
): SelectedElement | null {
  if (!selected) return null;
  if (selected.kind === 'node') {
    const item = graph.nodes.find((node) => node.id === selected.item.id);
    return item ? { kind: 'node', item } : null;
  }
  if (selected.kind === 'macro') {
    const item = graph.macros.find((macro) => macro.id === selected.item.id);
    return item ? { kind: 'macro', item } : null;
  }
  if (selected.kind === 'edge') {
    const item = graph.edges.find((edge) => edge.id === selected.item.id);
    return item ? { kind: 'edge', item } : null;
  }
  const item = workspace.portals.find((portal) => portal.id === selected.item.id);
  return item ? { kind: 'portal', item } : null;
}

export type RouteGraphWorkspaceFocusIntent =
  | { id: number; kind: 'macro'; macroId: string }
  | { id: number; kind: 'node'; nodeId: string; macroId?: string | null };

type RouteGraphWorkspaceViewProps = {
  focusIntent?: RouteGraphWorkspaceFocusIntent | null;
  onFocusIntentConsumed?: (id: number) => void;
};

function focusEquals(left: RouteGraphFocusRef, right: RouteGraphFocusRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

function locationFromSearchParams(params: URLSearchParams): WorkspaceLocation {
  const kind = params.get(FOCUS_KIND_PARAM);
  const id = String(params.get(FOCUS_ID_PARAM) || '').trim();
  return (kind === 'macro' || kind === 'node') && id
    ? { kind: 'focus', focus: { kind, id } }
    : { kind: 'index' };
}

function representationFromSearchParams(params: URLSearchParams): RouteGraphWorkspaceRepresentation {
  return params.get(REPRESENTATION_PARAM) === 'primitive' ? 'primitive' : 'semantic';
}

function normalizeWorkspaceGraph(input: RouteGraphFocusedWorkspace['residentGraph']): RouteGraphWorkspaceSource {
  return {
    nodes: (input.nodes || []) as RouteGraphNode[],
    edges: (input.edges || []) as RouteGraphEdge[],
    macros: (input.macros || []) as RouteGraphMacro[],
    metadata: input.metadata,
  };
}

function graphContainsFocus(graph: RouteGraphWorkspaceSource, focus: RouteGraphFocusRef): boolean {
  return focus.kind === 'node'
    ? graph.nodes.some((node) => node.id === focus.id)
    : graph.macros.some((macro) => macro.id === focus.id);
}

function workspaceStatusLabel(item: RouteGraphWorkspaceIndexItem): string {
  return tr(`pages.tokenRoutes.routeGraphWorkspace.status.${item.status}`);
}

function workspaceKindLabel(kind: RouteGraphWorkspaceIndexItem['elementKind']): string {
  return tr(`pages.tokenRoutes.routeGraphWorkspace.kind.${kind}`);
}

function workspaceOwnershipLabel(ownership: RouteGraphWorkspaceIndexItem['ownership']): string {
  return tr(`pages.tokenRoutes.routeGraphWorkspace.ownership.${ownership}`);
}

function WorkspaceIndexSkeleton() {
  return (
    <div data-testid="route-graph-index-loading" className="grid gap-0" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="grid min-h-16 grid-cols-[minmax(0,1fr)_7rem] items-center gap-4 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem]">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

function FocusSkeleton() {
  return (
    <div data-testid="route-graph-focus-loading" className="grid h-[calc(100vh-230px)] min-h-[620px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border" aria-busy="true">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="relative overflow-hidden bg-muted/10 p-8">
        <Skeleton className="absolute left-[12%] top-[38%] h-28 w-56" />
        <Skeleton className="absolute left-[42%] top-[28%] h-32 w-60" />
        <Skeleton className="absolute right-[10%] top-[46%] h-24 w-48" />
      </div>
    </div>
  );
}

function IndexFilters({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filters: RouteGraphWorkspaceIndexFilters;
  onFiltersChange: (filters: RouteGraphWorkspaceIndexFilters) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b bg-muted/20 p-3 xl:flex-row xl:items-center">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          placeholder={tr('pages.tokenRoutes.routeGraphWorkspace.search')}
        />
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select
          value={filters.elementKind || 'all'}
          onValueChange={(value) => onFiltersChange({
            ...filters,
            elementKind: value === 'all' ? null : value as NonNullable<RouteGraphWorkspaceIndexFilters['elementKind']>,
          })}
        >
          <SelectTrigger className="h-9 w-[9.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr('pages.tokenRoutes.routeGraphWorkspace.allKinds')}</SelectItem>
            <SelectItem value="macro">{workspaceKindLabel('macro')}</SelectItem>
            <SelectItem value="entry">{workspaceKindLabel('entry')}</SelectItem>
            <SelectItem value="component">{workspaceKindLabel('component')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.ownership || 'all'}
          onValueChange={(value) => onFiltersChange({
            ...filters,
            ownership: value === 'all' ? null : value as NonNullable<RouteGraphWorkspaceIndexFilters['ownership']>,
          })}
        >
          <SelectTrigger className="h-9 w-[9.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr('pages.tokenRoutes.routeGraphWorkspace.allOwnership')}</SelectItem>
            <SelectItem value="manual">{workspaceOwnershipLabel('manual')}</SelectItem>
            <SelectItem value="system">{workspaceOwnershipLabel('system')}</SelectItem>
            <SelectItem value="mixed">{workspaceOwnershipLabel('mixed')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={filters.diagnosticState === 'issues' ? 'secondary' : 'outline'}
          onClick={() => onFiltersChange({
            ...filters,
            diagnosticState: filters.diagnosticState === 'issues' ? 'all' : 'issues',
          })}
        >
          <Filter size={14} />
          {tr('pages.tokenRoutes.routeGraphWorkspace.issuesOnly')}
        </Button>
      </div>
    </div>
  );
}

function WorkspaceIndexRow({
  item,
  selected,
  onSelect,
  onOpen,
}: {
  item: RouteGraphWorkspaceIndexItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const hasErrors = item.counts.errors > 0;
  const hasWarnings = item.counts.warnings > 0;
  return (
    <Button
      type="button"
      variant="ghost"
      className={`grid h-auto min-h-16 w-full grid-cols-[minmax(0,1fr)_7rem] items-center justify-normal gap-4 rounded-none border-x-0 border-t-0 border-b-border px-4 py-3 text-left font-normal transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] ${selected ? 'bg-accent/60' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          {item.elementKind === 'macro' ? <Boxes size={15} className="shrink-0 text-primary" /> : <CircleDot size={15} className="shrink-0 text-muted-foreground" />}
          <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
          {hasErrors && <XCircle size={14} className="shrink-0 text-destructive" />}
          {!hasErrors && hasWarnings && <AlertTriangle size={14} className="shrink-0 text-amber-500" />}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {item.subtitle || workspaceKindLabel(item.elementKind)}
        </span>
      </span>
      <span className="hidden text-xs text-muted-foreground md:block">{workspaceKindLabel(item.elementKind)}</span>
      <span className="hidden text-xs text-muted-foreground md:block">{workspaceOwnershipLabel(item.ownership)}</span>
      <span className="flex items-center justify-between gap-2">
        <Badge variant={item.status === 'enabled' ? 'success' : item.status === 'disabled' ? 'secondary' : 'warning'}>
          {workspaceStatusLabel(item)}
        </Badge>
        <ChevronRight size={15} className="text-muted-foreground" />
      </span>
    </Button>
  );
}

function IndexInspector({ item, onOpen }: { item: RouteGraphWorkspaceIndexItem; onOpen: () => void }) {
  return (
    <aside className="grid content-start gap-4 border-t bg-muted/10 p-4 xl:border-l xl:border-t-0">
      <div className="grid gap-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">{workspaceKindLabel(item.elementKind)}</span>
        <h3 className="break-words text-base font-semibold text-foreground">{item.label}</h3>
        {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <dt className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.ownership')}</dt>
        <dd className="text-right text-foreground">{workspaceOwnershipLabel(item.ownership)}</dd>
        <dt className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.connections')}</dt>
        <dd className="text-right text-foreground">{item.counts.directConnections}</dd>
        <dt className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.diagnostics')}</dt>
        <dd className="text-right text-foreground">{item.counts.errors + item.counts.warnings}</dd>
      </dl>
      <Button type="button" onClick={onOpen}>
        <Eye size={15} />
        {tr('pages.tokenRoutes.routeGraphWorkspace.openFocus')}
      </Button>
      <div className="grid gap-1 border-t pt-3">
        <span className="text-[11px] text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.identifier')}</span>
        <code className="break-all text-[11px] text-foreground">{item.focus.id}</code>
      </div>
    </aside>
  );
}

function RouteGraphOverview({ onOpen }: { onOpen: (focus: RouteGraphFocusRef) => void }) {
  const toast = useToast();
  const [queryInput, setQueryInput] = useState('');
  const [indexQuery, setIndexQuery] = useState<{
    query: string;
    filters: RouteGraphWorkspaceIndexFilters;
    cursorStack: Array<string | null>;
  }>({
    query: '',
    filters: { diagnosticState: 'all' },
    cursorStack: [null],
  });
  const [page, setPage] = useState<RouteGraphWorkspaceIndexPage | null>(null);
  const [selected, setSelected] = useState<RouteGraphWorkspaceIndexItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [resumeFocus, setResumeFocus] = useState<RouteGraphFocusRef | null>(null);
  const loadSequenceRef = useRef(0);
  const activeLoadControllerRef = useRef<AbortController | null>(null);
  const { query, filters, cursorStack } = indexQuery;
  const cursor = cursorStack.at(-1) || null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = queryInput.trim();
      if (nextQuery === query) return;
      setIndexQuery((current) => ({
        ...current,
        query: nextQuery,
        cursorStack: [null],
      }));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, queryInput]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    activeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    activeLoadControllerRef.current = controller;
    setLoading(true);
    try {
      const response = await api.getRouteGraphWorkspaceIndex({
        ...filters,
        query,
        cursor,
        limit: INDEX_LIMIT,
      }, { signal: controller.signal });
      if (sequence !== loadSequenceRef.current) return;
      setPage(response);
      setSelected((current) => (
        current ? response.items.find((item) => focusEquals(item.focus, current.focus)) || null : null
      ));
    } catch (error) {
      if (sequence === loadSequenceRef.current && !isAbortError(error)) {
        setPage(null);
        toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.loadFailed'));
      }
    } finally {
      if (activeLoadControllerRef.current === controller) activeLoadControllerRef.current = null;
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [cursor, filters, query, toast]);

  useEffect(() => {
    void load();
    return () => activeLoadControllerRef.current?.abort();
  }, [load]);
  useEffect(() => {
    let active = true;
    void api.getRouteGraphWorkspaceResume().then((result) => {
      if (active) setResumeFocus(result.focus);
    }).catch(() => {
      if (active) setResumeFocus(null);
    });
    return () => { active = false; };
  }, [page?.revision]);

  const createNode = useCallback(async (type: RouteGraphNodeType) => {
    if (!page || creating) return;
    const node = createPrimitiveNodeDraft(type, page.summary.nodes, { x: 120, y: 120 });
    setCreating(true);
    try {
      const result = await api.createRouteGraphWorkspaceNode({
        revision: page.revision,
        node,
      });
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.nodeCreated'));
      onOpen({ kind: 'node', id: result.node.id });
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.addNodeFailed'));
    } finally {
      setCreating(false);
    }
  }, [creating, onOpen, page, toast]);

  const createMacro = useCallback(async () => {
    if (!page || creating) return;
    setCreating(true);
    try {
      const result = await api.createRouteGraphWorkspaceMacro({
        revision: page.revision,
        macro: {
          kind: 'candidate_selector',
          name: tr('pages.tokenRoutes.routeGraphWorkspace.newCandidateSelectorMacro'),
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'none' },
              output: 'route',
              ports: buildCandidateSelectorSurfacePorts({ entry: { kind: 'none' }, output: 'route' }),
            },
            policy: { kind: 'inherit_default' },
            groups: [],
          },
        },
      });
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.macroCreated'));
      onOpen({ kind: 'macro', id: result.macro.id });
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.addMacroFailed'));
    } finally {
      setCreating(false);
    }
  }, [creating, onOpen, page, toast]);

  return (
    <section className="grid min-w-0 gap-3">
      <header className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Network size={17} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.overview')}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.overviewDescription')}</p>
        </div>
        {page && (
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.focuses')} {page.summary.focuses}</Badge>
              <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.macros')} {page.summary.macros}</Badge>
              <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.nodes')} {page.summary.nodes}</Badge>
              {page.summary.errors > 0 && <Badge variant="destructive">{tr('pages.tokenRoutes.routeGraphWorkspace.errors')} {page.summary.errors}</Badge>}
            </div>
            {resumeFocus && (
              <Button type="button" size="sm" variant="outline" onClick={() => onOpen(resumeFocus)}>
                {tr('pages.tokenRoutes.routeGraphWorkspace.continueDraft')}
              </Button>
            )}
            <RouteGraphNodeMenu disabled={creating} onSelect={(type) => void createNode(type)} onSelectMacro={() => void createMacro()} />
          </div>
        )}
      </header>

      <div className="overflow-hidden rounded-md border bg-card">
        <IndexFilters
          query={queryInput}
          onQueryChange={setQueryInput}
          filters={filters}
          onFiltersChange={(next) => {
            setIndexQuery((current) => ({
              ...current,
              filters: next,
              cursorStack: [null],
            }));
          }}
        />
        <div className={`grid min-h-[520px] ${selected ? 'xl:grid-cols-[minmax(0,1fr)_18rem]' : ''}`}>
          <div className="min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase text-muted-foreground md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem]">
              <span>{tr('pages.tokenRoutes.routeGraphWorkspace.focus')}</span>
              <span className="hidden md:block">{tr('pages.tokenRoutes.routeGraphWorkspace.kindLabel')}</span>
              <span className="hidden md:block">{tr('pages.tokenRoutes.routeGraphWorkspace.ownership')}</span>
              <span>{tr('pages.tokenRoutes.routeGraphWorkspace.statusLabel')}</span>
            </div>
            {loading && !page ? (
              <WorkspaceIndexSkeleton />
            ) : page?.items.length ? (
              <div className={loading ? 'pointer-events-none opacity-60' : ''}>
                {page.items.map((item) => (
                  <WorkspaceIndexRow
                    key={`${item.focus.kind}:${item.focus.id}`}
                    item={item}
                    selected={!!selected && focusEquals(selected.focus, item.focus)}
                    onSelect={() => setSelected(item)}
                    onOpen={() => onOpen(item.focus)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center p-6">
                <EmptyStateBlock
                  title={tr('pages.tokenRoutes.routeGraphWorkspace.empty')}
                  description={tr('pages.tokenRoutes.routeGraphWorkspace.emptyDescription')}
                  icon={<Search size={18} />}
                />
              </div>
            )}
            <footer className="flex items-center justify-between border-t bg-muted/15 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {page ? tr('pages.tokenRoutes.routeGraphWorkspace.resultCount').replace('{count}', String(page.totalCount)) : ''}
              </span>
              <ButtonGroup>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={cursorStack.length <= 1 || loading}
                  onClick={() => setIndexQuery((current) => ({
                    ...current,
                    cursorStack: current.cursorStack.slice(0, -1),
                  }))}
                >
                  <ArrowLeft size={14} />
                  {tr('common.previous')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!page?.nextCursor || loading}
                  onClick={() => page?.nextCursor && setIndexQuery((current) => ({
                    ...current,
                    cursorStack: [...current.cursorStack, page.nextCursor],
                  }))}
                >
                  {tr('common.next')}
                  <ArrowRight size={14} />
                </Button>
              </ButtonGroup>
            </footer>
          </div>
          {selected && <IndexInspector item={selected} onOpen={() => onOpen(selected.focus)} />}
        </div>
      </div>
    </section>
  );
}

function RouteGraphFocus({
  focus,
  representation,
  onNavigate,
  onRepresentationChange,
}: {
  focus: RouteGraphFocusRef;
  representation: RouteGraphWorkspaceRepresentation;
  onNavigate: (target: NavigationTarget) => void;
  onRepresentationChange: (representation: RouteGraphWorkspaceRepresentation) => void;
}) {
  const [policyRegistry, setPolicyRegistry] = useState<DispatchPolicyRegistryPayload | null>(null);
  useEffect(() => {
    let active = true;
    void api.getRuntimeSettings().then((settings: { dispatchPolicyRegistry?: DispatchPolicyRegistryPayload }) => {
      if (active) setPolicyRegistry(settings.dispatchPolicyRegistry || null);
    }).catch(() => {
      if (active) setPolicyRegistry(null);
    });
    return () => { active = false; };
  }, []);
  const toast = useToast();
  const focusKind = focus.kind;
  const focusId = focus.id;
  const [workspace, setWorkspace] = useState<RouteGraphFocusedWorkspace | null>(null);
  const [baseGraph, setBaseGraph] = useState<RouteGraphWorkspaceSource | null>(null);
  const [graph, setGraph] = useState<RouteGraphWorkspaceSource | null>(null);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [operationHistory, setOperationHistory] = useState<RouteGraphWorkspaceOperationBatch[]>([]);
  const [operationHistoryPending, setOperationHistoryPending] = useState(false);
  const [redoBatchId, setRedoBatchId] = useState<number | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<NavigationTarget | null>(null);
  const [connectionSession, setConnectionSession] = useState<{
    source: RouteGraphWorkspaceConnectionEndpointRef;
    replacingEdgeId?: string;
  } | null>(null);
  const [endpointCatalogQuery, setEndpointCatalogQuery] = useState('');
  const [endpointCatalogPage, setEndpointCatalogPage] = useState(1);
  const [endpointCatalogItems, setEndpointCatalogItems] = useState<RouteGraphEndpointCatalogItemPayload[]>([]);
  const [endpointCatalogHasMore, setEndpointCatalogHasMore] = useState(false);
  const [endpointCatalogLoading, setEndpointCatalogLoading] = useState(false);
  const endpointCatalogRequestRef = useRef(0);
  const [pendingElementRemoval, setPendingElementRemoval] = useState<{
    selected: Extract<RouteGraphFocusSelection, { kind: 'node' | 'macro' }>;
    graphElementId: string;
    impact: RouteGraphWorkspaceRemovalImpact | null;
    loading: boolean;
  } | null>(null);
  const loadSequenceRef = useRef(0);
  const activeLoadControllerRef = useRef<AbortController | null>(null);
  const compactInspector = useIsMobile(1279);
  const inspectorLayout = useDefaultLayout({
    id: 'route-graph-focus-inspector',
    panelIds: ['canvas', 'inspector'],
    storage: inspectorLayoutStorage,
  });

  const operations = useMemo(() => (
    baseGraph && graph ? diffRouteGraphWorkspace(baseGraph, graph) : []
  ), [baseGraph, graph]);
  const dirty = operations.length > 0;
  const navigationBlocker = useRouteGraphDirtyNavigation(dirty);
  const selectedRouteEndpoint = useMemo(() => {
    if (selected?.kind !== 'node' || !graph) return null;
    const node = graph.nodes.find((item) => item.id === selected.item.id);
    return node?.type === 'route_endpoint' ? node : null;
  }, [graph, selected]);
  const needsEndpointCatalog = selectedRouteEndpoint?.backend.kind === 'route_endpoints';

  useEffect(() => {
    setEndpointCatalogQuery('');
    setEndpointCatalogPage(1);
    setEndpointCatalogItems([]);
    setEndpointCatalogHasMore(false);
  }, [selectedRouteEndpoint?.id]);

  useEffect(() => {
    if (!needsEndpointCatalog || !workspace) {
      setEndpointCatalogLoading(false);
      return;
    }
    const requestId = ++endpointCatalogRequestRef.current;
    const timer = window.setTimeout(() => {
      setEndpointCatalogLoading(true);
      void api.getRouteGraphEndpointPage({
        page: endpointCatalogPage,
        pageSize: 50,
        endpointKind: 'supply',
        q: endpointCatalogQuery || undefined,
        revision: workspace!.revision,
      }).then((response) => {
        if (requestId !== endpointCatalogRequestRef.current) return;
        setEndpointCatalogItems((current) => endpointCatalogPage === 1
          ? response.items
          : Array.from(new Map([...current, ...response.items].map((item) => [item.endpointId, item])).values()));
        setEndpointCatalogHasMore(response.pageInfo.hasMore);
      }).catch(() => {
        if (requestId !== endpointCatalogRequestRef.current) return;
        if (endpointCatalogPage === 1) setEndpointCatalogItems([]);
        setEndpointCatalogHasMore(false);
      }).finally(() => {
        if (requestId === endpointCatalogRequestRef.current) setEndpointCatalogLoading(false);
      });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      endpointCatalogRequestRef.current += 1;
    };
  }, [endpointCatalogPage, endpointCatalogQuery, needsEndpointCatalog, workspace]);

  const referenceEndpoints = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    for (const endpointId of selectedRouteEndpoint?.backend.kind === 'route_endpoints'
      ? selectedRouteEndpoint.backend.endpointIds
      : []) {
      byId.set(endpointId, { id: endpointId, label: endpointId });
    }
    for (const node of graph?.nodes || []) {
      if (node.type === 'route_endpoint') {
        byId.set(node.routeEndpointId, { id: node.routeEndpointId, label: node.name || node.routeEndpointId });
      }
    }
    for (const endpoint of endpointCatalogItems) {
      byId.set(endpoint.endpointId, { id: endpoint.endpointId, label: endpoint.label || endpoint.endpointId });
    }
    return Array.from(byId.values());
  }, [endpointCatalogItems, graph?.nodes, selectedRouteEndpoint]);

  const load = useCallback(async (windowToken?: string) => {
    const sequence = ++loadSequenceRef.current;
    activeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    activeLoadControllerRef.current = controller;
    setLoading(true);
    setWorkspace(null);
    setBaseGraph(null);
    setGraph(null);
    setSelected(null);
    setConnectionSession(null);
    setPendingElementRemoval(null);
    try {
      const response = await api.getRouteGraphFocusedWorkspace(
        { focus: { kind: focusKind, id: focusId }, representation, windowToken },
        { signal: controller.signal },
      );
      if (sequence !== loadSequenceRef.current) return;
      const nextGraph = normalizeWorkspaceGraph(response.residentGraph);
      setWorkspace(response);
      setBaseGraph(nextGraph);
      setGraph(nextGraph);
    } catch (error) {
      if (sequence === loadSequenceRef.current && !isAbortError(error)) {
        toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.loadFailed'));
      }
    } finally {
      if (activeLoadControllerRef.current === controller) activeLoadControllerRef.current = null;
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [focusId, focusKind, representation, toast]);

  useEffect(() => {
    void load();
    return () => activeLoadControllerRef.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    void api.getRouteGraphWorkspaceOperationBatches({ limit: 30 }).then((batches) => {
      if (active) setOperationHistory(batches);
    }).catch(() => {
      if (active) setOperationHistory([]);
    });
    return () => { active = false; };
  }, [workspace?.revision]);
  const requestNavigation = useCallback((target: NavigationTarget) => {
    if (target.windowToken || target.reload) {
      if (dirty) setPendingNavigation(target);
      else void load(target.windowToken);
      return;
    }
    setPendingNavigation(null);
    onNavigate(target);
  }, [dirty, load, onNavigate]);

  const undoBatch = operationHistory.find((batch) => batch.resultRevision === workspace?.revision) || null;
  const replayOperationBatch = useCallback(async (batchId: number, direction: 'undo' | 'replay') => {
    if (!workspace || operationHistoryPending) return;
    if (dirty && !globalThis.confirm(tr('pages.tokenRoutes.routeGraphWorkspace.historyDiscardDirtyConfirm'))) return;
    setOperationHistoryPending(true);
    try {
      await api.replayRouteGraphWorkspaceOperationBatch(batchId, { revision: workspace.revision, direction });
      setRedoBatchId(direction === 'undo' ? batchId : null);
      toast.success(tr(direction === 'undo'
        ? 'pages.tokenRoutes.routeGraphWorkspace.undoComplete'
        : 'pages.tokenRoutes.routeGraphWorkspace.redoComplete'));
      await load();
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.historyOperationFailed'));
    } finally {
      setOperationHistoryPending(false);
    }
  }, [dirty, load, operationHistoryPending, toast, workspace]);

  const continuePendingNavigation = useCallback((afterSave = false) => {
    const target = pendingNavigation;
    setPendingNavigation(null);
    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.proceed();
      return;
    }
    if (!target) return;
    if (target.windowToken || target.reload) {
      // Window tokens are revision-bound. After a save, reload the authoritative
      // first window instead of replaying a token from the previous revision.
      void load(afterSave ? undefined : target.windowToken);
    }
    else onNavigate(target);
  }, [load, navigationBlocker, onNavigate, pendingNavigation]);

  const stayInWorkspace = useCallback(() => {
    setPendingNavigation(null);
    if (navigationBlocker.state === 'blocked') navigationBlocker.reset();
  }, [navigationBlocker]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!workspace || operations.length === 0) return true;
    setSaving(true);
    try {
      const result = await api.applyRouteGraphWorkspaceOperations({
        revision: workspace.revision,
        operations,
      });
      setWorkspace((current) => current ? { ...current, revision: result.revision } : current);
      setBaseGraph(graph);
      setRedoBatchId(null);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.saved'));
      return true;
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [graph, operations, toast, workspace]);

  const saveAndContinue = useCallback(async () => {
    if (await save()) continuePendingNavigation(true);
  }, [continuePendingNavigation, save]);

  const createFocusedNode = useCallback(async (
    type: RouteGraphNodeType,
    position: { x: number; y: number },
  ): Promise<RouteGraphNode | null> => {
    if (!workspace || !graph) return null;
    try {
      const node = createPrimitiveNodeDraft(type, graph.nodes.length, position);
      const result = await api.reserveRouteGraphWorkspaceNode({ node });
      const nextGraph = { ...graph, nodes: [...graph.nodes, result.node] };
      setWorkspace((current) => current ? {
        ...current,
        residentGraph: nextGraph,
        residentElements: [
          ...current.residentElements,
          {
            element: { kind: 'node', id: result.node.id },
            graphElementId: result.node.id,
          },
        ],
        totals: { ...current.totals, nodes: current.totals.nodes + 1 },
      } : current);
      setGraph(nextGraph);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.nodeCreated'));
      return result.node;
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.addNodeFailed'));
      return null;
    }
  }, [dirty, graph, toast, workspace]);

  const validate = useCallback(async () => {
    if (!workspace) return;
    setValidating(true);
    try {
      const response = await api.validateRouteGraphWorkspace({ revision: workspace.revision, operations });
      const diagnostics = response.diagnostics;
      setWorkspace((current) => current ? { ...current, diagnostics } : current);
      if (response?.ok) toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.validationPassed'));
      else toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.validationFailed').replace('{count}', String(diagnostics.length)));
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.validationFailed').replace('{count}', '1'));
    } finally {
      setValidating(false);
    }
  }, [operations, toast, workspace]);

  const publish = useCallback(async () => {
    if (dirty) return;
    setPublishing(true);
    try {
      await api.publishRouteGraphDraft();
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.published'));
      await load();
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.publishFailed'));
    } finally {
      setPublishing(false);
    }
  }, [dirty, load, toast]);

  const openPortal = useCallback((portal: RouteGraphWorkspacePortal) => {
    if (portal.destination.kind === 'focus') {
      requestNavigation({ location: { kind: 'focus', focus: portal.destination.focus }, representation });
      return;
    }
    requestNavigation({
      location: { kind: 'focus', focus },
      representation,
      windowToken: portal.destination.token,
    });
  }, [focus, representation, requestNavigation]);

  const deletePortalEdge = useCallback(async (edgeId: string) => {
    if (!workspace || dirty) return;
    try {
      await api.applyRouteGraphWorkspaceOperations({
        revision: workspace.revision,
        operations: [{ kind: 'remove_edge', edgeId }],
      });
      setSelected(null);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.edgeDeleted'));
      await load();
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.deleteEdgeFailed'));
    }
  }, [dirty, load, toast, workspace]);

  const inspectConnectionFocus = useCallback((targetFocus: RouteGraphFocusRef) => {
    const url = new URL(window.location.href);
    url.searchParams.set(FOCUS_KIND_PARAM, targetFocus.kind);
    url.searchParams.set(FOCUS_ID_PARAM, targetFocus.id);
    url.searchParams.delete(REPRESENTATION_PARAM);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }, []);

  const createConnection = useCallback(async (
    first: RouteGraphWorkspaceConnectionEndpointRef,
    second: RouteGraphWorkspaceConnectionEndpointRef,
  ) => {
    if (!workspace || !baseGraph || !graph) return;
    try {
      const response = await api.draftRouteGraphWorkspaceConnection({
        revision: workspace.revision,
        operations: diffRouteGraphWorkspace(baseGraph, graph),
        first,
        second,
      });
      setGraph((current) => current ? { ...current, edges: [...current.edges, response.edge] } : current);
      toast.success(tr('pages.tokenRoutes.routeGraphConnection.connected'));
    } catch (error) {
      toast.error(routeGraphConnectionErrorMessage(error));
      if (routeGraphConnectionErrorCode(error) === 'stale_revision') await load();
    }
  }, [baseGraph, graph, load, toast, workspace]);

  const requestElementRemoval = useCallback(async (
    selectedElement: Extract<RouteGraphFocusSelection, { kind: 'node' | 'macro' }>,
    graphElementId: string,
  ) => {
    if (!workspace || !baseGraph || !graph) return;
    const existsAtRevision = selectedElement.kind === 'node'
      ? baseGraph.nodes.some((node) => node.id === selectedElement.item.id)
      : baseGraph.macros.some((macro) => macro.id === selectedElement.item.id);
    const localEdges = graph.edges.filter((edge) => (
      edge.sourceNodeId === graphElementId || edge.targetNodeId === graphElementId
    ));
    if (!existsAtRevision) {
      setPendingElementRemoval({
        selected: selectedElement,
        graphElementId,
        loading: false,
        impact: {
          revision: workspace.revision,
          element: { kind: selectedElement.kind, id: selectedElement.item.id },
          elementLabel: String(selectedElement.item.name || selectedElement.item.id),
          incidentConnections: {
            total: localEdges.length,
            incoming: localEdges.filter((edge) => edge.targetNodeId === graphElementId).length,
            outgoing: localEdges.filter((edge) => edge.sourceNodeId === graphElementId).length,
          },
        },
      });
      return;
    }
    setPendingElementRemoval({ selected: selectedElement, graphElementId, impact: null, loading: true });
    try {
      const impact = await api.getRouteGraphWorkspaceRemovalImpact({
        revision: workspace.revision,
        element: { kind: selectedElement.kind, id: selectedElement.item.id },
      });
      setPendingElementRemoval((current) => current ? { ...current, impact, loading: false } : current);
    } catch (error) {
      setPendingElementRemoval(null);
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.removalImpactFailed'));
    }
  }, [baseGraph, graph, toast, workspace]);

  const confirmElementRemoval = useCallback(() => {
    if (!pendingElementRemoval || !graph) return;
    const selectedElement = pendingElementRemoval.selected;
    const graphElementId = pendingElementRemoval.graphElementId;
    setGraph(selectedElement.kind === 'node'
      ? { ...graph, nodes: graph.nodes.filter((node) => node.id !== selectedElement.item.id), edges: graph.edges.filter((edge) => edge.sourceNodeId !== graphElementId && edge.targetNodeId !== graphElementId) }
      : { ...graph, macros: graph.macros.filter((macro) => macro.id !== selectedElement.item.id), edges: graph.edges.filter((edge) => edge.sourceNodeId !== graphElementId && edge.targetNodeId !== graphElementId) });
    setSelected(null);
    setPendingElementRemoval(null);
  }, [graph, pendingElementRemoval]);

  const startConnection = useCallback((source: RouteGraphWorkspaceConnectionEndpointRef) => {
    setConnectionSession({ source });
  }, []);

  if (loading || !workspace || !graph || !baseGraph) return <FocusSkeleton />;

  const editable = workspace.capabilities.editable && representation === 'semantic';
  const currentSelected = resolveSelectedElement(selected, graph, workspace);
  const errorCount = workspace.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = workspace.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const canvasSurface = (
    <div className="relative h-full min-w-0 overflow-hidden">
      <Suspense fallback={<FocusSkeleton />}>
        <RouteGraphFocusCanvas
          workspace={workspace}
          graph={graph}
          editable={editable}
          onGraphChange={setGraph}
          onCreateNode={createFocusedNode}
          onSelect={setSelected}
          onOpenPortal={openPortal}
          onStartConnection={startConnection}
          onCreateConnection={(first, second) => { void createConnection(first, second); }}
          connectionAuthoringEnabled={editable}
        />
      </Suspense>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
        <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.resident')} {graph.nodes.length + graph.macros.length}/{workspace.totals.nodes + workspace.totals.macros}</Badge>
        {workspace.portals.length > 0 && <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.portals')} {workspace.portals.length}</Badge>}
        {errorCount > 0 && <Badge variant="destructive">{tr('pages.tokenRoutes.routeGraphWorkspace.errors')} {errorCount}</Badge>}
        {warningCount > 0 && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkspace.warnings')} {warningCount}</Badge>}
      </div>
      <RouteGraphConnectionDialog
        open={!!connectionSession}
        revision={workspace.revision}
        source={connectionSession?.source || null}
        replacingEdgeId={connectionSession?.replacingEdgeId}
        operations={operations}
        onClose={() => setConnectionSession(null)}
        onConnected={(edge) => setGraph((current) => current ? { ...current, edges: [...current.edges, edge] } : current)}
        onInvalidated={async () => { await load(); }}
        onInspectFocus={inspectConnectionFocus}
      />
    </div>
  );
  const inspectorSurface = currentSelected ? (
    <RouteGraphFocusInspector
      workspace={workspace}
      selected={currentSelected}
      selectedGraphElementId={currentSelected.kind === 'node' || currentSelected.kind === 'macro'
        ? workspace.residentElements.find((binding) => (
          binding.element.kind === currentSelected.kind && binding.element.id === currentSelected.item.id
        ))?.graphElementId || null
        : null}
      graph={graph}
      editable={editable}
      connectionAuthoringEnabled={editable}
      onGraphChange={setGraph}
      onSelect={setSelected}
      onOpenPortal={openPortal}
      onDeletePortalEdge={(edgeId) => void deletePortalEdge(edgeId)}
      onRewirePortalEdge={(source, replacingEdgeId) => setConnectionSession({ source, replacingEdgeId })}
      onRequestDeleteElement={(selectedElement, graphElementId) => void requestElementRemoval(selectedElement, graphElementId)}
      onClose={() => setSelected(null)}
      policyRegistry={policyRegistry}
      referenceEndpoints={referenceEndpoints}
      referenceEndpointCatalog={needsEndpointCatalog ? {
        query: endpointCatalogQuery,
        loading: endpointCatalogLoading,
        hasMore: endpointCatalogHasMore,
        onQueryChange: (query) => {
          setEndpointCatalogQuery(query);
          setEndpointCatalogPage(1);
        },
        onLoadMore: () => setEndpointCatalogPage((page) => page + 1),
      } : undefined}
    />
  ) : <EmptyRouteGraphFocusInspector />;

  return (
    <section className="grid min-w-0 gap-3">
      <header className="flex min-w-0 flex-col gap-2 rounded-md border bg-card p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => requestNavigation({ location: { kind: 'index' } })}
            title={tr('pages.tokenRoutes.routeGraphWorkspace.backToOverview')}
          >
            <ArrowLeft size={15} />
          </Button>
          <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label={tr('pages.tokenRoutes.routeGraphWorkspace.breadcrumb')}>
            <Button type="button" size="sm" variant="ghost" className="h-auto shrink-0 border-0 p-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => requestNavigation({ location: { kind: 'index' } })}>
              {tr('pages.tokenRoutes.routeGraphWorkspace.overview')}
            </Button>
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">{workspace.focus.label}</span>
          </nav>
          {dirty && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkspace.unsaved')}</Badge>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedTabBar
            value={representation}
            onValueChange={(value) => {
              const next = value as RouteGraphWorkspaceRepresentation;
              if (dirty) requestNavigation({ location: { kind: 'focus', focus }, representation: next });
              else onRepresentationChange(next);
            }}
            items={[
              { value: 'semantic', label: tr('pages.tokenRoutes.routeGraphWorkspace.semantic'), icon: <GitBranch size={14} /> },
              {
                value: 'primitive',
                label: (
                  <span title={!workspace.capabilities.primitiveAvailable ? tr('pages.tokenRoutes.routeGraphWorkspace.primitiveUnavailable') : undefined}>
                    {tr('pages.tokenRoutes.routeGraphWorkspace.primitive')}
                  </span>
                ),
                icon: <Waypoints size={14} />,
                disabled: !workspace.capabilities.primitiveAvailable,
              },
            ]}
          />
          {!editable && representation === 'primitive' && (
            <Badge variant="secondary">{tr('pages.tokenRoutes.routeGraphWorkspace.readOnly')}</Badge>
          )}
          <ButtonGroup>
            <Button type="button" size="sm" variant="outline" disabled={!undoBatch || operationHistoryPending} onClick={() => undoBatch && void replayOperationBatch(undoBatch.id, 'undo')} title={tr('pages.tokenRoutes.routeGraphWorkspace.undo')}>
              <Undo2 size={14} />
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!redoBatchId || operationHistoryPending} onClick={() => redoBatchId && void replayOperationBatch(redoBatchId, 'replay')} title={tr('pages.tokenRoutes.routeGraphWorkspace.redo')}>
              <Redo2 size={14} />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => requestNavigation({ location: { kind: 'focus', focus }, representation, reload: true })} disabled={saving || validating || publishing}>
              <RefreshCw size={14} />
              {tr('common.refresh')}
            </Button>
          </ButtonGroup>
          {editable && (
            <ButtonGroup>
              <Button type="button" size="sm" variant="outline" onClick={() => void validate()} disabled={validating || saving}>
                <CheckCircle2 size={14} />
                {tr('pages.tokenRoutes.routeGraphWorkspace.validate')}
              </Button>
              <Button type="button" size="sm" onClick={() => void save().then((saved) => {
                if (!saved) return;
                if (!graphContainsFocus(graph, focus)) {
                  onNavigate({ location: { kind: 'index' } });
                  return;
                }
                return load();
              })} disabled={!dirty || saving || validating}>
                <Save size={14} />
                {tr('pages.tokenRoutes.routeGraphWorkspace.save')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void publish()} disabled={dirty || publishing || errorCount > 0}>
                {tr('pages.tokenRoutes.routeGraphWorkspace.publish')}
              </Button>
            </ButtonGroup>
          )}
        </div>
      </header>

      <div className="relative h-[calc(100vh-245px)] min-h-[620px] overflow-hidden rounded-md border bg-background">
        {compactInspector ? (
          <div className="relative h-full overflow-hidden">
            {canvasSurface}
            <div className={`${currentSelected ? 'absolute inset-y-0 right-0 z-20 w-[min(100%,24rem)] overflow-hidden bg-background shadow-xl' : 'hidden'}`}>
              {inspectorSurface}
            </div>
          </div>
        ) : (
          <ResizablePanelGroup
            id="route-graph-focus-inspector"
            orientation="horizontal"
            defaultLayout={inspectorLayout.defaultLayout}
            onLayoutChanged={inspectorLayout.onLayoutChanged}
          >
            <ResizablePanel id="canvas" minSize="28rem">
              {canvasSurface}
            </ResizablePanel>
            <ResizableHandle
              withHandle
              className="route-graph-focus-resize-handle"
              aria-label={tr('pages.tokenRoutes.routeGraphWorkspace.resizeInspector')}
              title={tr('pages.tokenRoutes.routeGraphWorkspace.resizeInspector')}
            />
            <ResizablePanel
              id="inspector"
              defaultSize="24rem"
              minSize="18rem"
              maxSize="50%"
              groupResizeBehavior="preserve-pixel-size"
            >
              <div className="h-full min-h-0 overflow-hidden">{inspectorSurface}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <RouteGraphDiagnosticsPanel
        diagnostics={workspace.diagnostics}
        workspace={workspace}
        graph={graph}
        onSelect={setSelected}
      />

      <RouteGraphDirtyNavigationDialog
        open={pendingNavigation !== null || navigationBlocker.state === 'blocked'}
        saving={saving}
        onStay={stayInWorkspace}
        onDiscard={() => continuePendingNavigation()}
        onSave={() => void saveAndContinue()}
      />
      <DeleteConfirmModal
        open={!!pendingElementRemoval}
        loading={pendingElementRemoval?.loading}
        title={tr('pages.tokenRoutes.routeGraphWorkspace.removeElementTitle')}
        description={pendingElementRemoval?.impact
          ? tr('pages.tokenRoutes.routeGraphWorkspace.removeElementDescription')
            .replace('{name}', pendingElementRemoval.impact.elementLabel)
            .replace('{total}', String(pendingElementRemoval.impact.incidentConnections.total))
            .replace('{incoming}', String(pendingElementRemoval.impact.incidentConnections.incoming))
            .replace('{outgoing}', String(pendingElementRemoval.impact.incidentConnections.outgoing))
          : tr('pages.tokenRoutes.routeGraphWorkspace.loadingRemovalImpact')}
        onConfirm={confirmElementRemoval}
        onClose={() => { if (!pendingElementRemoval?.loading) setPendingElementRemoval(null); }}
      />
    </section>
  );
}

export default function RouteGraphWorkspaceView({
  focusIntent = null,
  onFocusIntentConsumed,
}: RouteGraphWorkspaceViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = locationFromSearchParams(searchParams);
  const representation = representationFromSearchParams(searchParams);
  const consumedIntentRef = useRef<number | null>(null);

  const updateLocation = useCallback((target: NavigationTarget, replace = false) => {
    const next = new URLSearchParams(searchParams);
    if (target.location.kind === 'index') {
      next.delete(FOCUS_KIND_PARAM);
      next.delete(FOCUS_ID_PARAM);
      next.delete(REPRESENTATION_PARAM);
    } else {
      next.set(FOCUS_KIND_PARAM, target.location.focus.kind);
      next.set(FOCUS_ID_PARAM, target.location.focus.id);
      const nextRepresentation = target.representation || representation;
      if (nextRepresentation === 'primitive') next.set(REPRESENTATION_PARAM, 'primitive');
      else next.delete(REPRESENTATION_PARAM);
    }
    setSearchParams(next, { replace });
  }, [representation, searchParams, setSearchParams]);

  useEffect(() => {
    if (!focusIntent || consumedIntentRef.current === focusIntent.id) return;
    consumedIntentRef.current = focusIntent.id;
    const focus = focusIntent.kind === 'macro'
      ? { kind: 'macro' as const, id: focusIntent.macroId }
      : { kind: 'node' as const, id: focusIntent.nodeId };
    updateLocation({ location: { kind: 'focus', focus }, representation: 'semantic' });
    onFocusIntentConsumed?.(focusIntent.id);
  }, [focusIntent, onFocusIntentConsumed, updateLocation]);

  if (location.kind === 'index') {
    return <RouteGraphOverview onOpen={(focus) => updateLocation({ location: { kind: 'focus', focus }, representation: 'semantic' })} />;
  }
  return (
    <RouteGraphFocus
      key={`${location.focus.kind}:${location.focus.id}:${representation}`}
      focus={location.focus}
      representation={representation}
      onNavigate={updateLocation}
      onRepresentationChange={(next) => updateLocation({ location, representation: next })}
    />
  );
}
