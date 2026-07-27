import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatUtcSqlDateTime } from "./localTimeService.js";

type DbModule = typeof import("../db/index.js");
type ProjectorModule = typeof import("./usageAggregationService.js");

function billingDetails(amount: number) {
  return JSON.stringify({
    quote: {
      amount,
      unit: "currency",
      currency: "USD",
      source: "provider_catalog",
      sourceId: "catalog:test",
      matchedScope: "provider_catalog",
      estimateLevel: "exact",
      planFingerprint: "sha256:test-plan",
    },
  });
}

describe("usageAggregationService", () => {
  let db: DbModule["db"];
  let schema: DbModule["schema"];
  let runUsageAggregationProjectionPass: ProjectorModule["runUsageAggregationProjectionPass"];
  let requestUsageAggregatesRecompute: ProjectorModule["requestUsageAggregatesRecompute"];
  let dataDir = "";
  let previousDataDir: string | undefined;

  beforeAll(async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), "metapi-usage-projector-"));
    process.env.DATA_DIR = dataDir;

    const migrate = await import("../db/migrate.js");
    await migrate.runSqliteMigrations();
    const dbModule = await import("../db/index.js");
    const projectorModule = await import("./usageAggregationService.js");
    db = dbModule.db;
    schema = dbModule.schema;
    runUsageAggregationProjectionPass = projectorModule.runUsageAggregationProjectionPass;
    requestUsageAggregatesRecompute = projectorModule.requestUsageAggregatesRecompute;
  });

  beforeEach(async () => {
    await db.delete(schema.analyticsProjectionCheckpoints).run();
    await db.delete(schema.billingCostAggregates).run();
    await db.delete(schema.routeRuntimeDayUsage).run();
    await db.delete(schema.modelDayUsage).run();
    await db.delete(schema.siteHourUsage).run();
    await db.delete(schema.siteDayUsage).run();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.proxyRequests).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("projects proxy logs into day/hour/model aggregates and supports recompute requests", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "agg-site",
        url: "https://agg.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: "agg-user",
        accessToken: "agg-token",
        status: "active",
      })
      .returning()
      .get();

    await db.insert(schema.proxyRequests).values([
      {
        id: "request-success",
        downstreamPath: "/v1/chat/completions",
        requestedModel: "gpt-5",
        actualModel: "gpt-5",
        finalSiteId: site.id,
        finalAccountId: account.id,
        routeEntrypointId: "entry:gpt-5",
        runtimeEndpointId: "supply:gpt-5:primary",
        status: "success",
        finalExecutionAttemptId: "attempt:gpt-5:primary",
        totalTokens: 100,
        estimatedCost: 0.2,
        billingDetails: billingDetails(0.2),
        latencyMs: 120,
        completedAt: formatUtcSqlDateTime(new Date("2026-04-08T02:10:00.000Z")),
      },
      {
        id: "request-failure",
        downstreamPath: "/v1/chat/completions",
        requestedModel: "gpt-5-mini",
        actualModel: "gpt-5-mini",
        finalSiteId: site.id,
        finalAccountId: account.id,
        routeEntrypointId: "entry:gpt-5",
        runtimeEndpointId: "supply:gpt-5:backup",
        status: "failure",
        finalExecutionAttemptId: "attempt:gpt-5:backup",
        totalTokens: 50,
        estimatedCost: 0.1,
        billingDetails: billingDetails(0.1),
        latencyMs: 80,
        completedAt: formatUtcSqlDateTime(new Date("2026-04-08T02:45:00.000Z")),
      },
    ]).run();
    await db.insert(schema.proxyLogs).values([
      {
        requestId: "request-success",
        accountId: account.id,
        routeEntrypointId: "entry:gpt-5",
        runtimeEndpointId: "supply:gpt-5:primary",
        executionTargetId: 301,
        executionAttemptId: "attempt:gpt-5:primary",
        status: "success",
        modelRequested: "gpt-5",
        modelActual: "gpt-5",
        totalTokens: 100,
        estimatedCost: 0.2,
        billingDetails: billingDetails(0.2),
        latencyMs: 120,
        createdAt: formatUtcSqlDateTime(new Date("2026-04-08T02:10:00.000Z")),
      },
      {
        requestId: "request-failure",
        accountId: account.id,
        routeEntrypointId: "entry:gpt-5",
        runtimeEndpointId: "supply:gpt-5:backup",
        executionTargetId: 302,
        executionAttemptId: "attempt:gpt-5:backup",
        status: "failed",
        modelRequested: "gpt-5-mini",
        modelActual: "gpt-5-mini",
        totalTokens: 50,
        estimatedCost: 0.1,
        billingDetails: billingDetails(0.1),
        latencyMs: 80,
        createdAt: formatUtcSqlDateTime(new Date("2026-04-08T02:45:00.000Z")),
      },
    ]).run();

    const firstPass = await runUsageAggregationProjectionPass();
    expect(firstPass.processedLogs).toBe(2);

    const dayRows = await db.select().from(schema.siteDayUsage).all();
    expect(dayRows).toHaveLength(1);
    expect(dayRows[0]).toEqual(
      expect.objectContaining({
        siteId: site.id,
        totalCalls: 2,
        successCalls: 1,
        failedCalls: 1,
        totalTokens: 150,
      }),
    );
    const firstCostRows = await db.select().from(schema.billingCostAggregates).all();
    const firstSiteCosts = firstCostRows.filter((row) => row.observationGrain === "request" && row.subjectKind === "site");
    expect(firstSiteCosts.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)).toBeCloseTo(0.3, 6);
    expect(firstSiteCosts.reduce((sum, row) => sum + row.knownObservationCount, 0)).toBe(2);
    expect(firstSiteCosts.reduce((sum, row) => sum + row.unknownObservationCount, 0)).toBe(0);

    const hourRows = await db.select().from(schema.siteHourUsage).all();
    expect(hourRows).toHaveLength(1);
    expect(hourRows[0]).toEqual(
      expect.objectContaining({
        siteId: site.id,
        totalCalls: 2,
        successCalls: 1,
        failedCalls: 1,
      }),
    );

    const modelRows = await db.select().from(schema.modelDayUsage).all();
    expect(modelRows).toHaveLength(2);
    expect(modelRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ siteId: site.id, accountId: account.id, model: "gpt-5" }),
        expect.objectContaining({ siteId: site.id, accountId: account.id, model: "gpt-5-mini" }),
      ]),
    );

    const runtimeRows = await db.select().from(schema.routeRuntimeDayUsage).all();
    expect(runtimeRows).toHaveLength(2);
    expect(runtimeRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeEntrypointId: "entry:gpt-5",
          runtimeEndpointId: "supply:gpt-5:primary",
          executionTargetId: 301,
          executionAttemptId: "attempt:gpt-5:primary",
          siteId: site.id,
          accountId: account.id,
            model: "gpt-5",
          totalCalls: 1,
          successCalls: 1,
          failedCalls: 0,
          totalTokens: 100,
        }),
        expect.objectContaining({
          routeEntrypointId: "entry:gpt-5",
          runtimeEndpointId: "supply:gpt-5:backup",
          executionTargetId: 302,
          executionAttemptId: "attempt:gpt-5:backup",
          siteId: site.id,
          accountId: account.id,
            model: "gpt-5-mini",
          totalCalls: 1,
          successCalls: 0,
          failedCalls: 1,
          totalTokens: 50,
        }),
      ]),
    );

    await db.insert(schema.proxyRequests).values({
      id: "request-success-2",
      downstreamPath: "/v1/chat/completions",
      requestedModel: "gpt-5",
      actualModel: "gpt-5",
      finalSiteId: site.id,
      finalAccountId: account.id,
      routeEntrypointId: "entry:gpt-5",
      runtimeEndpointId: "supply:gpt-5:primary",
      status: "success",
      finalExecutionAttemptId: "attempt:gpt-5:primary",
      totalTokens: 20,
      estimatedCost: 0.04,
      billingDetails: billingDetails(0.04),
      latencyMs: 60,
      completedAt: formatUtcSqlDateTime(new Date("2026-04-08T02:50:00.000Z")),
    }).run();
    await db.insert(schema.proxyLogs).values({
      requestId: "request-success-2",
      accountId: account.id,
      routeEntrypointId: "entry:gpt-5",
      runtimeEndpointId: "supply:gpt-5:primary",
      executionTargetId: 301,
      executionAttemptId: "attempt:gpt-5:primary",
      status: "success",
      modelRequested: "gpt-5",
      modelActual: "gpt-5",
      totalTokens: 20,
      estimatedCost: 0.04,
      billingDetails: billingDetails(0.04),
      latencyMs: 60,
      createdAt: formatUtcSqlDateTime(new Date("2026-04-08T02:50:00.000Z")),
    }).run();

    const secondPass = await runUsageAggregationProjectionPass();
    expect(secondPass.processedLogs).toBe(1);

    const updatedDayRows = await db.select().from(schema.siteDayUsage).all();
    expect(updatedDayRows[0]).toEqual(
      expect.objectContaining({
        siteId: site.id,
        totalCalls: 3,
        successCalls: 2,
        failedCalls: 1,
        totalTokens: 170,
      }),
    );
    expect((await db.select().from(schema.billingCostAggregates).all())
      .filter((row) => row.observationGrain === "request" && row.subjectKind === "site")
      .reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)).toBeCloseTo(0.34, 6);

    const updatedRuntimeRows = await db.select().from(schema.routeRuntimeDayUsage).all();
    expect(updatedRuntimeRows).toHaveLength(2);
    expect(updatedRuntimeRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionTargetId: 301,
          executionAttemptId: "attempt:gpt-5:primary",
          totalCalls: 2,
          successCalls: 2,
          failedCalls: 0,
          totalTokens: 120,
        }),
        expect.objectContaining({
          executionTargetId: 302,
          executionAttemptId: "attempt:gpt-5:backup",
          totalCalls: 1,
          successCalls: 0,
          failedCalls: 1,
          totalTokens: 50,
        }),
      ]),
    );

    await requestUsageAggregatesRecompute(1);
    const recomputePass = await runUsageAggregationProjectionPass();
    expect(recomputePass.recomputed).toBe(true);

    const recomputedDayRows = await db.select().from(schema.siteDayUsage).all();
    expect(recomputedDayRows[0]).toEqual(
      expect.objectContaining({
        siteId: site.id,
        totalCalls: 3,
        successCalls: 2,
        failedCalls: 1,
        totalTokens: 170,
      }),
    );
    expect((await db.select().from(schema.billingCostAggregates).all())
      .filter((row) => row.observationGrain === "request" && row.subjectKind === "site")
      .reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)).toBeCloseTo(0.34, 6);

    const recomputedRuntimeRows = await db.select().from(schema.routeRuntimeDayUsage).all();
    expect(recomputedRuntimeRows).toHaveLength(2);
    expect(recomputedRuntimeRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionTargetId: 301,
          executionAttemptId: "attempt:gpt-5:primary",
          totalCalls: 2,
          successCalls: 2,
          failedCalls: 0,
          totalTokens: 120,
        }),
        expect.objectContaining({
          executionTargetId: 302,
          executionAttemptId: "attempt:gpt-5:backup",
          totalCalls: 1,
          successCalls: 0,
          failedCalls: 1,
          totalTokens: 50,
        }),
      ]),
    );
  });

  it("projects attempt usage without manufacturing terminal request aggregates", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "runtime-model-source-site",
        url: "https://runtime-model-source.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: "runtime-model-source-user",
        accessToken: "runtime-model-source-token",
        status: "active",
      })
      .returning()
      .get();

    await db.insert(schema.proxyLogs).values([
      {
        accountId: account.id,
        routeEntrypointId: "entry:runtime-model-source",
        runtimeEndpointId: "endpoint:runtime-model-source",
        executionTargetId: 401,
        executionAttemptId: "attempt:runtime-model-source",
        status: "success",
        modelRequested: "public-model-should-not-be-runtime",
        modelActual: "actual-model-should-not-be-runtime",
        totalTokens: 10,
        estimatedCost: 0.01,
        billingDetails: billingDetails(0.01),
        createdAt: formatUtcSqlDateTime(new Date("2026-04-09T02:10:00.000Z")),
      },
      {
        accountId: account.id,
        routeEntrypointId: "entry:runtime-model-source",
        runtimeEndpointId: "endpoint:runtime-model-source",
        executionTargetId: 402,
        executionAttemptId: "attempt:runtime-model-source-snapshot",
        status: "success",
        modelRequested: "public-model-should-not-be-runtime",
        modelActual: "actual-model-should-not-be-runtime",
        totalTokens: 20,
        estimatedCost: 0.02,
        billingDetails: billingDetails(0.02),
        createdAt: formatUtcSqlDateTime(new Date("2026-04-09T02:20:00.000Z")),
      },
    ]).run();

    const pass = await runUsageAggregationProjectionPass();
    expect(pass.processedLogs).toBe(2);

    const modelRows = await db.select().from(schema.modelDayUsage).all();
    expect(modelRows).toEqual([]);

    const runtimeRows = await db.select().from(schema.routeRuntimeDayUsage).all();
    expect(runtimeRows).toHaveLength(2);
    expect(runtimeRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        executionAttemptId: "attempt:runtime-model-source",
        model: "actual-model-should-not-be-runtime",
        totalCalls: 1,
        totalTokens: 10,
      }),
      expect.objectContaining({
        executionAttemptId: "attempt:runtime-model-source-snapshot",
        model: "actual-model-should-not-be-runtime",
        totalCalls: 1,
        totalTokens: 20,
      }),
    ]));
  });

  it("projects an attempt before its request completes and later projects the terminal request exactly once", async () => {
    const site = await db.insert(schema.sites).values({
      name: "late-terminal-site",
      url: "https://late-terminal.example.com",
      platform: "new-api",
      status: "active",
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "late-terminal-user",
      accessToken: "late-terminal-token",
      status: "active",
    }).returning().get();
    const completedAt = formatUtcSqlDateTime(new Date("2026-04-09T03:10:00.000Z"));

    await db.insert(schema.proxyRequests).values({
      id: "request-late-terminal",
      downstreamPath: "/v1/chat/completions",
      requestedModel: "gpt-late-terminal",
      downstreamApiKeyId: null,
      status: "started",
    }).run();
    await db.insert(schema.proxyLogs).values({
      requestId: "request-late-terminal",
      accountId: account.id,
      routeEntrypointId: "entry:late-terminal",
      runtimeEndpointId: "endpoint:late-terminal",
      executionTargetId: 451,
      executionAttemptId: "attempt:late-terminal",
      status: "success",
      modelRequested: "gpt-late-terminal",
      modelActual: "gpt-late-terminal",
      totalTokens: 40,
      estimatedCost: 0.04,
      billingDetails: billingDetails(0.04),
      latencyMs: 80,
      createdAt: completedAt,
    }).run();

    expect(await runUsageAggregationProjectionPass()).toMatchObject({
      processedLogs: 1,
      processedRequests: 0,
    });
    expect(await db.select().from(schema.siteDayUsage).all()).toHaveLength(0);
    expect(await db.select().from(schema.routeRuntimeDayUsage).all()).toHaveLength(1);

    await db.update(schema.proxyRequests).set({
      actualModel: "gpt-late-terminal",
      finalSiteId: site.id,
      finalAccountId: account.id,
      routeEntrypointId: "entry:late-terminal",
      runtimeEndpointId: "endpoint:late-terminal",
      finalExecutionAttemptId: "attempt:late-terminal",
      status: "success",
      totalTokens: 40,
      estimatedCost: 0.04,
      billingDetails: billingDetails(0.04),
      latencyMs: 80,
      completedAt,
    }).where(eq(schema.proxyRequests.id, "request-late-terminal")).run();

    expect(await runUsageAggregationProjectionPass()).toMatchObject({
      processedLogs: 0,
      processedRequests: 1,
    });
    expect(await db.select().from(schema.siteDayUsage).all()).toEqual([
      expect.objectContaining({ totalCalls: 1, successCalls: 1, totalTokens: 40 }),
    ]);
    expect(await db.select().from(schema.modelDayUsage).all()).toEqual([
      expect.objectContaining({ totalCalls: 1, successCalls: 1, totalTokens: 40 }),
    ]);
    expect(await db.select().from(schema.routeRuntimeDayUsage).all()).toHaveLength(1);
    expect(await runUsageAggregationProjectionPass()).toMatchObject({
      processedLogs: 0,
      processedRequests: 0,
    });
  });

  it("counts a fallback chain once at request grain and once per attempt at runtime grain", async () => {
    const site = await db.insert(schema.sites).values({
      name: "fallback-site",
      url: "https://fallback.example.com",
      platform: "new-api",
      status: "active",
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: "fallback-user",
      accessToken: "fallback-token",
      status: "active",
    }).returning().get();
    const completedAt = formatUtcSqlDateTime(new Date("2026-04-10T02:10:00.000Z"));
    await db.insert(schema.proxyRequests).values({
      id: "request-fallback",
      downstreamPath: "/v1/chat/completions",
      requestedModel: "gpt-5",
      actualModel: "gpt-5",
      finalSiteId: site.id,
      finalAccountId: account.id,
      routeEntrypointId: "entry:fallback",
      runtimeEndpointId: "endpoint:fallback:5",
      status: "success",
      finalExecutionAttemptId: "attempt:fallback:5",
      totalTokens: 321,
      estimatedCost: 0.42,
      billingDetails: billingDetails(0.42),
      latencyMs: 900,
      completedAt,
    }).run();
    await db.insert(schema.proxyLogs).values(Array.from({ length: 5 }, (_, index) => ({
      requestId: "request-fallback",
      accountId: account.id,
      routeEntrypointId: "entry:fallback",
      runtimeEndpointId: `endpoint:fallback:${index + 1}`,
      executionTargetId: 500 + index,
      executionAttemptId: `attempt:fallback:${index + 1}`,
      status: index === 4 ? "success" : "failed",
      modelRequested: "gpt-5",
      modelActual: "gpt-5",
      totalTokens: index === 4 ? 321 : 0,
      estimatedCost: index === 4 ? 0.42 : null,
      billingDetails: index === 4 ? billingDetails(0.42) : null,
      latencyMs: 100 + index,
      createdAt: completedAt,
    }))).run();

    expect((await runUsageAggregationProjectionPass()).processedLogs).toBe(5);
    expect(await db.select().from(schema.siteDayUsage).all()).toEqual([
      expect.objectContaining({ totalCalls: 1, successCalls: 1, failedCalls: 0, totalTokens: 321 }),
    ]);
    expect(await db.select().from(schema.modelDayUsage).all()).toEqual([
      expect.objectContaining({ totalCalls: 1, successCalls: 1, failedCalls: 0, totalTokens: 321 }),
    ]);
    const runtimeRows = await db.select().from(schema.routeRuntimeDayUsage).all();
    expect(runtimeRows).toHaveLength(5);
    expect(runtimeRows.reduce((sum, row) => sum + row.totalCalls, 0)).toBe(5);
    expect(runtimeRows.reduce((sum, row) => sum + row.successCalls, 0)).toBe(1);
    expect(runtimeRows.reduce((sum, row) => sum + row.failedCalls, 0)).toBe(4);
  });

  it("skips projection while another process lease is active and clears lease after success", async () => {
    const site = await db
      .insert(schema.sites)
      .values({
        name: "leased-site",
        url: "https://leased.example.com",
        platform: "new-api",
        status: "active",
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: "leased-user",
        accessToken: "leased-token",
        status: "active",
      })
      .returning()
      .get();

    await db.insert(schema.proxyLogs).values({
      accountId: account.id,
      status: "success",
      modelRequested: "gpt-5",
      modelActual: "gpt-5",
      totalTokens: 10,
      estimatedCost: 0.02,
      billingDetails: billingDetails(0.02),
      latencyMs: 50,
      createdAt: formatUtcSqlDateTime(new Date("2026-04-08T03:00:00.000Z")),
    }).run();

    await db.insert(schema.analyticsProjectionCheckpoints).values({
      projectorKey: "usage-aggregates-v1",
      timeZone: "Local",
      lastProxyLogId: 0,
      leaseOwner: "other-process",
      leaseToken: "other-token",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).run();

    const blockedPass = await runUsageAggregationProjectionPass();
    expect(blockedPass.processedLogs).toBe(0);
    expect(await db.select().from(schema.siteDayUsage).all()).toHaveLength(0);

    await db
      .update(schema.analyticsProjectionCheckpoints)
      .set({
        leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .where(eq(schema.analyticsProjectionCheckpoints.projectorKey, "usage-aggregates-v1"))
      .run();

    const successfulPass = await runUsageAggregationProjectionPass();
    expect(successfulPass.processedLogs).toBe(1);

    const checkpoint = await db
      .select()
      .from(schema.analyticsProjectionCheckpoints)
      .where(eq(schema.analyticsProjectionCheckpoints.projectorKey, "usage-aggregates-v1"))
      .get();
    expect(checkpoint?.leaseOwner).toBeNull();
    expect(checkpoint?.leaseToken).toBeNull();
    expect(checkpoint?.leaseExpiresAt).toBeNull();
    expect(checkpoint?.lastError).toBeNull();
  });
});
