import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createManagedRouteGraphElementId, createManualRouteGraphNodeId, createRouteMacroSemanticNodeId } from '../../shared/routingIdentity.js';
import { normalizeRouteGraphMacro, type RouteGraphEdge, type RouteGraphMacro, type RouteGraphNode, type RouteGraphSource } from '../../shared/routeGraph.js';
import { db, schema } from '../db/index.js';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import {
  getRouteGraphDraft,
  RouteGraphDraftRevisionConflictError,
  saveRouteGraphDraftWithTransaction,
  validateRouteGraphDraft,
} from './routeGraphService.js';
import { formatRouteGraphWorkspaceRevision } from './routeGraphWorkspaceRevision.js';
import { validateRouteGraphEdgeMutation } from './routeGraphConnectionService.js';
import type {
  RouteGraphWorkspaceMacroDraft,
  RouteGraphWorkspaceNodeDraft,
  RouteGraphWorkspaceOperation,
  RouteGraphWorkspaceOperationBatch,
} from '../../shared/routeGraphOperations.js';
import type { RouteGraphWorkspaceResume } from '../../shared/routeGraphWorkspace.js';

export class RouteGraphWorkspaceRevisionConflictError extends Error {
  constructor() {
    super('The graph workspace is stale. Refresh the current workspace before saving changes.');
    this.name = 'RouteGraphWorkspaceRevisionConflictError';
  }
}

export class RouteGraphWorkspaceAuthoringError extends Error {
  constructor(readonly code: 'element_not_found' | 'edge_not_found' | 'element_not_authorable' | 'edge_not_authorable') {
    super(code);
    this.name = 'RouteGraphWorkspaceAuthoringError';
  }
}

function parseWorkspaceOperations(value: string): RouteGraphWorkspaceOperation[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as RouteGraphWorkspaceOperation[] : [];
  } catch {
    return [];
  }
}

/** Applies a resident workspace delta to the authoritative source graph in memory. */
export function applyRouteGraphWorkspaceOperationsToGraph(
  graph: RouteGraphSource,
  operations: RouteGraphWorkspaceOperation[],
  options: { enforceAuthoring?: boolean } = {},
): { graph: RouteGraphSource; inverseOperations: RouteGraphWorkspaceOperation[] } {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const macroById = new Map((graph.macros || []).map((macro) => [macro.id, macro]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const inverseOperations: RouteGraphWorkspaceOperation[] = [];
  const enforceAuthoring = options.enforceAuthoring !== false;
  const edgesRemovedByElementOperation = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === 'upsert_node') {
      const previous = nodeById.get(operation.node.id);
      if (enforceAuthoring && (operation.node.ownership !== 'manual' || (previous && previous.ownership !== 'manual'))) {
        throw new RouteGraphWorkspaceAuthoringError('element_not_authorable');
      }
      inverseOperations.unshift(previous
        ? { kind: 'upsert_node', node: previous }
        : { kind: 'remove_node', nodeId: operation.node.id });
      nodeById.set(operation.node.id, operation.node);
    } else if (operation.kind === 'remove_node') {
      const previous = nodeById.get(operation.nodeId);
      if (enforceAuthoring && !previous) throw new RouteGraphWorkspaceAuthoringError('element_not_found');
      if (enforceAuthoring && previous?.ownership !== 'manual') throw new RouteGraphWorkspaceAuthoringError('element_not_authorable');
      const incidentEdges = [...edgeById.values()].filter((edge) => (
        edge.sourceNodeId === operation.nodeId || edge.targetNodeId === operation.nodeId
      ));
      if (previous) inverseOperations.unshift(
        { kind: 'upsert_node', node: previous },
        ...incidentEdges.map((edge): RouteGraphWorkspaceOperation => ({ kind: 'upsert_edge', edge })),
      );
      for (const edge of incidentEdges) {
        edgeById.delete(edge.id);
        edgesRemovedByElementOperation.add(edge.id);
      }
      nodeById.delete(operation.nodeId);
    } else if (operation.kind === 'upsert_macro') {
      const previous = macroById.get(operation.macro.id);
      if (enforceAuthoring && (operation.macro.ownership !== 'manual' || (previous && previous.ownership !== 'manual'))) {
        throw new RouteGraphWorkspaceAuthoringError('element_not_authorable');
      }
      inverseOperations.unshift(previous
        ? { kind: 'upsert_macro', macro: previous }
        : { kind: 'remove_macro', macroId: operation.macro.id });
      macroById.set(operation.macro.id, operation.macro);
    } else if (operation.kind === 'remove_macro') {
      const previous = macroById.get(operation.macroId);
      if (enforceAuthoring && !previous) throw new RouteGraphWorkspaceAuthoringError('element_not_found');
      if (enforceAuthoring && previous?.ownership !== 'manual') throw new RouteGraphWorkspaceAuthoringError('element_not_authorable');
      const graphElementId = createRouteMacroSemanticNodeId(operation.macroId);
      const incidentEdges = [...edgeById.values()].filter((edge) => (
        edge.sourceNodeId === graphElementId || edge.targetNodeId === graphElementId
      ));
      if (previous) inverseOperations.unshift(
        { kind: 'upsert_macro', macro: previous },
        ...incidentEdges.map((edge): RouteGraphWorkspaceOperation => ({ kind: 'upsert_edge', edge })),
      );
      for (const edge of incidentEdges) {
        edgeById.delete(edge.id);
        edgesRemovedByElementOperation.add(edge.id);
      }
      macroById.delete(operation.macroId);
    } else if (operation.kind === 'upsert_edge') {
      const previous = edgeById.get(operation.edge.id);
      if (enforceAuthoring && (operation.edge.ownership !== 'manual' || (previous && previous.ownership !== 'manual'))) {
        throw new RouteGraphWorkspaceAuthoringError('edge_not_authorable');
      }
      inverseOperations.unshift(previous
        ? { kind: 'upsert_edge', edge: previous }
        : { kind: 'remove_edge', edgeId: operation.edge.id });
      edgeById.set(operation.edge.id, operation.edge);
    } else {
      const previous = edgeById.get(operation.edgeId);
      if (!previous && edgesRemovedByElementOperation.has(operation.edgeId)) continue;
      if (enforceAuthoring && !previous) throw new RouteGraphWorkspaceAuthoringError('edge_not_found');
      if (enforceAuthoring && previous?.ownership !== 'manual') throw new RouteGraphWorkspaceAuthoringError('edge_not_authorable');
      if (previous) inverseOperations.unshift({ kind: 'upsert_edge', edge: previous });
      edgeById.delete(operation.edgeId);
    }
  }
  const nextGraph: RouteGraphSource = {
      ...graph,
      nodes: [...nodeById.values()],
      macros: [...macroById.values()],
      edges: [...edgeById.values()],
  };
  for (const operation of operations) {
    if (operation.kind === 'upsert_edge') validateRouteGraphEdgeMutation(nextGraph, operation.edge);
  }
  return {
    graph: nextGraph,
    inverseOperations,
  };
}

