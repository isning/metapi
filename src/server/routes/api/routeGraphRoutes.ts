import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  parseRouteGraphAuthoringPayload,
  parseRouteGraphWorkspaceConnectionCreatePayload,
  parseRouteGraphWorkspaceConnectionDraftPayload,
  parseRouteGraphWorkspaceConnectionTargetQueryPayload,
  parseRouteGraphWorkspaceMacroCreatePayload,
  parseRouteGraphWorkspaceNodeCreatePayload,
  parseRouteGraphWorkspaceNodeReservationPayload,
  parseRouteGraphWorkspaceOperationBatchReplayPayload,
  parseRouteGraphWorkspaceOperationsPayload,
  parseRouteGraphWorkspaceRemovalImpactPayload,
  parseRouteGraphWorkspaceValidationPayload,
} from '../../contracts/routeManagementPayloads.js';
import { RouteGraphConnectionValidationError } from '../../services/routeGraphConnectionService.js';
import {
  listRouteEndpointCatalogPage,
  parseRouteEndpointCatalogQuery,
  RouteEndpointCatalogRevisionConflictError,
} from '../../services/routeGraphEndpointCatalogService.js';
import {
  RouteGraphWorkspaceFocusNotFoundError,
  RouteGraphWorkspaceWindowTokenError,
} from '../../services/routeGraphFocusProjectionService.js';
import {
  discardRouteGraphDraft,
  getActiveRouteGraphSourceVersion,
  getActiveRouteGraphVersion,
  getRouteGraphDraft,
  hashRouteGraphSource,
  listRouteGraphVersions,
  publishRouteGraphDraft,
  rebaseRouteGraphDraft,
  RouteGraphAuthoringIdentityError,
  saveRouteGraphAuthoringDraft,
  validateRouteGraphAuthoringPayload,
} from '../../services/routeGraphService.js';
import {
  createRouteGraphWorkspaceConnection,
  draftRouteGraphWorkspaceConnection,
  getRouteGraphWorkspaceConnectionTargets,
  RouteGraphWorkspaceConnectionCursorError,
  RouteGraphWorkspaceConnectionMutationError,
} from '../../services/routeGraphWorkspaceConnectionService.js';
import {
  getRouteGraphWorkspaceRemovalImpact,
  RouteGraphWorkspaceMutationError,
} from '../../services/routeGraphWorkspaceMutationService.js';
import {
  applyRouteGraphWorkspaceOperations,
  createRouteGraphWorkspaceMacro,
  createRouteGraphWorkspaceNode,
  getRouteGraphWorkspaceResume,
  listRouteGraphWorkspaceOperationBatches,
  replayRouteGraphWorkspaceOperationBatch,
  RouteGraphWorkspaceAuthoringError,
  RouteGraphWorkspaceRevisionConflictError,
  reserveRouteGraphWorkspaceNode,
  validateRouteGraphWorkspaceOperations,
} from '../../services/routeGraphWorkspaceOperationsService.js';
import {
  getRouteGraphFocusedWorkspace,
  getRouteGraphWorkspaceIndexPage,
} from '../../services/routeGraphWorkspaceQueryService.js';
import { RouteGraphWorkspaceIndexCursorError } from '../../services/routeGraphWorkspaceIndexService.js';

function workspaceCommandError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof RouteGraphWorkspaceRevisionConflictError) {
    return reply.code(409).send({
      success: false,
      stale: true,
      code: 'stale_revision',
      params: {},
    });
  }
  if (
    error instanceof RouteGraphWorkspaceAuthoringError
    || error instanceof RouteGraphConnectionValidationError
    || error instanceof RouteGraphWorkspaceConnectionMutationError
    || error instanceof RouteGraphWorkspaceMutationError
    || error instanceof RouteGraphWorkspaceConnectionCursorError
  ) {
    return reply.code(400).send({ success: false, code: error.code, params: {} });
  }
  throw error;
}

function graphAuthoringError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof RouteGraphAuthoringIdentityError) {
    return reply.code(400).send({ success: false, code: 'graph_authoring_identity_invalid', params: {} });
  }
  throw error;
}

