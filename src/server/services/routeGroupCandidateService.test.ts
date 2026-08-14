import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type DbModule = typeof import("../db/index.js");
type RouteGroupCandidateServiceModule =
  typeof import("./routeGroupCandidateService.js");
type RouteGroupManagementModule =
  typeof import("./routeGroupManagementService.js");
type RouteGroupPersistenceModule =
  typeof import("./routeGroupPersistenceService.js");
type RouteGroupFallbackStageModule =
  typeof import("./routeGroupFallbackStageService.js");
type RouteGraphServiceModule = typeof import("./routeGraphService.js");
type RuntimeExecutionTargetServiceModule = typeof import("./runtimeExecutionTargetService.js");

describe("routeGroupCandidateService", () => {
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let createRouteGroupCandidate: RouteGroupCandidateServiceModule["createRouteGroupCandidate"];
  let createRouteGroupCandidates: RouteGroupCandidateServiceModule["createRouteGroupCandidates"];
  let updateRouteGroupMember: RouteGroupCandidateServiceModule["updateRouteGroupMember"];
  let listRouteGroupCandidateCatalog: RouteGroupCandidateServiceModule["listRouteGroupCandidateCatalog"];
  let listRouteGroupCandidatesByGroupKeys: RouteGroupCandidateServiceModule["listRouteGroupCandidatesByGroupKeys"];
  let moveRouteGroupCandidatesToFallbackStages: RouteGroupCandidateServiceModule["moveRouteGroupCandidatesToFallbackStages"];
  let restoreAutomaticRouteGroupCandidateManagement: RouteGroupCandidateServiceModule["restoreAutomaticRouteGroupCandidateManagement"];
  let createRouteGroupFromPayload: RouteGroupManagementModule["createRouteGroupFromPayload"];
  let synchronizeAutomaticRouteGroups: RouteGroupPersistenceModule["synchronizeAutomaticRouteGroups"];
  let createRouteGroupFallbackStage: RouteGroupFallbackStageModule["createRouteGroupFallbackStage"];
  let reorderRouteGroupFallbackStages: RouteGroupFallbackStageModule["reorderRouteGroupFallbackStages"];
  let getActiveRouteGraphSourceVersion: RouteGraphServiceModule["getActiveRouteGraphSourceVersion"];
  let publishRouteGraphSource: RouteGraphServiceModule["publishRouteGraphSource"];
  let upsertRuntimeExecutionTarget: RuntimeExecutionTargetServiceModule["upsertRuntimeExecutionTarget"];
  let dataDir = "";

  beforeAll(async () => {
    dataDir = mkdtempSync(
      join(tmpdir(), "metapi-route-group-candidate-service-"),
    );
    process.env.DATA_DIR = dataDir;

    const migrate = await import("../db/migrate.js");
    await migrate.runSqliteMigrations();
    const dbModule = await import("../db/index.js");
    const service = await import("./routeGroupCandidateService.js");
    const management = await import("./routeGroupManagementService.js");
    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupCandidate = service.createRouteGroupCandidate;
    createRouteGroupCandidates = service.createRouteGroupCandidates;
    updateRouteGroupMember = service.updateRouteGroupMember;
    listRouteGroupCandidateCatalog = service.listRouteGroupCandidateCatalog;
    listRouteGroupCandidatesByGroupKeys =
      service.listRouteGroupCandidatesByGroupKeys;
    moveRouteGroupCandidatesToFallbackStages =
      service.moveRouteGroupCandidatesToFallbackStages;
    restoreAutomaticRouteGroupCandidateManagement =
      service.restoreAutomaticRouteGroupCandidateManagement;
    createRouteGroupFromPayload = management.createRouteGroupFromPayload;
    ({ synchronizeAutomaticRouteGroups } =
      await import("./routeGroupPersistenceService.js"));
    ({ createRouteGroupFallbackStage, reorderRouteGroupFallbackStages } =
      await import("./routeGroupFallbackStageService.js"));
    ({ getActiveRouteGraphSourceVersion, publishRouteGraphSource } =
      await import("./routeGraphService.js"));
    ({ upsertRuntimeExecutionTarget } =
      await import("./runtimeExecutionTargetService.js"));
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

  it("binds a candidate to the exact server-owned source reference", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "exact-source-site",
        url: "https://exact-source.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: "exact-source-user",
        credential: "access-exact-source",

        status: "active",
      })
      .returning()
      .get();
    const group = await createRouteGroupFromPayload({
      model: { publicName: "claude-opus-4-5", upstreamName: "claude-opus-4-5" },
      presentation: { displayName: null, displayIcon: null },
    });

    const source = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      tokenId: null,
      sourceModel: "claude-opus-4-5",
      source: "test",
    });
    const candidate = await createRouteGroupCandidate({
      routeGroupKey: group.id,
      sourceRef: source.sourceRef,
      weight: 10,
      enabled: true,
    });

    expect(candidate?.kind).toBe("execution_endpoint");
    expect(candidate?.kind === "execution_endpoint" ? candidate.targets[0]?.sourceModel : null)
      .toBe("claude-opus-4-5");
    const executionTarget = await db
      .select()
      .from(schema.runtimeExecutionTargets)
      .get();
    expect(executionTarget?.upstreamModelName).toBe("claude-opus-4-5");
    expect(executionTarget?.executionKey).toContain("upstream:claude-opus-4-5");
  });

  it("publishes a candidate batch as one graph version and rolls every fact back on failure", async () => {
    const site = await db.insert(schema.sites).values({
      name: "atomic-batch-site",
      url: "https://atomic-batch.example.com",
      platform: "new-api",
      status: "active",
    }).returning().get();
    const firstAccount = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "atomic-first",
      credential: "atomic-first-access",

      status: "active",
    }).returning().get();
    const secondAccount = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "atomic-second",
      credential: "atomic-second-access",

      status: "active",
    }).returning().get();
    const group = await createRouteGroupFromPayload({
      model: { publicName: "atomic-batch-model", upstreamName: "atomic-batch-model" },
      presentation: { displayName: null, displayIcon: null },
    });
    const versionsBefore = await db.select().from(schema.routeGraphVersions).all();

    const sources = await Promise.all([firstAccount, secondAccount].map((account) =>
      upsertRuntimeExecutionTarget({
        accountId: account.id,
        tokenId: null,
        sourceModel: "atomic-batch-model",
        source: "test",
      }),
    ));
    const created = await createRouteGroupCandidates({
      routeGroupKey: group.id,
      candidates: sources.map((source) => ({
        sourceRef: source.sourceRef,
      })),
    });

    expect(created).toHaveLength(2);
    expect((await db.select().from(schema.routeGraphVersions).all()).length).toBe(versionsBefore.length + 1);
    expect(await db.select().from(schema.runtimeExecutionTargets).all()).toHaveLength(2);

    const versionsBeforeFailure = await db.select().from(schema.routeGraphVersions).all();
    const targetsBeforeFailure = await db.select().from(schema.runtimeExecutionTargets).all();
    await expect(createRouteGroupCandidates({
      routeGroupKey: group.id,
      candidates: [
        { sourceRef: sources[0]!.sourceRef },
        { sourceRef: "67d54dd0-45c8-4d98-b7b9-7ac550192ec7" },
      ],
    })).rejects.toMatchObject({ code: "source_not_found" });
    expect(await db.select().from(schema.routeGraphVersions).all()).toHaveLength(versionsBeforeFailure.length);
    expect(await db.select().from(schema.runtimeExecutionTargets).all()).toHaveLength(targetsBeforeFailure.length);
  });

  it("projects runtime execution inputs for the candidate picker without exposing graph identities", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "candidate-catalog-site",
        url: "https://candidate-catalog.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const [currentAccount, otherAccount] = await Promise.all(
      ["current", "other"].map(
        async (name) =>
          await db
            .insert(schema.accounts)
            .values({
              siteId: site.id,
              username: `candidate-catalog-${name}`,
              credential: `access-candidate-catalog-${name}`,

              status: "active",
            })
            .returning()
            .get(),
      ),
    );
    const [currentGroup, otherGroup] = await Promise.all([
      createRouteGroupFromPayload({
        model: {
          publicName: "candidate-catalog-current",
          upstreamName: "candidate-catalog-current",
        },
        presentation: { displayName: null, displayIcon: null },
      }),
      createRouteGroupFromPayload({
        model: {
          publicName: "candidate-catalog-other",
          upstreamName: "candidate-catalog-other",
        },
        presentation: { displayName: null, displayIcon: null },
      }),
    ]);
    const currentSource = await upsertRuntimeExecutionTarget({
      accountId: currentAccount.id,
      tokenId: null,
      sourceModel: "catalog-model-current",
      source: "test",
    });
    const otherSource = await upsertRuntimeExecutionTarget({
      accountId: otherAccount.id,
      tokenId: null,
      sourceModel: "catalog-model-other",
      source: "test",
    });
    await createRouteGroupCandidate({
      routeGroupKey: currentGroup.id,
      sourceRef: currentSource.sourceRef,
    });
    await createRouteGroupCandidate({
      routeGroupKey: otherGroup.id,
      sourceRef: otherSource.sourceRef,
    });

    const items = await listRouteGroupCandidateCatalog(
      currentGroup.id,
      "catalog-model",
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: currentAccount.id,
          sourceModel: "catalog-model-current",
          alreadyMember: true,
        }),
        expect.objectContaining({
          accountId: otherAccount.id,
          sourceModel: "catalog-model-other",
          alreadyMember: false,
        }),
      ]),
    );
    expect(Object.keys(items[0] || {}).sort()).toEqual([
      "accountId",
      "accountLabel",
      "alreadyMember",
      "enabled",
      "siteName",
      "sourceModel",
      "sourceRef",
      "tokenId",
      "tokenName",
    ]);
    await expect(
      listRouteGroupCandidateCatalog(currentGroup.id, "not-a-runtime-model"),
    ).resolves.toEqual([]);
  });

  it("preserves automatic group fallback-flow overrides across availability rebuilds", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "automatic-flow-site",
        url: "https://automatic-flow.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const [firstAccount, secondAccount] = await Promise.all(
      ["first", "second"].map(
        async (name) =>
          await db
            .insert(schema.accounts)
            .values({
              siteId: site.id,
              username: `automatic-flow-${name}`,
              credential: `access-automatic-flow-${name}`,

              status: "active",
            })
            .returning()
            .get(),
      ),
    );
    const modelName = "automatic-flow-model";
    const candidates = new Map([
      [
        modelName,
        new Map([
          [
            "first",
            {
              accountId: firstAccount.id,
              tokenId: null,
              oauthRouteUnitId: null,
              siteId: site.id,
              modelName,
            },
          ],
          [
            "second",
            {
              accountId: secondAccount.id,
              tokenId: null,
              oauthRouteUnitId: null,
              siteId: site.id,
              modelName,
            },
          ],
        ]),
      ],
    ]);

    await synchronizeAutomaticRouteGroups(candidates);
    const active = await getActiveRouteGraphSourceVersion();
    const group = active?.sourceGraph.macros.find(
      (macro) => macro.kind === "candidate_selector",
    );
    expect(group).toBeDefined();
    const groupId = group!.id;
    const before = (await listRouteGroupCandidatesByGroupKeys([groupId])).get(
      groupId,
    )!;
    await expect(
      updateRouteGroupMember(groupId, before[0]!.id, { weight: 13 }),
    ).resolves.toMatchObject({ id: before[0]!.id, weight: 13 });
    const afterInPlaceUpdate = (
      await listRouteGroupCandidatesByGroupKeys([groupId])
    ).get(groupId)!;
    expect(afterInPlaceUpdate.map((candidate) => candidate.id)).toEqual(
      before.map((candidate) => candidate.id),
    );
    await restoreAutomaticRouteGroupCandidateManagement(groupId, [
      before[0]!.id,
    ]);
    const secondary = await createRouteGroupFallbackStage(groupId, {
      label: "Fallback",
      enabled: true,
    });
    await moveRouteGroupCandidatesToFallbackStages(groupId, [
      { id: before[1]!.id, stageId: secondary.id, sortOrder: 0 },
    ]);
    await expect(
      updateRouteGroupMember(groupId, before[1]!.id, {
        weight: 17,
        enabled: false,
      }),
    ).resolves.toMatchObject({ id: before[1]!.id, weight: 17, enabled: false });
    await expect(
      reorderRouteGroupFallbackStages(groupId, [
        secondary.id,
        before[0]!.fallbackStageId,
      ]),
    ).resolves.toMatchObject([
      { id: secondary.id },
      { id: before[0]!.fallbackStageId },
    ]);

    await synchronizeAutomaticRouteGroups(candidates);
    const after = (await listRouteGroupCandidatesByGroupKeys([groupId])).get(
      groupId,
    )!;
    expect(
      after.find((candidate) => candidate.id === before[1]!.id),
    ).toMatchObject({
      fallbackStageId: secondary.id,
      sortOrder: 0,
      manualOverride: true,
    });
    expect(
      after.find((candidate) => candidate.id === before[0]!.id)
        ?.fallbackStageId,
    ).not.toBe(secondary.id);
    const stages = await reorderRouteGroupFallbackStages(groupId, [
      secondary.id,
      before[0]!.fallbackStageId,
    ]);
    expect(stages.map((stage) => stage.id)).toEqual([
      secondary.id,
      before[0]!.fallbackStageId,
    ]);

    const activeWithoutRequiredProvenance =
      await getActiveRouteGraphSourceVersion();
    expect(activeWithoutRequiredProvenance).not.toBeNull();
    const published = await publishRouteGraphSource({
      sourceGraph: {
        ...activeWithoutRequiredProvenance!.sourceGraph,
        macros: activeWithoutRequiredProvenance!.sourceGraph.macros.map(
          (macro) => {
            if (macro.id !== groupId) return macro;
            const metadata = { ...macro.metadata };
            delete metadata.managementOwner;
            return { ...macro, metadata };
          },
        ),
      },
      createdBy: "route-group-candidate-service-test",
    });
    expect(published.ok).toBe(true);

    const restored = await restoreAutomaticRouteGroupCandidateManagement(
      groupId,
      [before[1]!.id],
    );
    expect(restored.restoredCount).toBe(1);
    expect(
      restored.stages
        .flatMap((stage) => stage.candidates)
        .find((candidate) => candidate.id === before[1]!.id),
    ).toMatchObject({
      fallbackStageId: before[0]!.fallbackStageId,
      weight: 10,
      enabled: true,
      manualOverride: false,
    });

    await synchronizeAutomaticRouteGroups(candidates);
    const activeAfterRestoreSynchronization =
      await getActiveRouteGraphSourceVersion();
    const synchronizedModelGroups =
      activeAfterRestoreSynchronization?.sourceGraph.macros.filter(
        (macro) =>
          macro.kind === "candidate_selector" &&
          String(macro.metadata?.canonicalModel || "").toLowerCase() ===
            modelName,
      ) || [];
    expect(synchronizedModelGroups).toHaveLength(1);
    expect(synchronizedModelGroups[0]?.id).toBe(groupId);
    expect(
      (await listRouteGroupCandidatesByGroupKeys([groupId]))
        .get(groupId)
        ?.find((candidate) => candidate.id === before[1]!.id),
    ).toMatchObject({
      fallbackStageId: before[0]!.fallbackStageId,
      weight: 10,
      enabled: true,
      manualOverride: false,
    });

    await moveRouteGroupCandidatesToFallbackStages(groupId, [
      { id: before[0]!.id, stageId: secondary.id, sortOrder: 0 },
      { id: before[1]!.id, stageId: secondary.id, sortOrder: 1 },
    ]);
    const restoredAll =
      await restoreAutomaticRouteGroupCandidateManagement(groupId);
    expect(restoredAll.restoredCount).toBe(2);
    expect(restoredAll.stages).toHaveLength(1);
    expect(restoredAll.stages[0]?.id).toBe(before[0]!.fallbackStageId);
    expect(
      restoredAll.stages[0]?.candidates.map((candidate) => ({
        id: candidate.id,
        weight: candidate.weight,
        enabled: candidate.enabled,
        manualOverride: candidate.manualOverride,
      })),
    ).toEqual([
      {
        id: before[0]!.id,
        weight: 10,
        enabled: true,
        manualOverride: false,
      },
      {
        id: before[1]!.id,
        weight: 10,
        enabled: true,
        manualOverride: false,
      },
    ]);
  });
});
