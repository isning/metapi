import { FastifyInstance } from "fastify";
import { db, schema } from "../../db/index.js";
import { insertAndGetById } from "../../db/insertHelpers.js";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { refreshBalance } from "../../services/balanceService.js";
import { getAdapter } from "../../services/platforms/index.js";
import {
  convergeAccountMutation,
  rebuildRoutesBestEffort,
} from "../../services/accountMutationWorkflow.js";
import { retireAccountFromRouting } from '../../services/accountRetirementService.js';
import { invalidateRouteGraphReadCaches } from '../../services/routeGraphService.js';
import {
  getProxyUrlFromExtraConfig,
  guessPlatformUserIdFromUsername,
  applyAccountConnectionValues,
  mergeAccountExtraConfig,
  resolveStoredAccountCredentialMode,
  resolvePlatformUserId,
  type AccountCredentialMode,
} from "../../services/accountExtraConfig.js";
import {
  buildAccountCapabilities,
  type AccountCapabilities,
} from '../../services/accountCapabilities.js';
import { encryptAccountPassword } from "../../services/accountCredentialService.js";
import { applyAccountUpdateWorkflow } from "../../services/accountUpdateWorkflow.js";
import { startBackgroundTask } from "../../services/backgroundTaskService.js";
import { parseCheckinRewardAmount } from "../../services/checkinRewardParser.js";
import { estimateRewardWithTodayIncomeFallback } from "../../services/todayIncomeRewardService.js";
import { getLocalDayRangeUtc } from "../../services/localTimeService.js";
import {
  buildRuntimeHealthForAccount,
  setAccountRuntimeHealth,
  type RuntimeHealthState,
} from "../../services/accountHealthService.js";
import { appendSessionTokenRebindHint } from "../../services/alertRules.js";
import {
  parseSiteProxyUrlInput,
  withAccountProxyOverride,
  withSiteRecordProxyRequestInit,
} from "../../services/siteProxy.js";
import { createRateLimitGuard } from "../../middleware/requestRateLimit.js";
import { getAccountsSnapshot } from "../../services/accountsOverviewService.js";
import {
  parseAccountBatchPayload,
  parseAccountCreatePayload,
  parseAccountHealthRefreshPayload,
  parseAccountLoginPayload,
  parseAccountManualModelsPayload,
  parseAccountRebindSessionPayload,
  parseAccountUpdatePayload,
  parseAccountVerifyTokenPayload,
} from "../../contracts/accountsRoutePayloads.js";
import {
  requireSiteApiBaseUrl,
} from "../../services/siteApiEndpointService.js";
import {
  buildBatchApiKeyConnectionName,
  parseBatchApiKeys,
} from "../../services/apiKeyBatch.js";
import { createManualAccount } from "../../services/manualAccountCreationService.js";
import { recordAccountsCatalogMutation } from '../../services/accountRuntimeIdentityMutationService.js';
import {
  buildPricedModelRows,
  resolveAccountPricingToken,
} from "../../services/accountModelCostSummaryService.js";
import { saveManualModelsForAccount } from "../../services/manualModelAvailabilityService.js";
import { buildTransientPlatformCredentialContext } from '../../services/adapterCredentialContextService.js';

type AccountWithSiteRow = {
  accounts: typeof schema.accounts.$inferSelect;
  sites: typeof schema.sites.$inferSelect;
};

type AccountHealthRefreshResult = {
  accountId: number;
  username: string | null;
  siteName: string;
  status: "success" | "failed" | "skipped";
  state: RuntimeHealthState;
  message: string;
};

type VerifyFailureReason =
  | "needs-user-id"
  | "invalid-user-id"
  | "shield-blocked"
  | null;

const limitAccountLogin = createRateLimitGuard({
  bucket: "accounts-login",
  max: 5,
  windowMs: 60_000,
});

const limitAccountVerifyToken = createRateLimitGuard({
  bucket: "accounts-verify-token",
  max: 5,
  windowMs: 60_000,
});

function parseBooleanFlag(raw?: string): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function supportsRequestedCredentialMode(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  credentialMode: AccountCredentialMode,
): boolean {
  return credentialMode === "session"
    ? adapter.credentialCapabilities.session
    : adapter.credentialCapabilities.apiKey;
}

function unsupportedCredentialModeMessage(
  credentialMode: AccountCredentialMode,
): string {
  return credentialMode === "session"
    ? "此站点仅支持 API Key，请在「API Key 管理」中添加。"
    : "此站点不支持 API Key 连接。";
}

function requiresExplicitSessionCredentialKind(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
): boolean {
  return (adapter.credentialCapabilities?.sessionCredentialOptions?.length || 0) > 1;
}

function hasExplicitSessionCredentialKind(value: unknown): boolean {
  return value === 'session_cookie' || value === 'access_token';
}

function supportsSessionCredentialKind(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (!hasExplicitSessionCredentialKind(value)) return false;
  if (value === 'session_cookie') {
    return adapter.credentialCapabilities.sessionCredentialOptions.some(
      (option) => option.kind === 'session_cookie',
    );
  }
  return adapter.credentialCapabilities.sessionCredentialOptions.some(
    (option) => option.kind === 'access_token',
  );
}

function buildCapabilitiesForAccount(
  account: typeof schema.accounts.$inferSelect,
): AccountCapabilities {
  return buildAccountCapabilities(account);
}

function normalizeBatchIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => Number.parseInt(String(item), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function normalizePinnedFlag(input: unknown): boolean | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

function normalizeSortOrder(input: unknown): number | null {
  if (input === undefined || input === null || input === "") return null;
  const parsed = Number.parseInt(String(input), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

async function getNextAccountSortOrder(): Promise<number> {
  const rows = await db
    .select({ sortOrder: schema.accounts.sortOrder })
    .from(schema.accounts)
    .all();
  const max = rows.reduce(
    (currentMax, row) => Math.max(currentMax, row.sortOrder || 0),
    -1,
  );
  return max + 1;
}

type LoginFailureInfo = {
  message: string;
  shieldBlocked: boolean;
};

const ACCOUNT_HEALTH_REFRESH_TIMEOUT_MS = 10_000;
const ACCOUNT_VERIFY_TIMEOUT_MS = 10_000;
const ACCOUNT_VERIFY_DIAG_TIMEOUT_MS = 2_500;

function normalizeLoginFailure(
  message: string | null | undefined,
): LoginFailureInfo {
  const raw = (message || "").trim();
  const lowered = raw.toLowerCase();
  const looksLikeHtmlJsonParseError =
    lowered.includes("unexpected token") &&
    lowered.includes("not valid json") &&
    (lowered.includes("<html") || lowered.includes("<script"));
  const looksLikeShieldChallenge =
    lowered.includes("acw_sc__v2") ||
    lowered.includes("var arg1") ||
    lowered.includes("captcha") ||
    lowered.includes("challenge") ||
    lowered.includes("cloudflare tunnel error");

  if (looksLikeHtmlJsonParseError || looksLikeShieldChallenge) {
    return {
      shieldBlocked: true,
      message:
        "This site is shielded by anti-bot challenge. Account/password login is blocked. Create an API key on the target site and import that key.",
    };
  }

  return {
    shieldBlocked: false,
    message: raw || "login failed",
  };
}

function summarizeAccountHealthRefresh(results: AccountHealthRefreshResult[]) {
  return {
    total: results.length,
    healthy: results.filter((item) => item.state === "healthy").length,
    unhealthy: results.filter((item) => item.state === "unhealthy").length,
    degraded: results.filter((item) => item.state === "degraded").length,
    disabled: results.filter((item) => item.state === "disabled").length,
    unknown: results.filter((item) => item.state === "unknown").length,
    success: results.filter((item) => item.status === "success").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  };
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isVerificationTimeoutError(error: unknown): boolean {
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name || "")
      : "";
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : String(error || "");
  const lowered = `${name} ${message}`.toLowerCase();
  return (
    lowered.includes("timeout") ||
    lowered.includes("timed out") ||
    lowered.includes("abort")
  );
}

function buildAccountVerifyTimeoutMessage(): string {
  return `Token verification timed out (${Math.max(1, Math.round(ACCOUNT_VERIFY_TIMEOUT_MS / 1000))}s)`;
}

function resolveUserIdFailureReason(
  message: string,
  hasProvidedUserId: boolean,
): VerifyFailureReason {
  const lowered = String(message || "")
    .trim()
    .toLowerCase();
  if (!lowered) return null;

  if (
    lowered.includes("mismatch") ||
    lowered.includes("not match") ||
    lowered.includes("invalid user id") ||
    lowered.includes("wrong user id")
  ) {
    return "invalid-user-id";
  }

  if (
    lowered.includes("missing new-api-user") ||
    lowered.includes("new-api-user required") ||
    lowered.includes("requires user id") ||
    lowered.includes("missing user id")
  ) {
    return "needs-user-id";
  }

  if (lowered.includes("new-api-user") || lowered.includes("user id")) {
    return hasProvidedUserId ? "invalid-user-id" : "needs-user-id";
  }

  return null;
}

async function refreshRuntimeHealthForRow(
  row: AccountWithSiteRow,
): Promise<AccountHealthRefreshResult> {
  const accountId = row.accounts.id;
  const username = row.accounts.username;
  const siteName = row.sites.name;
  const capabilities = buildCapabilitiesForAccount(row.accounts);

  if (
    (row.accounts.status || "active") === "disabled" ||
    (row.sites.status || "active") === "disabled"
  ) {
    setAccountRuntimeHealth(accountId, {
      state: "disabled",
      reason: "账号或站点已禁用",
      source: "health-refresh",
    });
    return {
      accountId,
      username,
      siteName,
      status: "skipped",
      state: "disabled",
      message: "账号或站点已禁用",
    };
  }

  if (capabilities.proxyOnly) {
    return {
      accountId,
      username,
      siteName,
      status: "skipped",
      state: "unknown",
      message: "仅代理账号不支持会话健康检查",
    };
  }

  try {
    await withTimeout(
      () => refreshBalance(accountId),
      ACCOUNT_HEALTH_REFRESH_TIMEOUT_MS,
      `站点健康检查超时（${Math.max(1, Math.round(ACCOUNT_HEALTH_REFRESH_TIMEOUT_MS / 1000))}s）`,
    );
    const refreshedAccount = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .get();
    const runtimeHealth = buildRuntimeHealthForAccount({
      accountStatus: refreshedAccount?.status || row.accounts.status,
      siteStatus: row.sites.status,
      extraConfig: refreshedAccount?.extraConfig ?? row.accounts.extraConfig,
      credentialMode: refreshedAccount?.credentialMode ?? row.accounts.credentialMode,
      oauthProvider: refreshedAccount?.oauthProvider ?? row.accounts.oauthProvider,
      sessionCapable: capabilities.canRefreshBalance,
    });

    return {
      accountId,
      username,
      siteName,
      status: runtimeHealth.state === "unhealthy" ? "failed" : "success",
      state: runtimeHealth.state,
      message: runtimeHealth.reason,
    };
  } catch (error: any) {
    const message = String(error?.message || "健康检查失败");
    setAccountRuntimeHealth(accountId, {
      state: "unhealthy",
      reason: message,
      source: "health-refresh",
    });
    return {
      accountId,
      username,
      siteName,
      status: "failed",
      state: "unhealthy",
      message,
    };
  }
}

async function executeRefreshAccountRuntimeHealth(accountId?: number) {
  const rows = await db
    .select()
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .all();

  const targetRows = Number.isFinite(accountId as number)
    ? rows.filter((row) => row.accounts.id === accountId)
    : rows;

  const results: AccountHealthRefreshResult[] = [];
  for (const row of targetRows) {
    results.push(await refreshRuntimeHealthForRow(row));
  }

  return {
    summary: summarizeAccountHealthRefresh(results),
    results,
  };
}

export async function accountsRoutes(app: FastifyInstance) {
  // List all accounts (with site info)
  app.get<{ Querystring: { refresh?: string } }>(
    "/api/accounts",
    async (request, reply) => {
      const snapshot = await getAccountsSnapshot({
        forceRefresh: parseBooleanFlag(request.query.refresh),
      });
      reply.header("x-accounts-snapshot-cache", snapshot.cacheStatus);
      return {
        generatedAt: snapshot.generatedAt,
        accounts: snapshot.payload.accounts,
        sites: snapshot.payload.sites,
      };
    },
  );

  // Login to a site and auto-create account
  app.post<{ Body: unknown }>(
    "/api/accounts/login",
    { preHandler: [limitAccountLogin] },
    async (request, reply) => {
      const parsedBody = parseAccountLoginPayload(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ success: false, message: parsedBody.error });
      }

      const { siteId, username, password } = parsedBody.data;

      // Get site info
      const site = await db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .get();
      if (!site) return { success: false, message: "site not found" };

      // Get platform adapter
      const adapter = getAdapter(site.platform);
      if (!adapter)
        return { success: false, message: `不支持的平台: ${site.platform}` };
      if (!supportsRequestedCredentialMode(adapter, 'session')) {
        return reply.code(400).send({
          success: false,
          message: unsupportedCredentialModeMessage('session'),
        });
      }

      // Password login is a Session-only lifecycle. Never let it repurpose an
      // API Key or OAuth connection that happens to use the same username.
      const existing = await db
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.siteId, siteId),
            eq(schema.accounts.username, username),
          ),
        )
        .get();
      if (existing && resolveStoredAccountCredentialMode(existing) !== 'session') {
        return reply.code(409).send({
          success: false,
          message: '已有同名的非 Session 账号，不能通过密码登录覆盖其连接凭据。',
        });
      }

      // Login to the target site
      const loginResult = await adapter.login(site.url, username, password);
      if (!loginResult.success || !loginResult.accessToken) {
        const normalizedFailure = normalizeLoginFailure(loginResult.message);
        return {
          success: false,
          shieldBlocked: normalizedFailure.shieldBlocked,
          message: normalizedFailure.message,
        };
      }

      const guessedPlatformUserId = guessPlatformUserIdFromUsername(username);

      // Auto-fetch API token(s)
      let apiToken: string | null = null;
      let apiTokens: Array<{
        name?: string | null;
        key?: string | null;
        enabled?: boolean | null;
      }> = [];
      try {
        apiToken = await adapter.getApiToken(buildTransientPlatformCredentialContext({
          endpoint: { baseUrl: site.url },
          siteId: site.id,
          mode: 'session',
          credential: loginResult.accessToken,
          credentialKind: loginResult.credentialKind || 'access_token',
          accountExtraConfig: guessedPlatformUserId ? JSON.stringify({ platformUserId: guessedPlatformUserId }) : null,
        }));
      } catch {}
      try {
        apiTokens = await adapter.getApiTokens(buildTransientPlatformCredentialContext({
          endpoint: { baseUrl: site.url },
          siteId: site.id,
          mode: 'session',
          credential: loginResult.accessToken,
          credentialKind: loginResult.credentialKind || 'access_token',
          accountExtraConfig: guessedPlatformUserId ? JSON.stringify({ platformUserId: guessedPlatformUserId }) : null,
        }));
      } catch {}

      const preferredApiToken =
        apiTokens.find((token) => token.enabled !== false && token.key)?.key ||
        apiToken ||
        null;
      const extraConfigPatch: Record<string, unknown> = {
        autoRelogin: {
          username,
          passwordCipher: encryptAccountPassword(password),
          updatedAt: new Date().toISOString(),
        },
      };
      if (guessedPlatformUserId) {
        extraConfigPatch.platformUserId = guessedPlatformUserId;
      }
      const extraConfig = mergeAccountExtraConfig(
        existing?.extraConfig,
        extraConfigPatch,
      );

      // Create or update account
      let accountId = existing?.id;
      if (existing) {
        await db
          .update(schema.accounts)
          .set({
            credential: loginResult.accessToken,
            credentialMode: 'session',
            credentialKind: loginResult.credentialKind || 'access_token',
            checkinEnabled: true,
            status: "active",
            extraConfig,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.accounts.id, existing.id))
          .run();
      } else {
        const created = await insertAndGetById<
          typeof schema.accounts.$inferSelect
        >({
          table: schema.accounts,
          idColumn: schema.accounts.id,
          values: {
            siteId,
            username,
            credential: loginResult.accessToken,
            credentialMode: 'session',
            credentialKind: loginResult.credentialKind || 'access_token',
            checkinEnabled: true,
            extraConfig,
            isPinned: false,
            sortOrder: await getNextAccountSortOrder(),
          },
          insertErrorMessage: "account create failed",
          loadErrorMessage: "account create failed",
        });
        accountId = created.id;
      }

      const result = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId!))
        .get();
      if (!result) {
        return { success: false, message: "account create failed" };
      }

      await recordAccountsCatalogMutation();

      await convergeAccountMutation({
        accountId: result.id,
        preferredApiToken,
        defaultTokenSource: "sync",
        upstreamTokens: apiTokens,
        refreshBalance: true,
        refreshModels: true,
        rebuildRoutes: true,
        continueOnError: true,
      });

      const account = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, result.id))
        .get();
      return {
        success: true,
        account,
        apiTokenFound: !!preferredApiToken,
        tokenCount: apiTokens.length,
        reusedAccount: !!existing,
      };
    },
  );

  // Verify credentials against a site.
  app.post<{ Body: unknown }>(
    "/api/accounts/verify-token",
    { preHandler: [limitAccountVerifyToken] },
    async (request, reply) => {
      const parsedBody = parseAccountVerifyTokenPayload(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ success: false, message: parsedBody.error });
      }

      const { siteId, platformUserId } = parsedBody.data;
      const credentialKind = parsedBody.data.credentialKind;
      const accessToken = (parsedBody.data.credential || "").trim();
      const site = await db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .get();
      if (!site) return { success: false, message: "site not found" };

      if (!accessToken) {
        return {
          success: false,
          message: "连接凭据不能为空",
        };
      }

      const adapter = getAdapter(site.platform);
      if (!adapter)
        return { success: false, message: `不支持的平台: ${site.platform}` };
      if (!supportsRequestedCredentialMode(adapter, 'session')) {
        return {
          success: false,
          message: unsupportedCredentialModeMessage('session'),
        };
      }
      if (
        requiresExplicitSessionCredentialKind(adapter)
        && !hasExplicitSessionCredentialKind(parsedBody.data.credentialKind)
      ) {
        return {
          success: false,
          message: '请选择连接凭据类型：Session Cookie 或 Access Token。',
        };
      }
      if (
        !supportsSessionCredentialKind(adapter, parsedBody.data.credentialKind)
      ) {
        return { success: false, message: '此站点不支持所选的连接凭据类型。' };
      }

      const normalizedPlatform = String(
        adapter.platformName || site.platform || "",
      )
        .trim()
        .toLowerCase();
      const parsedPlatformUserId =
        typeof platformUserId === "number" &&
        Number.isFinite(platformUserId) &&
        platformUserId > 0
          ? Math.trunc(platformUserId)
          : undefined;
      const verificationExtraConfig = applyAccountConnectionValues(
        mergeAccountExtraConfig(
          undefined,
          parsedPlatformUserId ? { platformUserId: parsedPlatformUserId } : {},
        ),
        adapter.accountConnectionFields,
        parsedBody.data.connectionValues,
      );
      const hasProvidedUserId = parsedPlatformUserId !== undefined;
      const skipRawShieldDetection =
        normalizedPlatform === "new-api" || normalizedPlatform === "anyrouter";
      const diagnoseVerificationFailure = async (): Promise<VerifyFailureReason> => {
        const parseFailureReason = (
          bodyText: string,
          contentType: string,
        ): VerifyFailureReason => {
          const text = bodyText || "";
          const ct = (contentType || "").toLowerCase();
          if (
            !skipRawShieldDetection &&
            ct.includes("text/html") &&
            /var\s+arg1\s*=|acw_sc__v2|cdn_sec_tc|<script/i.test(text)
          ) {
            return "shield-blocked";
          }

          try {
            const body = JSON.parse(text) as any;
            const message =
              typeof body?.message === "string" ? body.message : "";
            const userIdReason = resolveUserIdFailureReason(
              message,
              hasProvidedUserId,
            );
            if (userIdReason) return userIdReason;
            if (
              !skipRawShieldDetection &&
              /shield|challenge|captcha|acw_sc__v2|arg1/i.test(message)
            ) {
              return "shield-blocked";
            }
          } catch {}

          return null;
        };

        try {
          const { fetch } = await import("undici");
          const candidates = new Set<string>();
          const raw = accessToken.startsWith("Bearer ")
            ? accessToken.slice(7).trim()
            : accessToken;
          if (raw && credentialKind === 'session_cookie') {
            candidates.add(`session=${raw}`);
            candidates.add(`token=${raw}`);
            if (raw.includes("=")) candidates.add(raw);
          }

          const diagnosticUserId = hasProvidedUserId
            ? String(parsedPlatformUserId)
            : "0";
          const headerVariants: Record<string, string>[] = credentialKind === 'session_cookie'
            ? []
            : [{
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "New-Api-User": diagnosticUserId,
              }];

          for (const cookie of candidates) {
            headerVariants.push({
              Cookie: cookie,
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
              ...(hasProvidedUserId
                ? { "New-Api-User": diagnosticUserId }
                : {}),
            });
          }

          const tryBaseUrl = async (
            baseUrl: string,
          ): Promise<VerifyFailureReason> => {
            let sawNetworkError = false;
            let sawResponse = false;
            for (const headers of headerVariants) {
              try {
                const testRes = await fetch(
                  `${baseUrl.replace(/\/+$/, "")}/api/user/self`,
                  withSiteRecordProxyRequestInit(site, {
                    headers,
                    signal: AbortSignal.timeout(ACCOUNT_VERIFY_DIAG_TIMEOUT_MS),
                  }),
                );
                sawResponse = true;
                const bodyText = await testRes.text();
                const contentType = testRes.headers.get("content-type") || "";
                const reason = parseFailureReason(bodyText, contentType);
                if (reason) return reason;
              } catch {
                sawNetworkError = true;
              }
            }
            if (sawNetworkError && !sawResponse) {
              throw new Error(`diagnostic request timed out for ${baseUrl}`);
            }
            return null;
          };

          return await tryBaseUrl(site.url);
        } catch {}

        return null;
      };
      const buildVerificationFailureResponse = (
        failureReason: VerifyFailureReason,
      ) => {
        if (failureReason === "needs-user-id") {
          return {
            success: false,
            needsUserId: true,
            message:
              "This site requires a user ID. Please fill in your site user ID.",
          };
        }

        if (failureReason === "invalid-user-id") {
          return {
            success: false,
            invalidUserId: true,
            message:
              "The provided user ID does not match this token. Please check your site user ID.",
          };
        }

        if (failureReason === "shield-blocked") {
          return {
            success: false,
            shieldBlocked: true,
            message:
              "This site is shielded by anti-bot challenge. Create an API key on the target site and import that key.",
          };
        }

        return null;
      };

      if (
        !hasProvidedUserId &&
        (normalizedPlatform === "new-api" || normalizedPlatform === "anyrouter")
      ) {
        const preflightReason = await diagnoseVerificationFailure();
        if (preflightReason === "needs-user-id") {
          return buildVerificationFailureResponse(preflightReason);
        }
      }

      let result: any;
      try {
        result = await withTimeout(
          () =>
            adapter.verifyToken(buildTransientPlatformCredentialContext({
              endpoint: { baseUrl: site.url },
              siteId: site.id,
              mode: 'session',
              credential: accessToken,
              credentialKind: credentialKind || 'access_token',
              accountExtraConfig: verificationExtraConfig,
            })),
          ACCOUNT_VERIFY_TIMEOUT_MS,
          `Token verification timed out (${Math.max(1, Math.round(ACCOUNT_VERIFY_TIMEOUT_MS / 1000))}s)`,
        );
      } catch (err: any) {
        if (isVerificationTimeoutError(err)) {
          const failure = buildVerificationFailureResponse(
            await diagnoseVerificationFailure(),
          );
          if (failure) return failure;
        }
        return {
          success: false,
          message: appendSessionTokenRebindHint(
            err?.message || "Token 验证失败",
          ),
        };
      }

      if (result.tokenType === "session") {
        return {
          success: true,
          tokenType: "session",
          userInfo: result.userInfo,
          balance: result.balance,
          discoveredModelTokenCount: result.discoveredModelToken ? 1 : 0,
        };
      }

      if (result.tokenType === "apikey") {
        return {
          success: false,
          message: "当前凭据是模型调用 Key，请在「API Key 管理」中添加。",
        };
      }

      // Try to explain unknown failures: missing user id vs anti-bot challenge page.
      const detectVerifyFailureReason =
        async (): Promise<VerifyFailureReason> => {
          const parseFailureReason = (
            bodyText: string,
            contentType: string,
          ): VerifyFailureReason => {
            const text = bodyText || "";
            const ct = (contentType || "").toLowerCase();
            if (
              !skipRawShieldDetection &&
              ct.includes("text/html") &&
              /var\s+arg1\s*=|acw_sc__v2|cdn_sec_tc|<script/i.test(text)
            ) {
              return "shield-blocked";
            }

            try {
              const body = JSON.parse(text) as any;
              const message =
                typeof body?.message === "string" ? body.message : "";
              const userIdReason = resolveUserIdFailureReason(
                message,
                hasProvidedUserId,
              );
              if (userIdReason) return userIdReason;
              if (
                !skipRawShieldDetection &&
                /shield|challenge|captcha|acw_sc__v2|arg1/i.test(message)
              ) {
                return "shield-blocked";
              }
            } catch {}

            return null;
          };

          try {
            const { fetch } = await import("undici");
            const candidates = new Set<string>();
            const raw = accessToken.startsWith("Bearer ")
              ? accessToken.slice(7).trim()
              : accessToken;
            if (raw) {
              if (raw.includes("=")) candidates.add(raw);
              candidates.add(`session=${raw}`);
              candidates.add(`token=${raw}`);
            }

            const diagnosticUserId = hasProvidedUserId
              ? String(parsedPlatformUserId)
              : "0";
            const headerVariants: Record<string, string>[] = [
              {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "New-Api-User": diagnosticUserId,
              },
            ];

            for (const cookie of candidates) {
              headerVariants.push({
                Cookie: cookie,
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                ...(hasProvidedUserId
                  ? { "New-Api-User": diagnosticUserId }
                  : {}),
              });
            }

            for (const headers of headerVariants) {
              try {
                const testRes = await fetch(
                  `${site.url}/api/user/self`,
                  withSiteRecordProxyRequestInit(site, {
                    headers,
                    signal: AbortSignal.timeout(ACCOUNT_VERIFY_DIAG_TIMEOUT_MS),
                  }),
                );
                const bodyText = await testRes.text();
                const contentType = testRes.headers.get("content-type") || "";
                const reason = parseFailureReason(bodyText, contentType);
                if (reason) return reason;
              } catch {}
            }
          } catch {}

          return null;
        };

      const failureReason = await detectVerifyFailureReason();
      if (failureReason === "needs-user-id") {
        return {
          success: false,
          needsUserId: true,
          message:
            "This site requires a user ID. Please fill in your site user ID.",
        };
      }

      if (failureReason === "invalid-user-id") {
        return {
          success: false,
          invalidUserId: true,
          message:
            "The provided user ID does not match this token. Please check your site user ID.",
        };
      }

      if (failureReason === "shield-blocked") {
        return {
          success: false,
          shieldBlocked: true,
          message:
            "This site is shielded by anti-bot challenge. Create an API key on the target site and import that key.",
        };
      }

      return {
        success: false,
        message: "连接凭据验证失败",
      };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/accounts/:id/rebind-session",
    async (request, reply) => {
      const parsedBody = parseAccountRebindSessionPayload(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ success: false, message: parsedBody.error });
      }

      const accountId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return reply
          .code(400)
          .send({ success: false, message: "账号 ID 无效" });
      }

      const nextAccessToken = (parsedBody.data.credential || "").trim();
      if (!nextAccessToken) {
        return reply
          .code(400)
          .send({ success: false, message: "请提供新的 Session Token" });
      }

      const row = await db
        .select()
        .from(schema.accounts)
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(eq(schema.accounts.id, accountId))
        .get();
      if (!row) {
        return reply.code(404).send({ success: false, message: "账号不存在" });
      }

      const account = row.accounts;
      const site = row.sites;
      if (resolveStoredAccountCredentialMode(account) !== 'session') {
        return reply.code(400).send({
          success: false,
          message: '仅 Session 账号可以重新绑定连接凭据。',
        });
      }
      const adapter = getAdapter(site.platform);
      if (!adapter) {
        return reply
          .code(400)
          .send({
            success: false,
            message: `platform not supported: ${site.platform}`,
          });
      }
      if (!supportsRequestedCredentialMode(adapter, "session")) {
        return reply.code(400).send({
          success: false,
          message: unsupportedCredentialModeMessage("session"),
        });
      }
      if (
        requiresExplicitSessionCredentialKind(adapter)
        && !hasExplicitSessionCredentialKind(parsedBody.data.credentialKind)
      ) {
        return reply.code(400).send({
          success: false,
          message: '请选择连接凭据类型：Session Cookie 或 Access Token。',
        });
      }
      if (!supportsSessionCredentialKind(adapter, parsedBody.data.credentialKind)) {
        return reply.code(400).send({
          success: false,
          message: '此站点不支持所选的连接凭据类型。',
        });
      }

      const bodyPlatformUserId = Number.parseInt(
        String(parsedBody.data.platformUserId ?? ""),
        10,
      );
      const candidatePlatformUserId =
        Number.isFinite(bodyPlatformUserId) && bodyPlatformUserId > 0
          ? bodyPlatformUserId
          : resolvePlatformUserId(account.extraConfig, account.username);
      const verificationExtraConfig = applyAccountConnectionValues(
        mergeAccountExtraConfig(
          account.extraConfig,
          candidatePlatformUserId ? { platformUserId: candidatePlatformUserId } : {},
        ),
        adapter.accountConnectionFields,
        parsedBody.data.connectionValues,
      );

      let verifyResult: any;
      try {
        verifyResult = await withAccountProxyOverride(
          getProxyUrlFromExtraConfig(account.extraConfig),
          () =>
            adapter.verifyToken(buildTransientPlatformCredentialContext({
              endpoint: { baseUrl: site.url },
              siteId: site.id,
              mode: 'session',
              credential: nextAccessToken,
              credentialKind: parsedBody.data.credentialKind || 'access_token',
              accountExtraConfig: verificationExtraConfig,
            })),
        );
      } catch (err: any) {
        return reply.code(400).send({
          success: false,
          message: appendSessionTokenRebindHint(
            err?.message || "Token 验证失败",
          ),
        });
      }

      if (verifyResult?.tokenType !== "session") {
        return reply.code(400).send({
          success: false,
          message: "新的 Token 验证失败：请提供可用的 Session Token",
        });
      }

      const nextUsernameRaw =
        typeof verifyResult?.userInfo?.username === "string"
          ? verifyResult.userInfo.username.trim()
          : "";
      const nextUsername = nextUsernameRaw || account.username || "";
      const inferredPlatformUserId = resolvePlatformUserId(
        account.extraConfig,
        nextUsername,
      );
      const resolvedPlatformUserId =
        Number.isFinite(bodyPlatformUserId) && bodyPlatformUserId > 0
          ? bodyPlatformUserId
          : inferredPlatformUserId;
      const discoveredModelToken =
        typeof verifyResult?.discoveredModelToken === "string" && verifyResult.discoveredModelToken.trim().length > 0
          ? verifyResult.discoveredModelToken.trim()
          : null;

      const updates: Record<string, unknown> = {
        credential: nextAccessToken,
        credentialMode: 'session',
        credentialKind: parsedBody.data.credentialKind || account.credentialKind || 'access_token',
        status: "active",
        updatedAt: new Date().toISOString(),
      };
      if (nextUsername) {
        updates.username = nextUsername;
      }
      const extraConfigPatch: Record<string, unknown> = {};
      if (resolvedPlatformUserId) {
        extraConfigPatch.platformUserId = resolvedPlatformUserId;
      }
      updates.extraConfig = mergeAccountExtraConfig(
        verificationExtraConfig,
        extraConfigPatch,
      );

      await db
        .update(schema.accounts)
        .set(updates)
        .where(eq(schema.accounts.id, accountId))
        .run();
      await recordAccountsCatalogMutation();

      await convergeAccountMutation({
        accountId,
        preferredApiToken: discoveredModelToken,
        defaultTokenSource: "sync",
        refreshBalance: true,
        refreshModels: true,
        rebuildRoutes: true,
        continueOnError: true,
      });

      const latest = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId))
        .get();
      return {
        success: true,
        account: latest,
        tokenType: "session",
        credentialMode: "session",
        capabilities: latest
          ? buildCapabilitiesForAccount(latest)
          : buildAccountCapabilities({
            credentialMode: "session",
            credential: "managed-session",
          }),
        discoveredModelTokenCount: discoveredModelToken ? 1 : 0,
      };
    },
  );

  // Add an account (manual credential input)
  app.post<{ Body: unknown }>("/api/accounts", async (request, reply) => {
    const parsedBody = parseAccountCreatePayload(request.body);
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send({ success: false, message: parsedBody.error });
    }

    const body = parsedBody.data;
    const site = await db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.id, body.siteId))
      .get();
    if (!site) {
      return reply
        .code(400)
        .send({ success: false, message: "site not found" });
    }

    const adapter = getAdapter(site.platform);
    if (!adapter) {
      return reply
        .code(400)
        .send({
          success: false,
          message: `platform not supported: ${site.platform}`,
        });
    }

    const explicitApiKeys = parseBatchApiKeys(body.apiKey);
    const connectionCredential = String(body.credential || '').trim();
    if (explicitApiKeys.length > 0 && connectionCredential) {
      return reply.code(400).send({
        success: false,
        message: '请只填写连接凭据或模型调用 Key 其中一种。',
      });
    }
    const credentialMode: AccountCredentialMode = explicitApiKeys.length > 0
      ? 'apikey'
      : 'session';
    if (!supportsRequestedCredentialMode(adapter, credentialMode)) {
      return reply.code(400).send({
        success: false,
        message: unsupportedCredentialModeMessage(credentialMode),
      });
    }
    if (
      credentialMode === 'session'
      && requiresExplicitSessionCredentialKind(adapter)
      && !hasExplicitSessionCredentialKind(body.credentialKind)
    ) {
      return reply.code(400).send({
        success: false,
        message: '请选择连接凭据类型：Session Cookie 或 Access Token。',
      });
    }
    if (credentialMode === 'session' && !supportsSessionCredentialKind(adapter, body.credentialKind)) {
      return reply.code(400).send({
        success: false,
        message: '此站点不支持所选的连接凭据类型。',
      });
    }
    const requestedTokens =
      explicitApiKeys.length > 0
        ? explicitApiKeys
        : (connectionCredential ? [connectionCredential] : []);
    if (requestedTokens.length === 0) {
      return reply.code(400).send({
          success: false,
          message: credentialMode === "apikey"
            ? "请填写 API Key"
            : "请填写连接凭据",
      });
    }

    if (credentialMode === "apikey" && requestedTokens.length > 1) {
      const items: Array<Record<string, unknown>> = [];
      let createdCount = 0;

      for (const [index, token] of requestedTokens.entries()) {
        try {
          const created = await createManualAccount({
            body,
            site,
            adapter,
            credentialMode,
            rawAccessToken: token,
            usernameOverride:
              buildBatchApiKeyConnectionName(
                body.username,
                index,
                requestedTokens.length,
              ) || undefined,
          });
          createdCount += 1;
          items.push({
            index,
            status: "created",
            id: created.account.id,
            username: created.account.username || null,
            queued: created.queued === true,
            message: created.message || null,
            modelCount: created.modelCount || 0,
          });
        } catch (error: any) {
          items.push({
            index,
            status: "failed",
            message: error?.message || "创建失败",
            requiresVerification: error?.requiresVerification === true,
          });
        }
      }

      if (createdCount === 0) {
        return reply.code(400).send({
          success: false,
          batch: true,
          totalCount: requestedTokens.length,
          createdCount: 0,
          failedCount: requestedTokens.length,
          message: `批量添加失败（0/${requestedTokens.length}）`,
          items,
        });
      }

      return {
        success: true,
        batch: true,
        totalCount: requestedTokens.length,
        createdCount,
        failedCount: requestedTokens.length - createdCount,
        message: `批量添加完成：成功 ${createdCount}，失败 ${requestedTokens.length - createdCount}`,
        items,
      };
    }

    try {
      const created = await createManualAccount({
        body,
        site,
        adapter,
        credentialMode,
        rawAccessToken: requestedTokens[0]!,
      });
      return {
        ...created.account,
        tokenType: created.tokenType,
        credentialMode,
        capabilities: buildCapabilitiesForAccount(created.account),
        modelCount: created.modelCount,
        discoveredModelTokenCount: created.discoveredModelTokenCount,
        usernameDetected: created.usernameDetected,
        queued: created.queued,
        jobId: created.jobId,
        message: created.message,
      };
    } catch (err: any) {
      return reply.code(400).send({
        success: false,
        requiresVerification: err?.requiresVerification === true,
        message:
          credentialMode !== "apikey"
            ? appendSessionTokenRebindHint(err?.message || "Token 验证失败")
            : err?.message || "API Key 验证失败",
      });
    }
  });

  // Update an account
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/accounts/:id",
    async (request, reply) => {
      const id = parseInt(request.params.id);
      const parsedBody = parseAccountUpdatePayload(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ message: parsedBody.error });
      }
      const body = parsedBody.data as Record<string, unknown>;
      if (body.credentialMode !== undefined) {
        return reply.code(400).send({
          message: "账号凭据模式不可切换，请在对应连接管理页面重新创建。",
        });
      }
      const row = await db
        .select()
        .from(schema.accounts)
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(eq(schema.accounts.id, id))
        .get();
      if (!row) {
        return reply.code(404).send({ message: "account not found" });
      }
      const account = row.accounts;
      const site = row.sites;
      const storedCredentialMode = resolveStoredAccountCredentialMode(account);
      const editAdapter = getAdapter(site.platform);
      if (!editAdapter) {
        return reply.code(400).send({
          message: `不支持的平台: ${site.platform}`,
        });
      }
      if (
        storedCredentialMode === 'session'
        && requiresExplicitSessionCredentialKind(editAdapter)
        && (body.credential !== undefined || body.credentialKind !== undefined)
        && !hasExplicitSessionCredentialKind(body.credentialKind ?? account.credentialKind)
      ) {
        return reply.code(400).send({
          message: '请选择连接凭据类型：Session Cookie 或 Access Token。',
        });
      }
      if (
        storedCredentialMode === 'session'
        && !supportsSessionCredentialKind(editAdapter, body.credentialKind ?? account.credentialKind)
      ) {
        return reply.code(400).send({
          message: '此站点不支持所选的连接凭据类型。',
        });
      }
      if (storedCredentialMode === 'apikey' && Object.prototype.hasOwnProperty.call(body, 'credential')) {
        return reply.code(400).send({
          message: 'API Key 连接的模型 Key 必须通过账号令牌管理更新。',
        });
      }
      if (
        storedCredentialMode === 'oauth'
        && (Object.prototype.hasOwnProperty.call(body, 'credential') || Object.prototype.hasOwnProperty.call(body, 'credentialKind'))
      ) {
        return reply.code(400).send({
          message: 'OAuth 账号的连接凭据只能由授权流程更新。',
        });
      }
      const updates: any = {};
      for (const key of [
        "username",
        "credential",
        "credentialKind",
        "status",
        "checkinEnabled",
        "extraConfig",
      ]) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      if (body.connectionValues !== undefined) {
        updates.extraConfig = applyAccountConnectionValues(
          account.extraConfig,
          getAdapter(site.platform)?.accountConnectionFields || [],
          body.connectionValues,
        );
      }


      if (body.isPinned !== undefined) {
        const normalizedPinned = normalizePinnedFlag(body.isPinned);
        if (normalizedPinned === null) {
          return reply
            .code(400)
            .send({ message: "Invalid isPinned value. Expected boolean." });
        }
        updates.isPinned = normalizedPinned;
      }

      if (body.sortOrder !== undefined) {
        const normalizedSortOrder = normalizeSortOrder(body.sortOrder);
        if (normalizedSortOrder === null) {
          return reply
            .code(400)
            .send({
              message:
                "Invalid sortOrder value. Expected non-negative integer.",
            });
        }
        updates.sortOrder = normalizedSortOrder;
      }

      if (Object.prototype.hasOwnProperty.call(body, "proxyUrl")) {
        const baseExtraConfig =
          typeof updates.extraConfig === "string"
            ? updates.extraConfig
            : account.extraConfig;
        const {
          present,
          valid,
          proxyUrl: normalizedProxy,
        } = parseSiteProxyUrlInput(body.proxyUrl);
        if (present && !valid) {
          return reply.code(400).send({ message: "Invalid proxy URL format" });
        }
        updates.extraConfig = mergeAccountExtraConfig(baseExtraConfig, {
          proxyUrl: normalizedProxy ?? undefined,
        });
      }

      const nextCredentialMode = storedCredentialMode === 'oauth' ? 'session' : storedCredentialMode;
      const credentialsChanged = Object.prototype.hasOwnProperty.call(body, 'credential');
      const nextStatus =
        typeof updates.status === "string" && updates.status.trim()
          ? updates.status.trim()
          : account.status || "active";
      const needsModelRefresh =
        credentialsChanged ||
        Object.prototype.hasOwnProperty.call(body, "extraConfig") ||
        Object.prototype.hasOwnProperty.call(body, "proxyUrl") ||
        Object.prototype.hasOwnProperty.call(body, "connectionValues");
      const isExpiredApiKeyAccount =
        account.status === "expired" &&
        nextCredentialMode === "apikey" &&
        nextStatus !== "disabled";
      const shouldAttemptExpiredApiKeyRecovery =
        isExpiredApiKeyAccount && needsModelRefresh;

      const { account: updatedAccount } = await applyAccountUpdateWorkflow({
        accountId: id,
        updates,
        preferredApiToken: null,
        refreshModels: needsModelRefresh,
        preserveExpiredStatus: isExpiredApiKeyAccount,
        allowInactiveModelRefresh: shouldAttemptExpiredApiKeyRecovery,
        reactivateAfterSuccessfulModelRefresh:
          shouldAttemptExpiredApiKeyRecovery,
        continueOnError: true,
      });

      return updatedAccount;
    },
  );

  // Delete an account
  app.delete<{ Params: { id: string } }>(
    "/api/accounts/:id",
    async (request) => {
      const id = parseInt(request.params.id);
      await retireAccountFromRouting(id, 'account-retirement');
      return { success: true };
    },
  );

  app.post<{ Body: unknown }>("/api/accounts/batch", async (request, reply) => {
    const parsedBody = parseAccountBatchPayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ message: parsedBody.error });
    }

    const ids = normalizeBatchIds(parsedBody.data.ids);
    const action = String(parsedBody.data.action || "").trim();
    if (ids.length === 0) {
      return reply.code(400).send({ message: "ids is required" });
    }
    if (!["enable", "disable", "delete", "refreshBalance"].includes(action)) {
      return reply.code(400).send({ message: "Invalid action" });
    }

    const successIds: number[] = [];
    const failedItems: Array<{ id: number; message: string }> = [];
    let shouldRebuildRoutes = false;
    let shouldInvalidateRuntimeIdentities = false;

    for (const id of ids) {
      try {
        if (action === "refreshBalance") {
          const result = await refreshBalance(id);
          if (!result) {
            failedItems.push({
              id,
              message: "Account not found or balance refresh unsupported",
            });
            continue;
          }
          successIds.push(id);
          continue;
        }

        const existing = await db
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.id, id))
          .get();
        if (!existing) {
          failedItems.push({ id, message: "Account not found" });
          continue;
        }

        if (action === "delete") {
          await retireAccountFromRouting(id, 'account-retirement');
        } else {
          const nextStatus = action === "enable" ? "active" : "disabled";
          await db
            .update(schema.accounts)
            .set({ status: nextStatus, updatedAt: new Date().toISOString() })
            .where(eq(schema.accounts.id, id))
            .run();
          shouldInvalidateRuntimeIdentities = true;
          shouldRebuildRoutes = true;
        }

        successIds.push(id);
      } catch (error: any) {
        failedItems.push({
          id,
          message: error?.message || "Batch operation failed",
        });
      }
    }

    if (shouldInvalidateRuntimeIdentities) {
      invalidateRouteGraphReadCaches('account-mutated');
      await recordAccountsCatalogMutation();
    }
    if (shouldRebuildRoutes) {
      await rebuildRoutesBestEffort();
    }

    return {
      success: true,
      successIds,
      failedItems,
    };
  });

  app.post<{ Body: unknown }>(
    "/api/accounts/health/refresh",
    async (request, reply) => {
      const parsedBody = parseAccountHealthRefreshPayload(request.body);
      if (!parsedBody.success) {
        return reply
          .code(400)
          .send({ success: false, message: parsedBody.error });
      }

      const accountId = parsedBody.data.accountId;
      const wait = parsedBody.data.wait === true;

      if (wait) {
        const result = await executeRefreshAccountRuntimeHealth(accountId);
        if (accountId && result.summary.total === 0) {
          return reply
            .code(404)
            .send({ success: false, message: "账号不存在" });
        }
        return {
          success: true,
          ...result,
        };
      }

      const taskTitle = accountId
        ? `刷新账号运行健康状态 #${accountId}`
        : "刷新全部账号运行健康状态";
      const dedupeKey = accountId
        ? `refresh-account-runtime-health-${accountId}`
        : "refresh-all-account-runtime-health";

      const { task, reused } = startBackgroundTask(
        {
          type: "status",
          title: taskTitle,
          dedupeKey,
          notifyOnFailure: true,
          successMessage: (currentTask) => {
            const summary = (
              currentTask.result as {
                summary?: ReturnType<typeof summarizeAccountHealthRefresh>;
              }
            )?.summary;
            if (!summary) return `${taskTitle}已完成`;
            return `${taskTitle}完成：健康 ${summary.healthy}，异常 ${summary.unhealthy}，禁用 ${summary.disabled}`;
          },
          failureMessage: (currentTask) =>
            `${taskTitle}失败：${currentTask.error || "unknown error"}`,
        },
        async () => executeRefreshAccountRuntimeHealth(accountId),
      );

      return reply.code(202).send({
        success: true,
        queued: true,
        reused,
        jobId: task.id,
        status: task.status,
        message: reused
          ? "账号运行健康状态刷新进行中，请稍后查看账号列表"
          : "已开始刷新账号运行健康状态，请稍后查看账号列表",
      });
    },
  );

  // Refresh balance for an account
  app.post<{ Params: { id: string } }>(
    "/api/accounts/:id/balance",
    async (request, reply) => {
      const id = parseInt(request.params.id);
      try {
        const result = await refreshBalance(id);
        if (!result) {
          reply.code(404);
          return { message: "account not found or platform not supported" };
        }
        return result;
      } catch (err: any) {
        reply.code(400);
        return { message: err?.message || "failed to fetch balance" };
      }
    },
  );

  // Get model list for an account (available models + disabled status at site level)
  app.get<{ Params: { id: string } }>(
    "/api/accounts/:id/models",
    async (request, reply) => {
      const accountId = parseInt(request.params.id, 10);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return reply.code(400).send({ message: "账号 ID 无效" });
      }

      const account = await db
        .select()
        .from(schema.accounts)
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(eq(schema.accounts.id, accountId))
        .get();

      if (!account) {
        return reply.code(404).send({ message: "账号不存在" });
      }

      const siteId = account.accounts.siteId;

      // Get available models for this account
      const modelRows = await db
        .select({
          modelName: schema.modelAvailability.modelName,
          available: schema.modelAvailability.available,
          latencyMs: schema.modelAvailability.latencyMs,
          isManual: schema.modelAvailability.isManual,
        })
        .from(schema.modelAvailability)
        .where(eq(schema.modelAvailability.accountId, accountId))
        .all();

      // Get disabled models for this site
      const disabledRows = await db
        .select({
          modelName: schema.siteDisabledModels.modelName,
        })
        .from(schema.siteDisabledModels)
        .where(eq(schema.siteDisabledModels.siteId, siteId))
        .all();

      const disabledSet = new Set(disabledRows.map((r) => r.modelName));
      const tokenRows = await db
        .select({
          id: schema.accountTokens.id,
          name: schema.accountTokens.name,
          tokenGroup: schema.accountTokens.tokenGroup,
          enabled: schema.accountTokens.enabled,
          isDefault: schema.accountTokens.isDefault,
          valueStatus: schema.accountTokens.valueStatus,
          source: schema.accountTokens.source,
        })
        .from(schema.accountTokens)
        .where(eq(schema.accountTokens.accountId, accountId))
        .all();

      const tokenAvailabilityRows = tokenRows.length > 0
        ? await db
          .select({
            tokenId: schema.tokenModelAvailability.tokenId,
            modelName: schema.tokenModelAvailability.modelName,
            available: schema.tokenModelAvailability.available,
            isManual: schema.tokenModelAvailability.isManual,
            latencyMs: schema.tokenModelAvailability.latencyMs,
            checkedAt: schema.tokenModelAvailability.checkedAt,
          })
          .from(schema.tokenModelAvailability)
          .innerJoin(schema.accountTokens, eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id))
          .where(eq(schema.accountTokens.accountId, accountId))
          .all()
        : [];
      const tokenDisabledRows = tokenRows.length > 0
        ? await db.select({ tokenId: schema.tokenDisabledModels.tokenId, modelName: schema.tokenDisabledModels.modelName })
          .from(schema.tokenDisabledModels)
          .innerJoin(schema.accountTokens, eq(schema.tokenDisabledModels.tokenId, schema.accountTokens.id))
          .where(eq(schema.accountTokens.accountId, accountId))
          .all()
        : [];
      const disabledByToken = new Map<number, Set<string>>();
      for (const row of tokenDisabledRows) {
        const current = disabledByToken.get(row.tokenId) || new Set<string>();
        current.add(row.modelName);
        disabledByToken.set(row.tokenId, current);
      }

      const baseModels = modelRows
        .filter((r) => r.available)
        .map((r) => ({
          name: r.modelName,
          latencyMs: r.latencyMs,
          disabled: disabledSet.has(r.modelName),
          isManual: !!r.isManual,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const models = await buildPricedModelRows<(typeof baseModels)[number]>({
        models: baseModels,
        subject: {
          siteId,
          accountId,
          token: resolveAccountPricingToken(tokenRows),
        },
      });

      const tokenModels = await Promise.all(tokenRows.map(async (token) => {
        const rows = tokenAvailabilityRows
          .filter((row) => row.tokenId === token.id)
          .map((row) => ({
            name: row.modelName,
            available: row.available === true,
            latencyMs: row.latencyMs,
            checkedAt: row.checkedAt,
            siteDisabled: disabledSet.has(row.modelName),
            tokenDisabled: !!disabledByToken.get(token.id)?.has(row.modelName),
            disabled: disabledSet.has(row.modelName) || !!disabledByToken.get(token.id)?.has(row.modelName),
            isManual: !!row.isManual,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        return {
          tokenId: token.id,
          observed: rows.length > 0,
          models: await buildPricedModelRows<(typeof rows)[number]>({
            models: rows,
            subject: { siteId, accountId, token },
          }),
        };
      }));

      return {
        siteId,
        siteName: account.sites.name,
        accountTokens: tokenRows.map((token) => ({
          id: token.id,
          name: token.name,
          tokenGroup: token.tokenGroup,
          enabled: !!token.enabled,
          isDefault: !!token.isDefault,
          valueStatus: token.valueStatus,
          source: token.source,
        })),
        models,
        tokenModels,
        totalCount: models.length,
        disabledCount: models.filter((m) => m.disabled).length,
      };
    },
  );

  // Add models manually to an account
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/accounts/:id/models/manual",
    async (request, reply) => {
      const parsedBody = parseAccountManualModelsPayload(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ message: parsedBody.error });
      }

      const accountId = parseInt(request.params.id, 10);
      if (!Number.isFinite(accountId) || accountId <= 0) {
        return reply.code(400).send({ message: "账号 ID 无效" });
      }

      const { models } = parsedBody.data;
      if (!Array.isArray(models) || models.length === 0) {
        return reply.code(400).send({ message: "模型列表不能为空" });
      }

      const normalizedModels = Array.from(
        new Set(
          models.map((m) => String(m).trim()).filter((m) => m.length > 0),
        ),
      );
      if (normalizedModels.length === 0) {
        return reply.code(400).send({ message: "模型列表不能为空" });
      }

      const account = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId))
        .get();

      if (!account) {
        return reply.code(404).send({ message: "账号不存在" });
      }

      try {
        const saved = await saveManualModelsForAccount(account, normalizedModels);
        await rebuildRoutesBestEffort();

        return { success: true, ...saved };
      } catch (err: any) {
        return reply
          .code(500)
          .send({ success: false, message: err?.message || "保存失败" });
      }
    },
  );
}