export async function validateRouteGraphWorkspaceOperations(input: {
  revision: string;
  operations: RouteGraphWorkspaceOperation[];
}) {
  const draft = await getRouteGraphDraft();
  if (input.revision !== formatRouteGraphWorkspaceRevision(draft)) {
    throw new RouteGraphWorkspaceRevisionConflictError();
  }
  return await validateRouteGraphDraft(
    applyRouteGraphWorkspaceOperationsToGraph(draft.workingGraph, input.operations).graph,
  );
}

export async function applyRouteGraphWorkspaceOperations(input: {
  revision: string;
  operations: RouteGraphWorkspaceOperation[];
  enforceAuthoring?: boolean;
}): Promise<{ revision: string; batchId: number }> {
  const draft = await getRouteGraphDraft();
  if (input.revision !== formatRouteGraphWorkspaceRevision(draft)) {
    throw new RouteGraphWorkspaceRevisionConflictError();
  }
  const { graph: next, inverseOperations } = applyRouteGraphWorkspaceOperationsToGraph(
    draft.workingGraph,
    input.operations,
    { enforceAuthoring: input.enforceAuthoring },
  );
  try {
    const saved = await saveRouteGraphDraftWithTransaction(next, { expectedRevision: draft.revision }, async (tx, persisted) => {
      const inserted = await tx.insert(schema.routeGraphWorkspaceOperationBatches).values({
        draftId: persisted.id,
        sourceRevision: draft.revision,
        resultRevision: persisted.revision,
        forwardOperationsJson: JSON.stringify(input.operations),
        inverseOperationsJson: JSON.stringify(inverseOperations),
      }).run();
      return requireInsertedRowId(inserted, 'Failed to persist route graph workspace operation batch.');
    });
    return { revision: formatRouteGraphWorkspaceRevision(saved.draft), batchId: saved.result };
  } catch (error) {
    if (error instanceof RouteGraphDraftRevisionConflictError) {
      throw new RouteGraphWorkspaceRevisionConflictError();
    }
    throw error;
  }
}

/** Creates a manual primitive with a server-issued persisted identity. */
export async function createRouteGraphWorkspaceNode(input: {
  revision: string;
  node: RouteGraphWorkspaceNodeDraft;
}): Promise<{ revision: string; batchId: number; node: RouteGraphNode }> {
  const node = reserveRouteGraphWorkspaceNode(input.node);
  const result = await applyRouteGraphWorkspaceOperations({
    revision: input.revision,
    operations: [{ kind: 'upsert_node', node }],
  });
  const draft = await getRouteGraphDraft();
  const persistedNode = draft.workingGraph.nodes.find((candidate) => candidate.id === node.id);
  if (!persistedNode) throw new Error('Created route graph node is missing from the saved draft.');
  return { ...result, node: persistedNode };
}

