import { ArrowLeft, ArrowRight, ExternalLink, Link2, LoaderCircle, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspaceConnectionTargetPage,
} from '../../../shared/routeGraphWorkspace.js';
import type { RouteGraphEdge } from '../../../shared/routeGraph.js';
import type { RouteGraphWorkspaceOperation } from '../../../shared/routeGraphOperations.js';
import { api } from '../../api.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import * as Dialog from '../../components/ui/dialog/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { tr } from '../../i18n.js';
import { routeGraphConnectionErrorCode, routeGraphConnectionErrorMessage } from './routeGraphConnectionErrors.js';

type Props = {
  open: boolean;
  revision: string;
  source: RouteGraphWorkspaceConnectionEndpointRef | null;
  replacingEdgeId?: string | null;
  operations: RouteGraphWorkspaceOperation[];
  onClose: () => void;
  onConnected: (edge: RouteGraphEdge) => Promise<void> | void;
  onInvalidated: () => Promise<void> | void;
  onInspectFocus: (focus: RouteGraphWorkspaceConnectionTargetPage['items'][number]['focuses'][number]['focus']) => void;
};

function LoadingRows() {
  return <div className="grid gap-1.5 py-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>;
}

export default function RouteGraphConnectionDialog({ open, revision, source, replacingEdgeId, operations, onClose, onConnected, onInvalidated, onInspectFocus }: Props) {
  const toast = useToast();
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState<RouteGraphWorkspaceConnectionTargetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const cursor = cursorStack.at(-1) || null;

  useEffect(() => {
    if (!open) return;
    setQueryInput('');
    setQuery('');
    setCursorStack([null]);
    setPage(null);
    setConnectingKey(null);
  }, [open, replacingEdgeId, source?.element.id, source?.portId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const next = queryInput.trim();
      if (next === query) return;
      setQuery(next);
      setCursorStack([null]);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, query, queryInput]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!open || !source) return;
    const sequence = ++sequenceRef.current;
    setLoading(true);
    try {
      const response = await api.queryRouteGraphWorkspaceConnectionTargets({ revision, operations, source, replacingEdgeId, cursor, limit: 24, query }, { signal });
      if (sequence === sequenceRef.current) setPage(response);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || sequence !== sequenceRef.current) return;
      const code = routeGraphConnectionErrorCode(error);
      toast.error(routeGraphConnectionErrorMessage(error));
      if (code === 'invalid_connection_cursor' && cursorStack.length > 1) {
        setPage(null);
        setCursorStack([null]);
      } else if (code === 'element_not_found' || code === 'port_not_found' || code === 'stale_revision') {
        onClose();
        await onInvalidated();
      }
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, [cursor, cursorStack.length, onClose, onInvalidated, open, operations, query, replacingEdgeId, revision, source, toast]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const connect = useCallback(async (target: RouteGraphWorkspaceConnectionTargetPage['items'][number]) => {
    if (!source || connectingKey) return;
    const key = `${target.graphElementId}\u0000${target.port.id}`;
    setConnectingKey(key);
    try {
      const response = await api.draftRouteGraphWorkspaceConnection({ revision, operations, first: source, second: target.endpoint, replacingEdgeId });
      toast.success(tr(replacingEdgeId ? 'pages.tokenRoutes.routeGraphConnection.rewired' : 'pages.tokenRoutes.routeGraphConnection.connected'));
      onClose();
      await onConnected(response.edge);
    } catch (error) {
      toast.error(routeGraphConnectionErrorMessage(error));
      const code = routeGraphConnectionErrorCode(error);
      if (code === 'element_not_found' || code === 'port_not_found' || code === 'stale_revision' || code === 'edge_not_found') {
        onClose();
        await onInvalidated();
      }
    } finally {
      setConnectingKey(null);
    }
  }, [connectingKey, onClose, onConnected, onInvalidated, operations, replacingEdgeId, revision, source, toast]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !connectingKey) onClose(); }}>
      <Dialog.Content className="w-[min(94vw,760px)] overflow-hidden p-0" onClose={onClose}>
        <Dialog.Header className="border-b px-4 py-3">
          <Dialog.Title className="flex items-center gap-2"><Link2 size={16} />{tr(replacingEdgeId ? 'pages.tokenRoutes.routeGraphConnection.rewireTitle' : 'pages.tokenRoutes.routeGraphConnection.title')}</Dialog.Title>
          <Dialog.Description>{tr(replacingEdgeId ? 'pages.tokenRoutes.routeGraphConnection.rewireDescription' : 'pages.tokenRoutes.routeGraphConnection.description')}</Dialog.Description>
        </Dialog.Header>
        <div className="grid min-h-0 gap-3 p-4">
          <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphConnection.source')}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{page?.source.elementLabel || source?.element.id}</span>
            <Badge variant="secondary">{page?.source.port.label || source?.portId}</Badge>
          </div>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} className="pl-9" placeholder={tr('pages.tokenRoutes.routeGraphConnection.searchPlaceholder')} />
          </div>
          <div className="min-h-72 overflow-y-auto rounded-md border">
            {loading && !page ? <LoadingRows /> : page?.items.length ? (
              <div className={loading ? 'pointer-events-none opacity-60' : ''}>
                {page.items.map((target) => {
                  const key = `${target.graphElementId}\u0000${target.port.id}`;
                  return (
                    <div
                      key={key}
                      className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/30"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded border bg-muted/20"><Link2 size={14} /></span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-sm font-medium">{target.elementLabel}</span>
                        <span className="truncate text-xs text-muted-foreground">{target.elementSubtitle || target.elementKind} · {target.port.label}</span>
                        {target.focuses.length > 0 ? (
                          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            <span>{tr('pages.tokenRoutes.routeGraphConnection.availableFocuses')}:</span>
                            {target.focuses.map((location) => (
                              <span key={`${location.focus.kind}:${location.focus.id}`} className="inline-flex min-w-0 max-w-48 items-center gap-0.5">
                                <span className="truncate" title={location.label}>{location.label}</span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-5 shrink-0"
                                  onClick={() => onInspectFocus(location.focus)}
                                  title={tr('pages.tokenRoutes.routeGraphConnection.inspectFocus').replace('{name}', location.label)}
                                  aria-label={tr('pages.tokenRoutes.routeGraphConnection.inspectFocus').replace('{name}', location.label)}
                                >
                                  <ExternalLink size={11} />
                                </Button>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="truncate text-[10px] text-muted-foreground">{tr('pages.tokenRoutes.routeGraphConnection.noFocus')}</span>
                        )}
                      </span>
                      <Button type="button" size="sm" variant="outline" disabled={!!connectingKey} onClick={() => void connect(target)}>
                        {connectingKey === key ? <LoaderCircle size={15} className="animate-spin" /> : <Link2 size={14} />}
                        {tr(replacingEdgeId ? 'pages.tokenRoutes.routeGraphConnection.rewire' : 'pages.tokenRoutes.routeGraphConnection.connect')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center px-6 text-center text-sm text-muted-foreground">
                {tr('pages.tokenRoutes.routeGraphConnection.empty')}
              </div>
            )}
          </div>
        </div>
        <Dialog.Footer className="m-0 items-center justify-between px-4 py-3">
          <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphConnection.resultCount').replace('{count}', String(page?.totalCount || 0))}</span>
          <ButtonGroup>
            <Button type="button" size="sm" variant="outline" disabled={cursorStack.length <= 1 || loading} onClick={() => setCursorStack((current) => current.slice(0, -1))}>
              <ArrowLeft size={14} />{tr('common.previous')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!page?.nextCursor || loading} onClick={() => page?.nextCursor && setCursorStack((current) => [...current, page.nextCursor])}>
              {tr('common.next')}<ArrowRight size={14} />
            </Button>
          </ButtonGroup>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