export async function registerRouteGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { include?: string } }>('/api/route-graph/active', async (request, reply) => {
    const include = String(request.query.include || '').trim().toLowerCase();
    if (include === 'source') {
      const active = await getActiveRouteGraphSourceVersion();
      if (!active) {
        return reply.code(404).send({
          success: false,
          message: 'No active route graph has been published.',
        });
      }
      return {
        version: {
          id: active.id,
          version: active.version,
          status: active.status,
          createdAt: active.createdAt,
          activatedAt: active.activatedAt,
        },
        sourceSummary: {
          nodes: active.sourceGraph.nodes.length,
          edges: active.sourceGraph.edges.length,
          macros: (active.sourceGraph.macros || []).length,
        },
        hashes: { sourceGraph: hashRouteGraphSource(active.sourceGraph), compiledGraph: null },
        sourceGraph: active.sourceGraph,
        compiledGraph: null,
      };
    }

    const active = await getActiveRouteGraphVersion();
    if (!active) {
      return reply.code(404).send({
        success: false,
        message: 'No active route graph has been published.',
      });
    }
    return {
      version: {
        id: active.id,
        version: active.version,
        status: active.status,
        createdAt: active.createdAt,
        activatedAt: active.activatedAt,
      },
      sourceSummary: {
        nodes: active.sourceGraph.nodes.length,
        edges: active.sourceGraph.edges.length,
        macros: (active.sourceGraph.macros || []).length,
      },
      hashes: {
        sourceGraph: hashRouteGraphSource(active.sourceGraph),
        compiledGraph: active.compiledGraph.hash || null,
      },
      sourceGraph: include === 'full' ? active.sourceGraph : null,
      compiledGraph: include === 'full' || include === 'compiled' ? active.compiledGraph : null,
    };
  });

  app.get('/api/route-graph/draft', async (_request, reply) => {
    const active = await getActiveRouteGraphSourceVersion();
    if (!active) {
      return reply.code(404).send({
        success: false,
        message: 'No active route graph has been published.',
      });
    }
    return {
      activeVersion: {
        id: active.id,
        version: active.version,
        status: active.status,
        createdAt: active.createdAt,
        activatedAt: active.activatedAt,
        sourceGraph: active.sourceGraph,
      },
      draft: await getRouteGraphDraft(),
      history: await listRouteGraphVersions(20),
    };
  });

  app.get<{
    Querystring: {
      cursor?: string;
      limit?: string;
      q?: string;
      elementKind?: 'macro' | 'entry' | 'component';
      ownership?: 'manual' | 'system' | 'mixed';
      diagnosticState?: 'all' | 'issues' | 'errors' | 'warnings';
    };
  }>('/api/route-graph/workspace-index', async (request, reply) => {
    try {
      return await getRouteGraphWorkspaceIndexPage({
        cursor: request.query.cursor,
        limit: Number(request.query.limit),
        query: request.query.q,
        elementKind: request.query.elementKind,
        ownership: request.query.ownership,
        diagnosticState: request.query.diagnosticState,
      });
    } catch (error) {
      if (error instanceof RouteGraphWorkspaceIndexCursorError) {
        return reply.code(error.code === 'stale_workspace_index_cursor' ? 409 : 400).send({
          success: false,
          code: error.code,
        });
      }
      throw error;
    }
  });

  app.get<{
    Querystring: {
      focusKind?: 'macro' | 'node';
      focusId?: string;
      representation?: 'semantic' | 'primitive';
      windowToken?: string;
    };
  }>('/api/route-graph/workspace', async (request, reply) => {
    const focusKind = request.query.focusKind;
    const focusId = String(request.query.focusId || '').trim();
    if ((focusKind !== 'macro' && focusKind !== 'node') || !focusId) {
      return reply.code(400).send({
        success: false,
        code: 'invalid_focus',
        message: 'focusKind and focusId are required.',
      });
    }
    try {
      return await getRouteGraphFocusedWorkspace({
        focus: { kind: focusKind, id: focusId },
        representation: request.query.representation || 'semantic',
        windowToken: request.query.windowToken,
      });
    } catch (error) {
      if (error instanceof RouteGraphWorkspaceFocusNotFoundError) {
        return reply.code(404).send({ success: false, code: error.code, params: {} });
      }
      if (error instanceof RouteGraphWorkspaceWindowTokenError) {
        return reply.code(400).send({ success: false, code: error.code, params: {} });
      }
      throw error;
    }
  });

  app.get<{
    Querystring: {
      elementKind?: 'macro' | 'node';
      elementId?: string;
      portId?: string;
      cursor?: string;
      limit?: string;
      q?: string;
      replacingEdgeId?: string;
    };
  }>('/api/route-graph/workspace/connection-targets', async (request, reply) => {
    const elementKind = request.query.elementKind;
    const elementId = String(request.query.elementId || '').trim();
    const portId = String(request.query.portId || '').trim();
    if ((elementKind !== 'macro' && elementKind !== 'node') || !elementId || !portId) {
      return reply.code(400).send({ success: false, code: 'invalid_connection_source', params: {} });
    }
    try {
      return await getRouteGraphWorkspaceConnectionTargets({
        source: { element: { kind: elementKind, id: elementId }, portId },
        cursor: request.query.cursor,
        limit: Number(request.query.limit),
        query: request.query.q,
        replacingEdgeId: request.query.replacingEdgeId,
      });
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/connections', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceConnectionCreatePayload(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        code: 'invalid_connection',
        params: {},
      });
    }
    try {
      const result = await createRouteGraphWorkspaceConnection(parsed.data);
      return { success: true, ...result };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/connections/draft', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceConnectionDraftPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_connection', params: {} });
    try {
      return { success: true, ...(await draftRouteGraphWorkspaceConnection(parsed.data)) };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Querystring: { cursor?: string; limit?: string; q?: string }; Body: unknown }>('/api/route-graph/workspace/connection-targets/query', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceConnectionTargetQueryPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_connection_source', params: {} });
    try {
      return await getRouteGraphWorkspaceConnectionTargets({
        ...parsed.data,
        cursor: request.query.cursor,
        limit: Number(request.query.limit),
        query: request.query.q,
      });
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/removal-impact', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceRemovalImpactPayload(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        code: 'invalid_removal_impact',
        params: {},
      });
    }
    try {
      return { success: true, ...(await getRouteGraphWorkspaceRemovalImpact(parsed.data)) };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/operations', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceOperationsPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_operations', params: {} });
    try {
      const result = await applyRouteGraphWorkspaceOperations(parsed.data);
      return { success: true, ...result };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/nodes', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceNodeCreatePayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_node', params: {} });
    try {
      const result = await createRouteGraphWorkspaceNode(parsed.data);
      return { success: true, ...result };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/nodes/reserve', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceNodeReservationPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_node', params: {} });
    return { success: true, node: reserveRouteGraphWorkspaceNode(parsed.data.node) };
  });

  app.post<{ Body: unknown }>('/api/route-graph/workspace/macros', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceMacroCreatePayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_macro', params: {} });
    try {
      const result = await createRouteGraphWorkspaceMacro(parsed.data);
      return { success: true, ...result };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/api/route-graph/workspace/operation-batches', async (request) => {
    return await listRouteGraphWorkspaceOperationBatches(Number(request.query.limit));
  });

  app.get('/api/route-graph/workspace/resume', async () => {
    return await getRouteGraphWorkspaceResume();
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/route-graph/workspace/operation-batches/:id/replay',
    async (request, reply) => {
      const parsed = parseRouteGraphWorkspaceOperationBatchReplayPayload(request.body);
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({
          success: false,
          code: 'invalid_workspace_operation_batch',
          params: {},
        });
      }
      if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_operation_replay', params: {} });
      try {
        const result = await replayRouteGraphWorkspaceOperationBatch({ id, ...parsed.data });
        return { success: true, ...result };
      } catch (error) {
        return workspaceCommandError(error, reply);
      }
    },
  );

  app.post<{ Body: unknown }>('/api/route-graph/workspace/validate', async (request, reply) => {
    const parsed = parseRouteGraphWorkspaceValidationPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_workspace_validation', params: {} });
    try {
      const result = await validateRouteGraphWorkspaceOperations(parsed.data);
      return { ok: result.ok, diagnostics: result.diagnostics, compiledGraph: result.compiled };
    } catch (error) {
      return workspaceCommandError(error, reply);
    }
  });

  app.post<{ Body: unknown }>('/api/route-graph/validate', async (request, reply) => {
    const parsed = parseRouteGraphAuthoringPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_graph_authoring_payload', params: {} });
    try {
      const result = await validateRouteGraphAuthoringPayload(parsed.data);
      return { ok: result.ok, diagnostics: result.diagnostics, compiledGraph: result.compiled };
    } catch (error) {
      return graphAuthoringError(error, reply);
    }
  });

  app.put<{ Body: unknown }>('/api/route-graph/draft', async (request, reply) => {
    const parsed = parseRouteGraphAuthoringPayload(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, code: 'invalid_graph_authoring_payload', params: {} });
    try {
      return { success: true, draft: await saveRouteGraphAuthoringDraft(parsed.data) };
    } catch (error) {
      return graphAuthoringError(error, reply);
    }
  });

  app.post('/api/route-graph/draft/publish', async (_request, reply) => {
    const result = await publishRouteGraphDraft();
    if (!result.ok) {
      return reply.code(result.stale ? 409 : 400).send({
        success: false,
        stale: result.stale || false,
        code: result.stale ? 'stale_revision' : 'graph_publish_invalid',
        params: {},
        diagnostics: result.diagnostics,
      });
    }
    return { success: true, version: result.version, diagnostics: result.diagnostics };
  });

  app.post('/api/route-graph/draft/rebase', async () => {
    return { success: true, draft: await rebaseRouteGraphDraft() };
  });

  app.delete('/api/route-graph/draft', async () => {
    await discardRouteGraphDraft();
    return { success: true };
  });

  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      endpointKind?: string;
      siteId?: string;
      q?: string;
      revision?: string;
    };
  }>('/api/route-graph/endpoints', async (request, reply) => {
    try {
      return await listRouteEndpointCatalogPage(parseRouteEndpointCatalogQuery(request.query));
    } catch (error) {
      if (error instanceof RouteEndpointCatalogRevisionConflictError) {
        return reply.code(409).send({ success: false, code: error.code, params: {} });
      }
      throw error;
    }
  });
}
