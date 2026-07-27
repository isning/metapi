import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  clearRouteGroupMemberTestData,
  getRouteGroupMember,
  insertRouteGroupMember,
  insertRouteGroupMembers,
} from "../../../testing/routeGroupMemberTestUtils.js";
import type { RouteGroupManagementSummary } from "../../../shared/routeGroupManagement.js";

type DbModule = typeof import("../../db/index.js");
type AccountRow = DbModule["schema"]["accounts"]["$inferSelect"];
type RouteGroupManagementModule =
  typeof import("../../services/routeGroupManagementService.js");
type RouteGroupFallbackStageModule =
  typeof import("../../services/routeGroupFallbackStageService.js");

describe("PUT /api/route-groups/:id/candidates/stages", () => {
  let app: FastifyInstance;
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let createRouteGroupFromPayload: RouteGroupManagementModule["createRouteGroupFromPayload"];
  let createRouteGroupFallbackStage: RouteGroupFallbackStageModule["createRouteGroupFallbackStage"];
  let dataDir = "";
  let seedId = 0;

  const nextId = () => {
    seedId += 1;
    return seedId;
  };

  const seedTarget = async (options: {
    fallbackStageOrder?: number;
    weight: number;
    manualOverride?: boolean;
    group?: RouteGroupManagementSummary;
    account?: AccountRow;
    sourceModel?: string;
  }) => {
    const id = nextId();
    const site = options.account
      ? null
      : await db
          .insert(schema.sites)
          .values({
            name: `site-${id}`,
            url: `https://example.com/${id}`,
            platform: "new-api",
          })
          .returning()
          .get();
    const account =
      options.account ??
      (await db
        .insert(schema.accounts)
        .values({
          siteId: site!.id,
          accessToken: `access-token-${id}`,
          apiToken: `api-token-${id}`,
        })
        .returning()
        .get());
    const group =
      options.group ??
      (await createRouteGroupFromPayload({
        model: { publicName: `gpt-4o-${id}` },
        presentation: { displayName: `gpt-4o-${id}` },
        enabled: true,
        dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
      }));

    const candidate = await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      sourceModel: options.sourceModel,
      fallbackStageOrder: options.fallbackStageOrder,
      weight: options.weight,
      manualOverride: options.manualOverride ?? false,
    });
    return { group, candidate };
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "metapi-tokens-batch-"));
    process.env.DATA_DIR = dataDir;

    const migrate = await import("../../db/migrate.js");
    await migrate.runSqliteMigrations();
    const dbModule = await import("../../db/index.js");
    const routesModule = await import("./tokens.js");
    const routeGroupManagementModule =
      await import("../../services/routeGroupManagementService.js");
    const routeGroupFallbackStageModule =
      await import("../../services/routeGroupFallbackStageService.js");
    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupFromPayload =
      routeGroupManagementModule.createRouteGroupFromPayload;
    createRouteGroupFallbackStage =
      routeGroupFallbackStageModule.createRouteGroupFallbackStage;

    app = Fastify();
    await app.register(routesModule.tokensRoutes);
  });

  beforeEach(async () => {
    await clearRouteGroupMemberTestData();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFallbackStage(
    groupId: string,
    input: { order: number; label: string },
  ) {
    const created = await createRouteGroupFallbackStage(groupId, {
      label: input.label,
      dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
      enabled: true,
    });
    expect(created.order).toBe(input.order);
    return created;
  }

  it("returns 400 when stage updates are missing or empty", async () => {
    const missingRes = await app.inject({
      method: "PUT",
      url: "/api/route-groups/unknown/candidates/stages",
      payload: {},
    });
    expect(missingRes.statusCode).toBe(400);
    expect(missingRes.json()).toMatchObject({ success: false });

    const emptyRes = await app.inject({
      method: "PUT",
      url: "/api/route-groups/unknown/candidates/stages",
      payload: { updates: [] },
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json()).toMatchObject({ success: false });
  });

  it("returns 400 when a stage update item is invalid", async () => {
    const target = await seedTarget({ fallbackStageOrder: 0, weight: 10 });
    const invalidIdRes = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/candidates/stages`,
      payload: {
        updates: [{ id: "1", stageId: 1 }],
      },
    });
    expect(invalidIdRes.statusCode).toBe(400);
    expect(invalidIdRes.json()).toMatchObject({ success: false });

    const invalidStageRes = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/candidates/stages`,
      payload: {
        updates: [{ id: target.candidate.id, stageId: 0 }],
      },
    });
    expect(invalidStageRes.statusCode).toBe(400);
    expect(invalidStageRes.json()).toMatchObject({ success: false });
  });

  it("moves candidates between ordered fallback stages, preserves weights, and marks explicit placement", async () => {
    const targetA = await seedTarget({
      fallbackStageOrder: 0,
      weight: 17,
      manualOverride: false,
    });
    const targetB = await seedTarget({
      fallbackStageOrder: 0,
      weight: 23,
      manualOverride: false,
      group: targetA.group,
      sourceModel: `${targetA.group.model.upstreamName}-alternate`,
    });
    const fallbackStage = await createFallbackStage(targetA.group.id, {
      order: 1,
      label: "Fallback",
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(targetA.group.id)}/candidates/stages`,
      payload: {
        manuallyAdjustedCandidateIds: [targetA.candidate.id],
        updates: [
          { id: targetA.candidate.id, stageId: fallbackStage.id, sortOrder: 1 },
          { id: targetB.candidate.id, stageId: fallbackStage.id, sortOrder: 0 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      candidates: Array<{
        id: string;
        fallbackStageId: string;
        fallbackStageOrder: number;
        sortOrder: number;
        weight: number;
        manualOverride: boolean;
      }>;
    };
    expect(body.success).toBe(true);
    expect(body.candidates).toHaveLength(2);

    const returnedA = body.candidates.find(
      (candidate) => candidate.id === targetA.candidate.id,
    );
    const returnedB = body.candidates.find(
      (candidate) => candidate.id === targetB.candidate.id,
    );
    expect(returnedA).toBeDefined();
    expect(returnedB).toBeDefined();
    expect(returnedA?.fallbackStageId).toBe(fallbackStage.id);
    expect(returnedB?.fallbackStageId).toBe(fallbackStage.id);
    expect(returnedA?.fallbackStageOrder).toBe(1);
    expect(returnedB?.fallbackStageOrder).toBe(1);
    expect(returnedA?.sortOrder).toBe(1);
    expect(returnedB?.sortOrder).toBe(0);
    expect(returnedA?.weight).toBe(17);
    expect(returnedB?.weight).toBe(23);
    expect(returnedA?.manualOverride).toBe(true);
    expect(returnedB?.manualOverride).toBe(false);

    const dbA = await getRouteGroupMember(targetA.candidate.id);
    const dbB = await getRouteGroupMember(targetB.candidate.id);
    expect(dbA?.fallbackStageId).toBe(fallbackStage.id);
    expect(dbB?.fallbackStageId).toBe(fallbackStage.id);
    expect(dbA?.fallbackStageOrder).toBe(1);
    expect(dbB?.fallbackStageOrder).toBe(1);
    expect(dbA?.sortOrder).toBe(1);
    expect(dbB?.sortOrder).toBe(0);
    expect(dbA?.weight).toBe(17);
    expect(dbB?.weight).toBe(23);
    expect(dbA?.manualOverride).toBe(true);
    expect(dbB?.manualOverride).toBe(false);
  });

  it("does not mark an unchanged candidate as manually adjusted", async () => {
    const target = await seedTarget({
      fallbackStageOrder: 0,
      weight: 17,
      manualOverride: false,
    });
    const versionCountBefore = (
      await db
        .select({ id: schema.routeGraphVersions.id })
        .from(schema.routeGraphVersions)
        .all()
    ).length;

    const res = await app.inject({
      method: "PUT",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/candidates/stages`,
      payload: {
        updates: [
          {
            id: target.candidate.id,
            stageId: target.candidate.fallbackStageId,
            sortOrder: target.candidate.sortOrder,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, candidates: [] });
    expect(
      (await getRouteGroupMember(target.candidate.id))?.manualOverride,
    ).toBe(false);
    expect(
      (
        await db
          .select({ id: schema.routeGraphVersions.id })
          .from(schema.routeGraphVersions)
          .all()
      ).length,
    ).toBe(versionCountBefore);
  });

  it("creates a fallback stage and moves its candidate in one graph publication", async () => {
    const target = await seedTarget({
      fallbackStageOrder: 0,
      weight: 17,
      manualOverride: false,
    });
    const versionCountBefore = (
      await db
        .select({ id: schema.routeGraphVersions.id })
        .from(schema.routeGraphVersions)
        .all()
    ).length;

    const res = await app.inject({
      method: "POST",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/stages`,
      payload: {
        label: null,
        enabled: true,
        placement: {
          afterStageId: target.candidate.fallbackStageId,
          candidateId: target.candidate.id,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      stage: { id: string };
      stages: Array<{
        id: string;
        order: number;
        candidates: Array<{ id: string; manualOverride: boolean }>;
      }>;
    };
    expect(body.stages).toHaveLength(2);
    expect(body.stages[1]).toMatchObject({
      id: body.stage.id,
      order: 1,
      candidates: [{ id: target.candidate.id, manualOverride: true }],
    });
    expect(
      (
        await db
          .select({ id: schema.routeGraphVersions.id })
          .from(schema.routeGraphVersions)
          .all()
      ).length,
    ).toBe(versionCountBefore + 1);
  });

  it("rejects automatic-management restore commands for manual route groups", async () => {
    const target = await seedTarget({
      fallbackStageOrder: 0,
      weight: 17,
      manualOverride: true,
    });

    const candidateRes = await app.inject({
      method: "DELETE",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/candidates/${encodeURIComponent(target.candidate.id)}/manual-adjustment`,
    });
    expect(candidateRes.statusCode).toBe(400);

    const groupRes = await app.inject({
      method: "DELETE",
      url: `/api/route-groups/${encodeURIComponent(target.group.id)}/manual-adjustments`,
    });
    expect(groupRes.statusCode).toBe(400);
    expect(
      (await getRouteGroupMember(target.candidate.id))?.manualOverride,
    ).toBe(true);
  });

  it("reports the number of routes actually updated in route batch operations", async () => {
    const group = await createRouteGroupFromPayload({
      model: { publicName: "gpt-4o-mini" },
      presentation: { displayName: "gpt-4o-mini" },
      enabled: true,
      dispatcherPolicy: { kind: "builtin", builtin: "weighted" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/route-groups/batch",
      payload: {
        ids: [group.id, "manual:missing-route-group"],
        action: "disable",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      updatedCount: 1,
    });

    const { loadRouteGroupByKey } =
      await import("../../services/routeGroupManagementService.js");
    expect((await loadRouteGroupByKey(group.id))?.enabled).toBe(false);
  });

  it("rejects route batch payloads whose ids are not route group keys", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/route-groups/batch",
      payload: {
        ids: [1],
        action: "disable",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      code: 'invalid_route_group_payload',
    });
  });

  it("rejects non-boolean wait when rebuilding routes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/route-groups/rebuild",
      payload: {
        wait: "true",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      code: 'invalid_route_group_payload',
    });
  });
});
