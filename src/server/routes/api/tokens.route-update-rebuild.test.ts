import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type DbModule = typeof import("../../db/index.js");
type RouteGroupGraphFacadeModule =
  typeof import("../../services/routeGroupGraphFacadeService.js");
type RuntimeExecutionTargetServiceModule =
  typeof import("../../services/runtimeExecutionTargetService.js");

describe("route group API graph-native updates", () => {
  let app: FastifyInstance;
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let dataDir = "";
  let createRouteGroupFacadeMacro: RouteGroupGraphFacadeModule["createRouteGroupFacadeMacro"];
  let mutateRouteGroupFacadeGraph: RouteGroupGraphFacadeModule["mutateRouteGroupFacadeGraph"];
  let upsertRuntimeExecutionTarget: RuntimeExecutionTargetServiceModule["upsertRuntimeExecutionTarget"];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "metapi-route-group-update-"));
    process.env.DATA_DIR = dataDir;

    const migrate = await import("../../db/migrate.js");
    await migrate.runSqliteMigrations();
    const dbModule = await import("../../db/index.js");
    const routesModule = await import("./tokens.js");
    const routeGroupGraphFacade =
      await import("../../services/routeGroupGraphFacadeService.js");
    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupFacadeMacro =
      routeGroupGraphFacade.createRouteGroupFacadeMacro;
    mutateRouteGroupFacadeGraph =
      routeGroupGraphFacade.mutateRouteGroupFacadeGraph;
    ({ upsertRuntimeExecutionTarget } =
      await import("../../services/runtimeExecutionTargetService.js"));

    app = Fastify();
    await app.register(routesModule.tokensRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  async function postRouteGroup(payload: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups",
      payload,
    });
    expect(response.statusCode).toBe(200);
    return response.json() as any;
  }

  function directRoutePayload(modelName: string) {
    return {
      model: {
        publicName: modelName,
        upstreamName: modelName,
      },
      presentation: {
        displayName: null,
        displayIcon: null,
      },
      dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
      enabled: true,
    };
  }

  async function createAutomaticRouteGroup(modelName: string) {
    const result = await mutateRouteGroupFacadeGraph({
      createdBy: "test",
      mutate: (source) => {
        const created = createRouteGroupFacadeMacro(source, {
          kind: "automatic",
          modelName,
          displayName: modelName,
          visibility: "public",
        });
        return { source: created.source, result: created.macro.id };
      },
    });
    return result.result;
  }

  it("allocates independent route group ids for duplicate internal manual models", async () => {
    const first = await postRouteGroup({
      ...directRoutePayload("same-internal-model"),
      visibility: "internal",
    });
    const second = await postRouteGroup({
      ...directRoutePayload("same-internal-model"),
      visibility: "internal",
    });

    expect(first.id).toEqual(expect.any(String));
    expect(second.id).toEqual(expect.any(String));
    expect(second.id).not.toBe(first.id);
  });

  it("uses canonical automatic route group model fields for summary titles", async () => {
    const automaticId = await createAutomaticRouteGroup("deepseek-v4-flash");

    const response = await app.inject({
      method: "GET",
      url: "/api/route-groups?page=1&pageSize=20&tab=public",
    });

    expect(response.statusCode).toBe(200);
    const item = (response.json() as any).items.find(
      (row: any) => row.id === automaticId,
    );
    expect(item).toMatchObject({
      model: {
        publicName: "deepseek-v4-flash",
        normalizedName: "deepseek-v4-flash",
      },
      presentation: {
        displayName: "deepseek-v4-flash",
      },
    });
  });

  it("creates candidates only from server-owned opaque source references", async () => {
    const site = await db.insert(schema.sites).values({
      name: "Opaque source",
      url: "https://opaque-source.example.test",
      platform: "openai",
      status: "active",
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "opaque-source-account",
      credential: "opaque-source-access",
      status: "active",
    }).returning().get();
    const target = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      tokenId: null,
      sourceModel: "opaque-source-model",
      source: "test",
    });
    const group = await postRouteGroup(directRoutePayload("opaque-public-model"));

    const catalog = await app.inject({
      method: "GET",
      url: `/api/route-groups/${encodeURIComponent(group.id)}/candidate-catalog`,
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().items).toEqual([
      expect.objectContaining({
        sourceRef: target.sourceRef,
        accountId: account.id,
        sourceModel: "opaque-source-model",
      }),
    ]);
    expect(catalog.json().items[0]).not.toHaveProperty("id");

    const retiredPayload = await app.inject({
      method: "POST",
      url: `/api/route-groups/${encodeURIComponent(group.id)}/candidates`,
      payload: {
        accountId: account.id,
        sourceModel: "opaque-source-model",
      },
    });
    expect(retiredPayload.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: `/api/route-groups/${encodeURIComponent(group.id)}/candidates`,
      payload: { sourceRef: target.sourceRef },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      kind: "execution_endpoint",
      targets: [expect.objectContaining({ sourceRef: target.sourceRef })],
    });

    const versionsBefore = await db.select().from(schema.routeGraphVersions).all();
    const missing = await app.inject({
      method: "POST",
      url: `/api/route-groups/${encodeURIComponent(group.id)}/candidates`,
      payload: { sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7" },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({
      success: false,
      code: "source_not_found",
      params: {},
    });
    expect(await db.select().from(schema.routeGraphVersions).all())
      .toHaveLength(versionsBefore.length);
  });

  it("rejects source replacement on automatic Route Groups instead of ignoring it", async () => {
    const automaticId = await createAutomaticRouteGroup("auto-source-locked");

    const response = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(automaticId)}`,
      payload: {
        sourceSelection: {
          kind: "explicit",
          sources: [{
            kind: "execution_target",
            sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7",
          }],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: "automatic_source_selection_unsupported",
      params: {},
    });
  });

  it("rejects duplicate public route group model names on create", async () => {
    await postRouteGroup(directRoutePayload("same-public-model"));

    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups",
      payload: directRoutePayload("Same-Public-Model"),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: "public_model_conflict",
      params: { modelName: "same-public-model" },
    });
  });

  it("rejects publishing an internal duplicate route group as public", async () => {
    const publicGroup = await postRouteGroup(
      directRoutePayload("publish-conflict-model"),
    );
    const internalGroup = await postRouteGroup({
      ...directRoutePayload("publish-conflict-model"),
      visibility: "internal",
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(internalGroup.id)}`,
      payload: {
        ...directRoutePayload("publish-conflict-model"),
        visibility: "public",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: "public_model_conflict",
      params: { modelName: "publish-conflict-model" },
    });
  });

  it("rejects batch public exposure when selected groups conflict", async () => {
    const first = await postRouteGroup({
      ...directRoutePayload("batch-conflict-model"),
      visibility: "internal",
    });
    const second = await postRouteGroup({
      ...directRoutePayload("batch-conflict-model"),
      visibility: "internal",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups/batch",
      payload: {
        ids: [first.id, second.id],
        action: "set_public",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: "public_model_conflict",
      params: { modelName: "batch-conflict-model" },
    });
  });

  it("rejects macro identity in route group create payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups",
      payload: {
        ...directRoutePayload("macro-should-not-own-identity"),
        visibility: "internal",
        macro: {
          id: "route-group:caller-owned-id",
          kind: "candidate_selector",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        success: false,
        code: "invalid_route_group_payload",
        params: { detail: "Invalid route group payload." },
      }),
    );
  });

  it("rejects the removed endpointIds payload instead of providing an unreleased compatibility path", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups",
      payload: {
        model: { publicName: "removed-endpoint-ids", upstreamName: null },
        endpointIds: ["route-endpoint:supply:caller-owned"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
  });

  it("updates route group match data and publishes a fresh graph version", async () => {
    const created = await postRouteGroup(directRoutePayload("claude-3-haiku"));

    const response = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(created.id)}`,
      payload: {
        model: {
          publicName: "claude-3-5-haiku",
          upstreamName: "claude-3-5-haiku",
        },
        presentation: {
          displayName: null,
          displayIcon: null,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json() as any;
    expect(updated.id).toBe(created.id);
    expect(updated.model.publicName).toBe("claude-3-5-haiku");

    const active = await db.select().from(schema.routeGraphActiveVersion).get();
    expect(active?.versionId).toBeGreaterThan(0);
  });

  it("creates explicit route groups from graph macro references", async () => {
    const sourceA = await postRouteGroup(directRoutePayload("source-a"));
    const sourceB = await postRouteGroup(directRoutePayload("source-b"));
    const sources = [
      { kind: "route_group" as const, id: sourceA.id },
      { kind: "route_group" as const, id: sourceB.id },
    ];

    const explicit = await postRouteGroup({
      model: {
        publicName: "public-aggregate",
        upstreamName: null,
      },
      sourceSelection: { kind: "explicit", sources },
      presentation: {
        displayName: "public-aggregate",
        displayIcon: null,
      },
      dispatcherPolicy: { kind: "builtin", builtin: "round_robin" },
      enabled: true,
    });

    expect(
      explicit.sourceSelection.sources.map((item: any) => item.source),
    ).toEqual(sources);
  });

  it("rejects unresolved management source references instead of silently dropping candidates", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/route-groups",
      payload: {
        model: { publicName: "invalid-source-group", upstreamName: null },
        sourceSelection: {
          kind: "explicit",
          sources: [{ kind: "route_group", id: "missing:route-group" }],
        },
        presentation: {
          displayName: "invalid-source-group",
          displayIcon: null,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: "route_group_source_not_found",
      params: { routeGroupId: "missing:route-group" },
    });
  });
});
