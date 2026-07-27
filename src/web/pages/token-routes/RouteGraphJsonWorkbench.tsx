import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
  Rocket,
  Save,
  Upload,
} from 'lucide-react';
import { createRouteMacroSemanticNodeId } from '../../../shared/routingIdentity.js';
import type { RouteGraphDiagnostic, RouteGraphSource } from '../../../shared/routeGraph.js';
import type { RouteGraphAuthoringCommand } from '../../../shared/routeGraphOperations.js';
import { api } from '../../api.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { tr } from '../../i18n.js';
import {
  RouteGraphDirtyNavigationDialog,
  useRouteGraphDirtyNavigation,
} from './RouteGraphDirtyNavigation.js';
import { routeGraphCommandErrorMessage } from './routeGraphConnectionErrors.js';
type RouteGraphAuthoringDocument = RouteGraphAuthoringCommand & {
  macros: NonNullable<RouteGraphAuthoringCommand['macros']>;
};

function formatGraph(graph: RouteGraphAuthoringDocument): string {
  return JSON.stringify(graph, null, 2);
}

function toRouteGraphAuthoringDocument(source: unknown): RouteGraphAuthoringDocument {
  if (!source || typeof source !== 'object') {
    return { nodes: [], macros: [], edges: [] };
  }
  const graph = source as RouteGraphSource;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const macroBySemanticId = new Map((graph.macros || []).map((macro) => [createRouteMacroSemanticNodeId(macro.id), macro.id]));
  const toElementRef = (value: string) => {
    if (nodeIds.has(value)) return { kind: 'node' as const, id: value };
    const macroId = macroBySemanticId.get(value);
    if (macroId) return { kind: 'macro' as const, id: macroId };
    throw new Error(`Graph edge references an unknown persisted element: ${value}`);
  };
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    macros: (graph.macros || []).map((macro) => ({ ...macro })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: toElementRef(edge.sourceNodeId),
      sourcePortId: edge.sourcePortId,
      target: toElementRef(edge.targetNodeId),
      targetPortId: edge.targetPortId,
      kind: edge.kind,
      ownership: edge.ownership,
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
    })),
    ...(graph.metadata ? { metadata: graph.metadata } : {}),
  };
}

function parseGraph(text: string): RouteGraphAuthoringDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tr('pages.tokenRoutes.routeGraphJson.objectRequired'));
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges) || !Array.isArray(record.macros)) {
    throw new Error(tr('pages.tokenRoutes.routeGraphJson.collectionsRequired'));
  }
  return parsed as RouteGraphAuthoringDocument;
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

function RouteGraphJsonSkeleton() {
  return (
    <div data-testid="route-graph-json-loading" className="grid gap-3 p-4" aria-busy="true">
      <div className="flex flex-wrap justify-between gap-3">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Skeleton className="h-[520px] w-full" />
    </div>
  );
}