/** Allocates durable Graph identities without mutating the current draft. */
export function reserveRouteGraphWorkspaceNode(input: RouteGraphWorkspaceNodeDraft): RouteGraphNode {
  const nodeId = createManualRouteGraphNodeId(input.type, randomUUID());
  const node = {
    ...input,
    id: nodeId,
    ...(input.type === 'route_endpoint'
      ? { routeEndpointId: createManagedRouteGraphElementId('endpoint', randomUUID()) }
      : {}),
  } as RouteGraphNode;
  return node;
}

/** Creates a manual macro with a server-issued durable Graph identity. */
export async function createRouteGraphWorkspaceMacro(input: {
  revision: string;
  macro: RouteGraphWorkspaceMacroDraft;
}): Promise<{ revision: string; batchId: number; macro: RouteGraphMacro }> {
  const macro = normalizeRouteGraphMacro({
    ...input.macro,
    id: createManagedRouteGraphElementId('macro', randomUUID()),
    ownership: 'manual',
  });
  const result = await applyRouteGraphWorkspaceOperations({
    revision: input.revision,
    operations: [{ kind: 'upsert_macro', macro }],
  });
  const draft = await getRouteGraphDraft();
  const persistedMacro = draft.workingGraph.macros?.find((candidate) => candidate.id === macro.id);
  if (!persistedMacro) throw new Error('Created route graph macro is missing from the saved draft.');
  return { ...result, macro: persistedMacro };
}

export async function listRouteGraphWorkspaceOperationBatches(limit = 20): Promise<RouteGraphWorkspaceOperationBatch[]> {
  const draft = await getRouteGraphDraft();
  if (draft.id <= 0) return [];
  const rows = await db.select().from(schema.routeGraphWorkspaceOperationBatches)
    .where(eq(schema.routeGraphWorkspaceOperationBatches.draftId, draft.id))
    .orderBy(desc(schema.routeGraphWorkspaceOperationBatches.id))
    .limit(Math.max(1, Math.min(100, Math.trunc(limit))))
    .all();
  return rows.map((row) => ({
    id: row.id,
    sourceRevision: `draft:${draft.id}:${draft.baseVersion || 0}:${row.sourceRevision}`,
    resultRevision: `draft:${draft.id}:${draft.baseVersion || 0}:${row.resultRevision}`,
    forwardOperations: parseWorkspaceOperations(row.forwardOperationsJson),
    inverseOperations: parseWorkspaceOperations(row.inverseOperationsJson),
    createdAt: row.createdAt,
  }));
}

/** Returns the most recently saved editable Focus for continuing a draft. */
export async function getRouteGraphWorkspaceResume(): Promise<RouteGraphWorkspaceResume> {
  const draft = await getRouteGraphDraft();
  const revision = formatRouteGraphWorkspaceRevision(draft);
  if (draft.id <= 0) return { revision, focus: null };
  for (const batch of await listRouteGraphWorkspaceOperationBatches(30)) {
    if (batch.resultRevision !== revision) continue;
    for (const operation of [...batch.forwardOperations].reverse()) {
      if (operation.kind === 'upsert_node' && draft.workingGraph.nodes.some((node) => node.id === operation.node.id)) {
        return { revision, focus: { kind: 'node', id: operation.node.id } };
      }
      if (operation.kind === 'upsert_macro' && draft.workingGraph.macros?.some((macro) => macro.id === operation.macro.id)) {
        return { revision, focus: { kind: 'macro', id: operation.macro.id } };
      }
    }
  }
  return { revision, focus: null };
}

export async function replayRouteGraphWorkspaceOperationBatch(input: {
  id: number;
  revision: string;
  direction: 'undo' | 'replay';
}): Promise<{ revision: string; batchId: number }> {
  const draft = await getRouteGraphDraft();
  if (input.revision !== formatRouteGraphWorkspaceRevision(draft) || draft.id <= 0) {
    throw new RouteGraphWorkspaceRevisionConflictError();
  }
  const batch = await db.select().from(schema.routeGraphWorkspaceOperationBatches)
    .where(eq(schema.routeGraphWorkspaceOperationBatches.id, input.id))
    .limit(1)
    .get();
  if (!batch || batch.draftId !== draft.id) {
    throw new Error('Route graph workspace operation batch was not found.');
  }
  if (input.direction === 'undo' && draft.revision !== batch.resultRevision) {
    throw new RouteGraphWorkspaceRevisionConflictError();
  }
  const operations = input.direction === 'undo'
    ? parseWorkspaceOperations(batch.inverseOperationsJson)
    : parseWorkspaceOperations(batch.forwardOperationsJson);
  if (operations.length === 0) {
    throw new Error('Route graph workspace operation batch has no replayable operations.');
  }
  return await applyRouteGraphWorkspaceOperations({
    revision: input.revision,
    operations,
    enforceAuthoring: false,
  });
}
