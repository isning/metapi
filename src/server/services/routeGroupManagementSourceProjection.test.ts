import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

type DbModule = typeof import("../db/index.js");
type RouteGroupManagementModule =
  typeof import("./routeGroupManagementService.js");
type RouteGroupCandidateModule =
  typeof import("./routeGroupCandidateService.js");
type RouteGroupFallbackStageModule =
  typeof import("./routeGroupFallbackStageService.js");
type RuntimeExecutionTargetServiceModule =
  typeof import("./runtimeExecutionTargetService.js");
type RouteGroupCatalogRevisionModule =
  typeof import("./routeGroupManagementCatalogRevisionService.js");

describe("Route Group management source projection", () => {
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let createRouteGroupFromPayload: RouteGroupManagementModule["createRouteGroupFromPayload"];
  let updateRouteGroupFromPayload: RouteGroupManagementModule["updateRouteGroupFromPayload"];
  let loadRouteGroupManagementSummaries: RouteGroupManagementModule["loadRouteGroupManagementSummaries"];
  let listRouteGroupSourceCatalog: RouteGroupManagementModule["listRouteGroupSourceCatalog"];
  let listRouteGroupSourceCatalogPage: RouteGroupManagementModule["listRouteGroupSourceCatalogPage"];
  let createRouteGroupCandidate: RouteGroupCandidateModule["createRouteGroupCandidate"];
  let listRouteGroupFallbackStages: RouteGroupFallbackStageModule["listRouteGroupFallbackStages"];
  let updateRouteGroupFallbackStage: RouteGroupFallbackStageModule["updateRouteGroupFallbackStage"];
  let upsertRuntimeExecutionTarget: RuntimeExecutionTargetServiceModule["upsertRuntimeExecutionTarget"];
  let advanceRouteGroupManagementCatalogRevision: RouteGroupCatalogRevisionModule["advanceRouteGroupManagementCatalogRevision"];
  let dataDir = "";

  beforeAll(async () => {
    dataDir = mkdtempSync(
      join(tmpdir(), "metapi-route-group-management-projection-"),
    );
    process.env.DATA_DIR = dataDir;
    const migrate = await import("../db/migrate.js");
    await migrate.runSqliteMigrations();
    const dbModule = await import("../db/index.js");
    const management = await import("./routeGroupManagementService.js");
    const candidates = await import("./routeGroupCandidateService.js");
    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupFromPayload = management.createRouteGroupFromPayload;
    updateRouteGroupFromPayload = management.updateRouteGroupFromPayload;
    loadRouteGroupManagementSummaries =
      management.loadRouteGroupManagementSummaries;
    listRouteGroupSourceCatalog = management.listRouteGroupSourceCatalog;
    listRouteGroupSourceCatalogPage = management.listRouteGroupSourceCatalogPage;
    createRouteGroupCandidate = candidates.createRouteGroupCandidate;
    ({ listRouteGroupFallbackStages, updateRouteGroupFallbackStage } =
      await import("./routeGroupFallbackStageService.js"));
    ({ upsertRuntimeExecutionTarget } =
      await import("./runtimeExecutionTargetService.js"));
    ({ advanceRouteGroupManagementCatalogRevision } =
      await import("./routeGroupManagementCatalogRevisionService.js"));
  }, 60_000);

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it("uses management source references and never exposes Graph address fields", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "ModelScope",
        url: "https://example.test",
        platform: "openai",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        credential: "test-access",
        status: "active",
      })
      .returning()
      .get();
    const token = await db
      .insert(schema.accountTokens)
      .values({
        accountId: account.id,
        name: "primary",
        token: "test-token",
        enabled: true,
        isDefault: true,
      })
      .returning()
      .get();
    const child = await createRouteGroupFromPayload({
      model: { publicName: "deepseek-v4", upstreamName: "deepseek-v4" },
      presentation: { displayName: "DeepSeek V4", displayIcon: null },
    });
    const executionTarget = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      tokenId: token.id,
      sourceModel: "deepseek-v4",
      source: "test",
    });
    await createRouteGroupCandidate({
      routeGroupKey: child.id,
      sourceRef: executionTarget.sourceRef,
      enabled: true,
    });
    await createRouteGroupFromPayload({
      model: { publicName: "custom-deepseek" },
      sourceSelection: {
        kind: "explicit",
        sources: [
          { kind: "route_group", id: child.id },
          { kind: "execution_target", sourceRef: executionTarget.sourceRef },
        ],
      },
      presentation: { displayName: "Custom DeepSeek", displayIcon: null },
    });

    const summaries = await loadRouteGroupManagementSummaries();
    const parent = summaries.find(
      (summary) => summary.model.publicName === "custom-deepseek",
    );
    expect(parent).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        sourceSelection: {
          kind: "explicit",
          sources: expect.arrayContaining([
            expect.objectContaining({
              source: { kind: "route_group", id: child.id },
              label: "DeepSeek V4",
              modelName: "deepseek-v4",
            }),
            expect.objectContaining({
              source: { kind: "execution_target", sourceRef: executionTarget.sourceRef },
              label: "ModelScope · deepseek-v4",
              siteName: "ModelScope",
            }),
          ]),
        },
      }),
    );
    const serialized = JSON.stringify(parent);
    expect(serialized).not.toContain("routeEndpointId");
    expect(serialized).not.toContain("routeBuilderMacroId");
    expect(serialized).not.toContain("sourceEndpointIds");
    expect(serialized).not.toContain('"backend"');
    expect(serialized).not.toContain('"match"');
  });

  it("does not rebuild the stable list when only execution health changes", async () => {
    const site = await db.insert(schema.sites).values({
      name: "Stable catalog",
      url: "https://stable-catalog.example.test",
      platform: "openai",
      status: "active",
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "stable-account",
      credential: "test-access",
      status: "active",
    }).returning().get();
    const target = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      sourceModel: "stable-model",
      source: "test",
    });
    const group = await createRouteGroupFromPayload({
      model: { publicName: "stable-model" },
      presentation: { displayName: "Stable model" },
    });
    await createRouteGroupCandidate({
      routeGroupKey: group.id,
      sourceRef: target.sourceRef,
      enabled: true,
    });

    const before = await loadRouteGroupManagementSummaries();
    await db.update(schema.runtimeExecutionTargetState).set({
      successCount: 7,
      failCount: 2,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.runtimeExecutionTargetState.executionTargetId, target.id)).run();
    const after = await loadRouteGroupManagementSummaries();
    expect(after).toBe(before);

    const stages = await listRouteGroupFallbackStages(group.id);
    expect(stages[0]?.candidates[0]).toMatchObject({
      successCount: 7,
      failCount: 2,
    });
  });

  it("persists regex source selection as a Graph-native model-pattern resolver", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "Pattern source",
        url: "https://pattern.example.test",
        platform: "openai",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        credential: "pattern-access",
        status: "active",
      })
      .returning()
      .get();
    const explicit = await createRouteGroupFromPayload({
      model: { publicName: "pattern-source-seed" },
      presentation: { displayName: "Pattern seed", displayIcon: null },
    });
    const executionTarget = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      tokenId: null,
      sourceModel: "deepseek-v4-flash",
      source: "test",
    });
    await createRouteGroupCandidate({
      routeGroupKey: explicit.id,
      sourceRef: executionTarget.sourceRef,
      enabled: true,
    });

    const patternGroup = await createRouteGroupFromPayload({
      model: { publicName: "deepseek-rerouted" },
      sourceSelection: {
        kind: "model_pattern",
        pattern: "re:^deepseek-v[34]-flash$",
      },
      presentation: { displayName: "DeepSeek rerouted", displayIcon: null },
    });

    expect(patternGroup.sourceSelection).toEqual({
      kind: "model_pattern",
      pattern: "re:^deepseek-v[34]-flash$",
    });
    expect(patternGroup.candidateCount).toBe(1);
    expect(patternGroup.enabledCandidateCount).toBe(1);
    expect(patternGroup.siteNames).toEqual(["Pattern source"]);
    const [patternStage] = await listRouteGroupFallbackStages(patternGroup.id);
    expect(patternStage?.candidateManagement).toBe("generated");
    await updateRouteGroupFallbackStage(patternGroup.id, patternStage!.id, {
      label: "Dynamic sources",
    });
    expect(
      (await loadRouteGroupManagementSummaries()).find(
        (summary) => summary.id === patternGroup.id,
      )?.sourceSelection,
    ).toEqual({
      kind: "model_pattern",
      pattern: "re:^deepseek-v[34]-flash$",
    });
    await expect(
      createRouteGroupCandidate({
        routeGroupKey: patternGroup.id,
        sourceRef: executionTarget.sourceRef,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "candidate_kind_unsupported" });

    const switched = await updateRouteGroupFromPayload(patternGroup.id, {
      sourceSelection: {
        kind: "explicit",
        sources: [{ kind: "execution_target", sourceRef: executionTarget.sourceRef }],
      },
    });
    expect(switched?.sourceSelection).toMatchObject({
      kind: "explicit",
      sources: [
        expect.objectContaining({
          source: { kind: "execution_target", sourceRef: executionTarget.sourceRef },
        }),
      ],
    });
  });

  it("lists selectable sources from management storage and excludes the editing group", async () => {
    const first = await createRouteGroupFromPayload({
      model: { publicName: "first-model", upstreamName: "first-model" },
      presentation: { displayName: null, displayIcon: null },
    });
    const second = await createRouteGroupFromPayload({
      model: { publicName: "second-model", upstreamName: "second-model" },
      presentation: { displayName: "Second model", displayIcon: null },
    });

    const sources = await listRouteGroupSourceCatalog({
      q: "second",
      excludeGroupKey: second.id,
    });
    expect(sources).toEqual([]);

    const firstSources = await listRouteGroupSourceCatalog({
      q: "second",
      excludeGroupKey: first.id,
    });
    expect(firstSources).toEqual([
      expect.objectContaining({
        source: { kind: "route_group", id: second.id },
        label: "Second model",
        modelName: "second-model",
      }),
    ]);
  });

  it("rejects malformed and stale source catalog cursors", async () => {
    const first = await createRouteGroupFromPayload({
      model: { publicName: "first-model", upstreamName: "first-model" },
      presentation: { displayName: "First model", displayIcon: null },
    });
    await createRouteGroupFromPayload({
      model: { publicName: "second-model", upstreamName: "second-model" },
      presentation: { displayName: "Second model", displayIcon: null },
    });

    await expect(
      listRouteGroupSourceCatalogPage({ cursor: "not-a-cursor", limit: 1 }),
    ).rejects.toMatchObject({ code: "invalid_source_catalog_cursor" });

    const firstPage = await listRouteGroupSourceCatalogPage({ limit: 1 });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(
      listRouteGroupSourceCatalogPage({
        cursor: firstPage.nextCursor,
        q: "second",
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "stale_source_catalog_cursor" });

    await updateRouteGroupFromPayload(first.id, {
      presentation: { displayName: "Renamed first model", displayIcon: null },
    });
    await expect(
      listRouteGroupSourceCatalogPage({
        cursor: firstPage.nextCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "stale_source_catalog_cursor" });

    const site = await db.insert(schema.sites).values({
      name: "Catalog source",
      url: "https://catalog.example.test",
      platform: "openai",
      status: "active",
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "before",
      credential: "catalog-access",
      status: "active",
    }).returning().get();
    const source = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      tokenId: null,
      sourceModel: "catalog-model",
      source: "test",
    });
    await createRouteGroupCandidate({
      routeGroupKey: first.id,
      sourceRef: source.sourceRef,
      enabled: true,
    });
    const targetPage = await listRouteGroupSourceCatalogPage({ limit: 1 });
    expect(targetPage.nextCursor).toEqual(expect.any(String));
    await db.update(schema.sites)
      .set({ name: "Catalog source renamed" })
      .where(eq(schema.sites.id, site.id))
      .run();
    await advanceRouteGroupManagementCatalogRevision();
    await expect(
      listRouteGroupSourceCatalogPage({
        cursor: targetPage.nextCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "stale_source_catalog_cursor" });
  });
});