export default function RouteGraphJsonWorkbench() {
  const toast = useToast();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const loadSequenceRef = useRef(0);
  const activeLoadControllerRef = useRef<AbortController | null>(null);
  const [baseText, setBaseText] = useState('');
  const [text, setText] = useState('');
  const [diagnostics, setDiagnostics] = useState<RouteGraphDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const dirty = text !== baseText;
  const navigationBlocker = useRouteGraphDirtyNavigation(dirty);

  const errorCount = useMemo(() => diagnostics.filter((item) => item.severity === 'error').length, [diagnostics]);
  const warningCount = useMemo(() => diagnostics.filter((item) => item.severity === 'warning').length, [diagnostics]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    activeLoadControllerRef.current?.abort();
    const controller = new AbortController();
    activeLoadControllerRef.current = controller;
    setLoading(true);
    try {
      const response = await api.getRouteGraphDraft({ signal: controller.signal });
      if (sequence !== loadSequenceRef.current) return;
      const next = toRouteGraphAuthoringDocument(
        response.draft?.workingGraph || response.activeVersion?.sourceGraph || null,
      );
      const formatted = formatGraph(next);
      setText(formatted);
      setBaseText(formatted);
      setDiagnostics(response.draft.diagnostics);
    } catch (error) {
      if (sequence === loadSequenceRef.current && !isAbortError(error)) {
        toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphJson.loadFailed'));
      }
    } finally {
      if (activeLoadControllerRef.current === controller) activeLoadControllerRef.current = null;
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    return () => activeLoadControllerRef.current?.abort();
  }, [load]);
  const parsedGraph = useCallback((): RouteGraphAuthoringDocument | null => {
    try {
      return parseGraph(text);
    } catch (error) {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonParseFailed').replace('{message}', (error as Error).message));
      return null;
    }
  }, [text, toast]);

  const format = useCallback(() => {
    const parsed = parsedGraph();
    if (!parsed) return;
    setText(formatGraph(parsed));
  }, [parsedGraph]);

  const validate = useCallback(async (): Promise<boolean> => {
    const parsed = parsedGraph();
    if (!parsed) return false;
    setValidating(true);
    try {
      const response = await api.validateRouteGraph(parsed);
      const nextDiagnostics = response.diagnostics;
      setDiagnostics(nextDiagnostics);
      if (response?.ok) toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.validationPassed'));
      else toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.validationFailed').replace('{count}', String(nextDiagnostics.length)));
      return response?.ok === true;
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphJson.validateFailed'));
      return false;
    } finally {
      setValidating(false);
    }
  }, [parsedGraph, toast]);

  const save = useCallback(async (): Promise<boolean> => {
    const parsed = parsedGraph();
    if (!parsed) return false;
    setSaving(true);
    try {
      const response = await api.saveRouteGraphDraft(parsed);
      const savedGraph = response.draft.workingGraph
        ? toRouteGraphAuthoringDocument(response.draft.workingGraph)
        : parsed;
      const formatted = formatGraph(savedGraph);
      setText(formatted);
      setBaseText(formatted);
      setDiagnostics(response.draft.diagnostics);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.saved'));
      return true;
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [parsedGraph, toast]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      if (dirty && !await save()) return;
      await api.publishRouteGraphDraft();
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.published'));
      await load();
    } catch (error) {
      toast.error(routeGraphCommandErrorMessage(error, 'pages.tokenRoutes.routeGraphWorkspace.publishFailed'));
    } finally {
      setPublishing(false);
    }
  }, [dirty, load, save, toast]);

  const stayInJson = useCallback(() => {
    if (navigationBlocker.state === 'blocked') navigationBlocker.reset();
  }, [navigationBlocker]);

  const discardAndContinue = useCallback(() => {
    if (navigationBlocker.state === 'blocked') navigationBlocker.proceed();
  }, [navigationBlocker]);

  const saveAndContinue = useCallback(async () => {
    if (!await save()) return;
    if (navigationBlocker.state === 'blocked') navigationBlocker.proceed();
  }, [navigationBlocker, save]);

  const importFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = parseGraph(await file.text());
      setText(formatGraph(parsed));
      toast.success(tr('pages.tokenRoutes.routeGraphWorkbench.jsonImportDraft'));
    } catch (error) {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonParseFailed').replace('{message}', (error as Error).message));
    }
  }, [toast]);

  const exportFile = useCallback(() => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `metapi-route-graph-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [text]);

  return (
    <>
      <Card className="route-graph-advanced-json min-w-0 max-w-full overflow-hidden">
      <CardHeader className="gap-3 border-b bg-muted/20 lg:flex lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 gap-1">
          <CardTitle>{tr('pages.tokenRoutes.routeGraphWorkbench.advancedJson')}</CardTitle>
          <CardDescription>{tr('pages.tokenRoutes.routeGraphWorkbench.advancedJsonDescription')}</CardDescription>
          {!loading && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {dirty && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkspace.unsaved')}</Badge>}
              <Badge variant={errorCount > 0 ? 'destructive' : 'success'}>
                {errorCount > 0
                  ? tr('pages.tokenRoutes.routeGraphWorkbench.errorsCount').replace('{count}', String(errorCount))
                  : tr('pages.tokenRoutes.routeGraphWorkbench.validatable')}
              </Badge>
              {warningCount > 0 && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkbench.warningsCount').replace('{count}', String(warningCount))}</Badge>}
            </div>
          )}
        </div>
        <Input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            void importFile(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <ButtonGroup>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={format}><Braces size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.formatJson')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void navigator.clipboard.writeText(text)}><Copy size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.copyJson')}</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => importInputRef.current?.click()}><Upload size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.importJson')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={exportFile}><Download size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.exportJson')}</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button type="button" size="sm" variant="outline" disabled={loading || !dirty} onClick={() => setText(baseText)}><RefreshCw size={14} />{tr('pages.tokenRoutes.routeGraphJson.discard')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={loading || validating || saving} onClick={() => void validate()}><CheckCircle2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkspace.validate')}</Button>
            <Button type="button" size="sm" disabled={loading || saving || !dirty} onClick={() => void save()}><Save size={14} />{tr('pages.tokenRoutes.routeGraphWorkspace.save')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={loading || saving || validating || publishing || errorCount > 0} onClick={() => void publish()}><Rocket size={14} />{tr('pages.tokenRoutes.routeGraphWorkspace.publish')}</Button>
          </ButtonGroup>
        </div>
      </CardHeader>
      {loading ? (
        <RouteGraphJsonSkeleton />
      ) : (
        <JsonCodeEditor
          value={text}
          onChange={setText}
          minHeight={520}
          maxHeight={760}
          ariaLabel={tr('pages.tokenRoutes.routeGraphWorkbench.advancedJson')}
        />
      )}
      </Card>
      <RouteGraphDirtyNavigationDialog
        open={navigationBlocker.state === 'blocked'}
        saving={saving}
        onStay={stayInJson}
        onDiscard={discardAndContinue}
        onSave={() => void saveAndContinue()}
      />
    </>
  );
}

export { parseGraph };
