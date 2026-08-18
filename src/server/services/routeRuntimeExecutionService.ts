import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isUsableAccountToken } from './accountTokenService.js';
import { requiresManagedAccountTokens } from './accountExtraConfig.js';
import type { DownstreamRoutingPolicy } from './downstreamPolicyTypes.js';
import {
  buildCompiledRuntimeProjection,
  type CompiledRuntimeProjection,
} from './compiledRuntimeProjectionService.js';
import { getCompiledRouterPlanById, type CompiledRouterBundle } from '../../shared/compiledRuntime.js';
import type { ResolvedRouteAffinityPolicy } from '../../shared/routeAffinity.js';
import type { CompiledRuntimePostBuildFilters } from './compiledRuntimePostBuildFilters.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import { compiledRuntimeRequestUsageConstraints } from './compiledRuntimeUsageForecastService.js';
import {
  evaluateCompiledRuntimeArtifact,
  matchCompiledRouterPlanId,
  type RouteRuntimeFailureOverlay,
  type RouteRuntimeSelectionConstraint,
  type RouteRuntimeSelection,
} from './routeRuntimeEvaluatorService.js';
import {
  getActiveRouteRuntimeArtifact,
  type ActiveRouteRuntimeArtifact,
} from './routeRuntimeArtifactService.js';
import {
  invalidateRouteRuntimeExecutionTargetState,
  loadRouteRuntimeExecutionTargetContext,
  loadRouteRuntimeExecutionTargetContexts,
  type RouteRuntimeExecutionTargetContext,
} from './routeRuntimeExecutionIdentityService.js';
import { overlayCompiledRuntimeRoutingSignals } from './compiledRuntimeRoutingSignalOverlayService.js';
import { getOauthInfoFromAccount } from './oauth/oauthAccount.js';
import type { RouteExecutionScope } from './routeExecutionScopeTypes.js';
import {
  commitRouteRuntimeSelectorStateProposal,
  createRouteRuntimeSelectorStateProposal,
  getRouteRuntimeSelectorStateStore,
  type RouteRuntimeSelectorStateProposal,
} from './routeRuntimeSelectorStateService.js';
import { matchesModelPattern } from '../../shared/modelPatternMatcher.js';
import {
  DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY,
  normalizeRouteFailureBackoffOverride,
  normalizeRouteFailureBackoffPolicy,
  type RouteFailureBackoffOverride,
} from '../../shared/routeFailureBackoff.js';
import type {
  RouteRuntimeCredentialSnapshot,
  RouteRuntimeDecisionSnapshot,
  RouteRuntimeSnapshotBody,
} from '../../shared/routeRuntimeSnapshot.js';
import { proxyTargetCoordinator, type ProxyAffinityBinding, type ProxyAffinitySuccess } from './proxyTargetCoordinator.js';

export const ROUTE_FAILURE_BACKOFF_SETTING_KEY = 'route_failure_backoff_default_v1';

type AccountRow = typeof schema.accounts.$inferSelect;
type SiteRow = typeof schema.sites.$inferSelect;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;

export type RouteRuntimeSelectionSnapshot = {
  requestedModel: string;
  currentModel: string;
  runtimeBundleHash?: string | null;
  runtimeArtifactId?: string | null;
  matchedEntryNodeId?: string | null;
  selectedEntryNodeId?: string | null;
  terminalNodeId: string | null;
  terminalKind: 'endpoint' | 'synthetic_response';
  trace: RouteRuntimeSelection['trace'];
  compiledPlanSnapshot?: RouteRuntimeSelection['compiledPlanSnapshot'];
  compiledProgramSnapshot?: RouteRuntimeSelection['compiledProgramSnapshot'];
  selectionSnapshots?: RouteRuntimeSelection['selectionSnapshots'];
  fallbackStageSnapshots?: RouteRuntimeSelection['fallbackStageSnapshots'];
  selectedExecutionAttempt?: RouteRuntimeSelection['selectedExecutionAttempt'] | null;
  routeEndpointCompatibilityPolicy?: RouteRuntimeSelection['routeEndpointCompatibilityPolicy'] | null;
  selectedAlternativeId?: string | null;
  postBuildFilters: CompiledRuntimePostBuildFilters;
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  } | null;
  metadata?: {
    graph: Record<string, unknown> | null;
    plan: Record<string, unknown> | null;
    selection: Record<string, unknown> | null;
    endpoint: Record<string, unknown> | null;
    executionAttempt: Record<string, unknown> | null;
  };
};

export type RouteRuntimeEvaluation = {
  routeBundle: CompiledRouterBundle | null;
  selection: RouteRuntimeSelectionSnapshot | null;
};

export type RouteRuntimeProjectionResult = RouteRuntimeEvaluation & {
  runtime: CompiledRuntimeProjection | null;
};

export type RouteRuntimeExecutionAttempt = {
  executionAttemptId: string;
  target: {
    id: number;
    tokenId?: number | null;
    sourceModel?: string | null;
    enabled?: boolean | null;
    weight?: number | null;
    successCount?: number | null;
    failCount?: number | null;
    totalLatencyMs?: number | null;
    latencySampleCount?: number | null;
    lastUsedAt?: string | null;
    lastSelectedAt?: string | null;
    lastFailAt?: string | null;
    consecutiveFailCount?: number | null;
    cooldownLevel?: number | null;
    cooldownUntil?: string | null;
  };
  account: AccountRow;
  site: SiteRow;
  token: AccountTokenRow | null;
  tokenValue: string;
  tokenName: string;
  actualModel: string;
  routeExecutionScope?: RouteExecutionScope | null;
  routeEntrypointId: string;
  runtimeEndpointId: string;
  runtimeArtifactId: string;
  executionTargetId: number;
  postBuildFilters?: CompiledRuntimePostBuildFilters | null;
  routeRuntimeSnapshot: RouteRuntimeSnapshotBody;
  routeEndpointCompatibilityPolicy?: RouteRuntimeSelection['routeEndpointCompatibilityPolicy'] | null;
  executionAttemptCompatibilityPolicy?: RouteRuntimeSelection['routeEndpointCompatibilityPolicy'] | null;
  failureBackoff?: RouteFailureBackoffOverride | null;
  affinity?: ProxyAffinitySuccess | null;
};

export type RouteRuntimeSyntheticDecision = {
  kind: 'synthetic_response';
  statusCode: 429 | 503;
  message: string;
  terminalNodeId: string | null;
  runtimeTrace: RouteRuntimeSelectionSnapshot['trace'];
};

export type RouteRuntimeUnavailableDecision = {
  kind: 'unavailable';
  routeEntrypointId: string | null;
  runtimeArtifactId: string | null;
  routeRuntimeSnapshot: RouteRuntimeSnapshotBody;
};

export type RouteRuntimeDecision =
  | { kind: 'execution_attempt'; attempt: RouteRuntimeExecutionAttempt }
  | RouteRuntimeSyntheticDecision
  | RouteRuntimeUnavailableDecision;

type RouteRuntimeRejectedAttempt = NonNullable<RouteRuntimeDecisionSnapshot['unavailable']>['rejectedAttempts'][number];

type ExecutionTargetIdentity = Omit<RouteRuntimeExecutionTargetContext, 'account'> & {
  account: AccountRow;
};

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function executionTargetIdFromSelection(selection: RouteRuntimeSelection | null | undefined): number | null {
  return asPositiveInteger(selection?.selectedExecutionAttempt?.transportBinding?.executionTargetId);
}

function selectedEndpointId(selection: RouteRuntimeSelection | null | undefined): string | null {
  return asText(selection?.selectedExecutionAttempt?.endpointId) || null;
}

function requireRouteRuntimeIdentity(selection: RouteRuntimeSelection): {
  routeEntrypointId: string;
  runtimeEndpointId: string;
  runtimeArtifactId: string;
} {
  const routeEntrypointId = asText(selection.matchedEntryNodeId);
  const runtimeEndpointId = selectedEndpointId(selection);
  const runtimeArtifactId = asText(selection.runtimeArtifactId);
  if (!routeEntrypointId || !runtimeEndpointId || !runtimeArtifactId) {
    throw new Error('Compiled runtime selection is missing artifact, entry, or endpoint identity');
  }
  return {
    routeEntrypointId,
    runtimeEndpointId,
    runtimeArtifactId,
  };
}

function toRouteRuntimeSelectionSnapshot(
  selection: RouteRuntimeSelection | null | undefined,
): RouteRuntimeSelectionSnapshot | null {
  if (!selection) return null;
  return {
    requestedModel: selection.requestedModel,
    currentModel: selection.currentModel,
    runtimeBundleHash: selection.runtimeBundleHash ?? null,
    runtimeArtifactId: selection.runtimeArtifactId ?? null,
    matchedEntryNodeId: selection.matchedEntryNodeId || null,
    selectedEntryNodeId: selection.selectedEntryNodeId || null,
    terminalNodeId: selection.terminalNodeId,
    terminalKind: selection.terminalKind,
    trace: selection.trace,
    compiledPlanSnapshot: selection.compiledPlanSnapshot,
    compiledProgramSnapshot: selection.compiledProgramSnapshot,
    selectionSnapshots: selection.selectionSnapshots,
    fallbackStageSnapshots: selection.fallbackStageSnapshots,
    selectedExecutionAttempt: selection.selectedExecutionAttempt || null,
    routeEndpointCompatibilityPolicy: selection.routeEndpointCompatibilityPolicy || null,
    selectedAlternativeId: selection.selectedAlternativeId || null,
    postBuildFilters: selection.postBuildFilters,
    syntheticResponse: selection.syntheticResponse || null,
    metadata: selection.metadata
      ? {
          graph: isRecord(selection.metadata.graph) ? selection.metadata.graph : null,
          plan: isRecord(selection.metadata.plan) ? selection.metadata.plan : null,
          selection: isRecord(selection.metadata.selection) ? selection.metadata.selection : null,
          endpoint: isRecord(selection.metadata.endpoint) ? selection.metadata.endpoint : null,
          executionAttempt: isRecord(selection.metadata.executionAttempt)
            ? selection.metadata.executionAttempt
            : null,
        }
      : undefined,
  };
}

function evaluateRouteRuntimeVersion(input: {
  version: ActiveRouteRuntimeArtifact;
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  failureOverlay?: RouteRuntimeFailureOverlay | null;
  selectionConstraint?: RouteRuntimeSelectionConstraint | null;
  selectorStateStore?: Record<string, unknown>;
}): RouteRuntimeSelection | null {
  return evaluateCompiledRuntimeArtifact({
    graph: input.version.compiledGraph as never,
    requestedModel: input.requestedModel,
    request: input.request,
    stateStore: input.selectorStateStore || {},
    failureOverlay: input.failureOverlay,
    selectionConstraint: input.selectionConstraint,
  });
}

function withRuntimeArtifactIdentity(
  artifact: ActiveRouteRuntimeArtifact,
  selection: RouteRuntimeSelection | null,
): RouteRuntimeSelection | null {
  if (!selection) return null;
  return {
    ...selection,
    runtimeBundleHash: asText(artifact.bundleHash)
      || asText(artifact.compiledGraph.compiledRouterBundle?.hash)
      || asText(artifact.compiledGraph.hash)
      || null,
    runtimeArtifactId: artifact.artifactId,
    metadata: {
      graph: isRecord(selection.metadata?.graph) ? selection.metadata.graph : null,
      plan: isRecord(selection.metadata?.plan) ? selection.metadata.plan : null,
      selection: isRecord(selection.metadata?.selection) ? selection.metadata.selection : null,
      endpoint: isRecord(selection.metadata?.endpoint) ? selection.metadata.endpoint : null,
      executionAttempt: isRecord(selection.metadata?.executionAttempt) ? selection.metadata.executionAttempt : null,
    },
  };
}

async function evaluateRouteRuntimeWithArtifact(
  requestedModel: string,
  options: {
    request?: CompiledRouteRuntimeRequest | null;
    failureOverlay?: RouteRuntimeFailureOverlay | null;
    selectionConstraint?: RouteRuntimeSelectionConstraint | null;
    useProductionSelectorState?: boolean;
  } = {},
): Promise<{
  version: ActiveRouteRuntimeArtifact | null;
  selection: RouteRuntimeSelection | null;
}> {
  const active = await prepareRequestScopedRouteRuntimeArtifact(requestedModel, options.request);
  if (!active || (active.compiledGraph.compiledRouterBundle?.plans?.length ?? 0) <= 0) {
    return { version: active, selection: null };
  }
  const selectorStateStore = options.useProductionSelectorState
    ? getRouteRuntimeSelectorStateStore(active.artifactId)
    : {};

  const selection = evaluateRouteRuntimeVersion({
    version: active,
    requestedModel,
    request: options.request,
    failureOverlay: options.failureOverlay,
    selectionConstraint: options.selectionConstraint,
    selectorStateStore,
  });
  return {
    version: active,
    selection: withRuntimeArtifactIdentity(active, selection),
  };
}

async function prepareRequestScopedRouteRuntimeArtifact(
  requestedModel: string,
  request?: CompiledRouteRuntimeRequest | null,
): Promise<ActiveRouteRuntimeArtifact | null> {
  const active = await getActiveRouteRuntimeArtifact();
  if (!active || !request) return active;
  const bundle = active.compiledGraph.compiledRouterBundle;
  const matchedPlanId = bundle ? matchCompiledRouterPlanId(bundle, requestedModel) : null;
  if (!matchedPlanId) return active;
  return {
    ...active,
    compiledGraph: await overlayCompiledRuntimeRoutingSignals(active.compiledGraph, {
      request,
      planIds: [matchedPlanId],
    }),
  };
}

function evaluateRouteRuntimeDecisionProposal(input: {
  version: ActiveRouteRuntimeArtifact;
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  failureOverlay?: RouteRuntimeFailureOverlay | null;
  selectionConstraint?: RouteRuntimeSelectionConstraint | null;
}): { selection: RouteRuntimeSelection | null; proposal: RouteRuntimeSelectorStateProposal } {
  const proposal = createRouteRuntimeSelectorStateProposal(input.version.artifactId);
  const selection = evaluateRouteRuntimeVersion({
    ...input,
    selectorStateStore: proposal.proposed,
  });
  return { selection: withRuntimeArtifactIdentity(input.version, selection), proposal };
}

export async function evaluateRouteRuntimeForModel(
  requestedModel: string,
  options: {
    request?: CompiledRouteRuntimeRequest | null;
    failureOverlay?: RouteRuntimeFailureOverlay | null;
    selectionConstraint?: RouteRuntimeSelectionConstraint | null;
  } = {},
): Promise<RouteRuntimeEvaluation> {
  const { version, selection } = await evaluateRouteRuntimeWithArtifact(requestedModel, options);
  return {
    routeBundle: version?.compiledGraph.compiledRouterBundle || null,
    selection: toRouteRuntimeSelectionSnapshot(selection),
  };
}

export async function buildRouteRuntimeProjection(input: {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  forcedExecutionAttemptId?: string | null;
}): Promise<RouteRuntimeProjectionResult> {
  const forcedExecutionAttemptId = asText(input.forcedExecutionAttemptId);
  const { version, selection: rawSelection } = await evaluateRouteRuntimeWithArtifact(input.requestedModel, {
    request: input.request,
    selectionConstraint: !forcedExecutionAttemptId
      ? undefined
      : {
        forcedExecutionAttemptId,
      },
  });
  const routeBundle = version?.compiledGraph.compiledRouterBundle || null;
  const selection = toRouteRuntimeSelectionSnapshot(rawSelection);
  const runtime = routeBundle && rawSelection
    ? buildCompiledRuntimeProjection({
        bundle: routeBundle,
        selection: rawSelection,
        requestedModel: input.requestedModel,
        request: input.request,
        forcedExecutionAttemptId: input.forcedExecutionAttemptId ?? null,
      })
    : null;
  return {
    routeBundle,
    selection,
    runtime,
  };
}

export async function resolveRouteRuntimeSyntheticResponse(input: {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
}): Promise<{
  statusCode: 429 | 503;
  message: string;
  terminalNodeId: string | null;
  terminalKind: 'synthetic_response';
  runtimeTrace: RouteRuntimeSelectionSnapshot['trace'];
} | null> {
  const { selection } = await evaluateRouteRuntimeWithArtifact(input.requestedModel, {
    request: input.request,
  });
  if (selection?.terminalKind !== 'synthetic_response') return null;
  return {
    statusCode: selection.syntheticResponse?.statusCode || 503,
    message: selection.syntheticResponse?.message || 'No route is available.',
    terminalNodeId: selection.terminalNodeId,
    terminalKind: 'synthetic_response',
    runtimeTrace: selection.trace,
  };
}

function sourceModelForAttempt(selection: RouteRuntimeSelection): string {
  if (selection.selectedExecutionAttempt?.modelSource === 'request') {
    const requestModel = asText(selection.currentModel);
    if (!requestModel) {
      throw new Error('Compiled runtime request-model execution attempt is missing request model');
    }
    return requestModel;
  }
  const fixedModel = asText(selection.selectedExecutionAttempt?.model);
  if (!fixedModel) {
    throw new Error('Compiled runtime fixed execution attempt is missing upstream model');
  }
  return fixedModel;
}

function isSiteDisabled(status?: string | null): boolean {
  const normalized = asText(status).toLowerCase();
  return normalized === 'disabled' || normalized === 'inactive' || normalized === 'error';
}

function cooldownActive(cooldownUntil: string | null | undefined, nowMs = Date.now()): boolean {
  if (!cooldownUntil) return false;
  const parsed = Date.parse(cooldownUntil);
  return Number.isFinite(parsed) && parsed > nowMs;
}

function credentialExcludedByDownstreamPolicy(
  identity: ExecutionTargetIdentity,
  downstreamPolicy?: DownstreamRoutingPolicy | null,
): boolean {
  if (!downstreamPolicy) return false;
  if (downstreamPolicy.excludedSiteIds?.includes(identity.site.id)) return true;
  for (const ref of downstreamPolicy.excludedCredentialRefs || []) {
    if (ref.kind === 'account_token') {
      if (
        identity.token?.id === ref.tokenId
        && identity.account.id === ref.accountId
        && identity.site.id === ref.siteId
      ) {
        return true;
      }
      continue;
    }
    if (
      identity.token == null
      && identity.account.id === ref.accountId
      && identity.site.id === ref.siteId
    ) {
      return true;
    }
  }
  return false;
}

function resolveTokenValue(identity: ExecutionTargetIdentity): string | null {
  if (identity.token) {
    // A stale manually authored artifact must not turn an OAuth connection
    // into a token-key route. OAuth credentials are direct account routes.
    if (!requiresManagedAccountTokens(identity.account)) return null;
    if (!isUsableAccountToken(identity.token)) return null;
    return asText(identity.token.token) || null;
  }
  if (getOauthInfoFromAccount(identity.account)) {
    return asText(identity.account.credential) || null;
  }
  return null;
}

async function ensureExecutionTargetState(executionTargetId: number): Promise<void> {
  const existing = await db.select({ id: schema.runtimeExecutionTargetState.id })
    .from(schema.runtimeExecutionTargetState)
    .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
    .get();
  if (existing) return;
  await db.insert(schema.runtimeExecutionTargetState).values({ executionTargetId: executionTargetId }).run();
  invalidateRouteRuntimeExecutionTargetState(executionTargetId);
}

async function loadExecutionTargetIdentity(executionTargetId: number): Promise<ExecutionTargetIdentity | null> {
  const context = await loadRouteRuntimeExecutionTargetContext(executionTargetId);
  return context?.account ? { ...context, account: context.account } : null;
}

function executionTargetUnavailableReason(
  identity: ExecutionTargetIdentity,
  downstreamPolicy?: DownstreamRoutingPolicy | null,
  nowMs = Date.now(),
): RouteRuntimeRejectedAttempt['reason'] | null {
  if (identity.executionTarget.enabled === false) return 'execution_target_disabled';
  if (identity.account.status !== 'active') return 'account_inactive';
  if (isSiteDisabled(identity.site.status)) return 'site_disabled';
  if (cooldownActive(identity.state?.cooldownUntil, nowMs)) return 'cooldown';
  if (credentialExcludedByDownstreamPolicy(identity, downstreamPolicy)) return 'downstream_policy_excluded';
  if (!resolveTokenValue(identity)) return 'missing_token';
  return null;
}

function selectionReferencesAllowedRuntimeScope(
  selection: RouteRuntimeSelection,
  allowedPlanIds: string[],
): boolean {
  const planId = asText(selection.compiledPlanSnapshot?.planId);
  if (!planId || allowedPlanIds.length === 0) return false;
  return allowedPlanIds.includes(planId);
}

function selectedRouteAllowedByDownstreamPolicy(
  selection: RouteRuntimeSelection,
  requestedModel: string,
  downstreamPolicy?: DownstreamRoutingPolicy | null,
): boolean {
  if (!downstreamPolicy) return true;
  const supportedPatterns = Array.isArray(downstreamPolicy.supportedModels)
    ? downstreamPolicy.supportedModels
    : [];
  const matchedSupportedPattern = supportedPatterns.some((pattern) => (
    matchesModelPattern(requestedModel, pattern)
  ));
  if (matchedSupportedPattern) return true;
  const allowedPlanIds = Array.isArray(downstreamPolicy.allowedPlanIds) ? downstreamPolicy.allowedPlanIds : [];
  if (allowedPlanIds.length === 0) return downstreamPolicy.denyAllWhenEmpty === true ? false : true;
  return selectionReferencesAllowedRuntimeScope(selection, allowedPlanIds);
}

function buildRouteExecutionScope(input: {
  requestedModel: string;
  selection: RouteRuntimeSelection;
  failureOverlay: RouteRuntimeFailureOverlay;
  executionAttemptId: string;
}): RouteExecutionScope {
  return {
    runtimeArtifactId: asText(input.selection.runtimeArtifactId),
    requestedModel: input.requestedModel,
    matchedEntryNodeId: input.selection.matchedEntryNodeId || null,
    failureOverlay: {
      disabledExecutionAttemptIds: input.failureOverlay.disabledExecutionAttemptIds,
      disabledExecutionTargetIds: input.failureOverlay.disabledExecutionTargetIds,
    },
  };
}

function routeRuntimeCredentialSnapshot(
  identity: ExecutionTargetIdentity,
): RouteRuntimeCredentialSnapshot {
  return {
    site: {
      id: identity.site.id,
      name: asText(identity.site.name) || null,
      url: asText(identity.site.url) || null,
      platform: asText(identity.site.platform) || null,
    },
    account: {
      id: identity.account.id,
      username: asText(identity.account.username) || null,
      status: asText(identity.account.status) || null,
    },
    token: identity.token
      ? {
          id: identity.token.id,
          name: asText(identity.token.name) || null,
          tokenGroup: asText(identity.token.tokenGroup) || null,
          enabled: identity.token.enabled == null ? null : Boolean(identity.token.enabled),
          valueStatus: asText(identity.token.valueStatus) || null,
          source: asText(identity.token.source) || null,
        }
      : null,
  };
}

async function routeRuntimeSnapshot(input: {
  selection: RouteRuntimeSelection;
  identity?: ExecutionTargetIdentity | null;
  executionAttemptId?: string | null;
  executionTargetId?: number | null;
  actualModel?: string | null;
  failureOverlay: RouteRuntimeFailureOverlay;
  request?: CompiledRouteRuntimeRequest | null;
  unavailable?: NonNullable<RouteRuntimeDecisionSnapshot['unavailable']> | null;
}): Promise<RouteRuntimeSnapshotBody> {
  const selectedAttempt = input.selection.selectedExecutionAttempt;
  const plan = input.selection.compiledPlanSnapshot;
  const identity = input.identity ?? null;
  const state = identity?.state ?? null;
  const credential = identity ? routeRuntimeCredentialSnapshot(identity) : null;
  const unavailable = input.unavailable ?? null;
  const requestUsage = compiledRuntimeRequestUsageConstraints(input.request);
  const candidateExecutionTargetIds = Array.from(new Set(
    (input.selection.selectionSnapshots || [])
      .flatMap((selector) => selector.candidates)
      .flatMap((candidate) => candidate.executionTargetIds),
  ));
  const candidateContextByExecutionTargetId = await loadRouteRuntimeExecutionTargetContexts(
    candidateExecutionTargetIds,
  );
  const executionAttemptByTargetId = new Map<
    number,
    NonNullable<NonNullable<RouteRuntimeSelection['compiledProgramSnapshot']>['executionAlternatives'][number]['executionAttempt']>
  >();
  for (const alternative of input.selection.compiledProgramSnapshot?.executionAlternatives || []) {
    const attempt = alternative.executionAttempt;
    const executionTargetId = asPositiveInteger(attempt?.transportBinding?.executionTargetId);
    if (attempt && executionTargetId) executionAttemptByTargetId.set(executionTargetId, attempt);
  }
  return {
    compiledRuntime: {
      runtimeArtifactId: input.selection.runtimeArtifactId ?? null,
      bundleHash: input.selection.runtimeBundleHash ?? null,
      program: input.selection.compiledProgramSnapshot ?? null,
    },
    match: {
      requestedModel: asText(input.selection.requestedModel) || null,
      actualModel: input.actualModel ?? null,
      planId: asText(plan?.planId) || null,
      entryId: asText(input.selection.matchedEntryNodeId) || null,
      publicModelName: asText(plan?.publicModelName) || null,
      terminalKind: input.selection.terminalKind,
    },
    metadata: {
      graph: isRecord(input.selection.metadata?.graph) ? input.selection.metadata.graph : null,
      plan: isRecord(input.selection.metadata?.plan) ? input.selection.metadata.plan : null,
      selection: isRecord(input.selection.metadata?.selection)
        ? input.selection.metadata.selection
        : null,
      endpoint: isRecord(input.selection.metadata?.endpoint) ? input.selection.metadata.endpoint : null,
      executionAttempt: isRecord(input.selection.metadata?.executionAttempt)
        ? input.selection.metadata.executionAttempt
        : null,
    },
    decision: {
      selectedAlternativeId: asText(input.selection.selectedAlternativeId) || null,
      selectors: (input.selection.selectionSnapshots || []).map((selector) => ({
        selectorId: selector.selectorId,
        nodeId: selector.nodeId,
        mode: selector.mode,
        policySource: selector.resolvedPolicy.source,
        policyId: selector.resolvedPolicy.id,
        policyKind: selector.resolvedPolicy.kind,
        selectionMode: selector.resolvedPolicy.selectionMode,
        selectedChoiceId: selector.selectedChoiceId,
        candidates: selector.candidates.map((candidate) => ({
          choiceId: candidate.alternativeId,
          endpointId: candidate.endpointId || null,
          executionTargetIds: candidate.executionTargetIds,
          targets: candidate.executionTargetIds.map((executionTargetId) => {
            const context = candidateContextByExecutionTargetId.get(executionTargetId) || null;
            const attempt = executionAttemptByTargetId.get(executionTargetId) || null;
            return {
              executionTargetId,
              executionAttemptId: asText(attempt?.executionAttemptId) || null,
              upstreamModel: asText(context?.executionTarget.upstreamModelName)
                || asText(attempt?.model)
                || null,
              credential: context?.account
                ? routeRuntimeCredentialSnapshot({ ...context, account: context.account })
                : null,
            };
          }),
          enabled: candidate.enabled,
          eligible: candidate.policyEvaluation.eligible,
          selected: candidate.alternativeId === selector.selectedChoiceId,
          weight: candidate.weight,
          contribution: candidate.policyEvaluation.contribution,
          order: candidate.policyEvaluation.order,
          score: candidate.policyEvaluation.score,
        })),
      })),
      fallbackStages: (input.selection.fallbackStageSnapshots || []).map((stage) => ({
        fallbackId: stage.fallbackId,
        stageId: stage.stageId,
        stageIndex: stage.stageIndex,
        nodeId: stage.nodeId,
      })),
      ...(unavailable ? { unavailable } : {}),
    },
    endpoint: selectedAttempt && !unavailable
      ? {
          endpointId: asText(selectedAttempt.endpointId) || null,
          executionTargetId: input.executionTargetId ?? null,
          compatibilityPolicy: isRecord(input.selection.routeEndpointCompatibilityPolicy)
            ? input.selection.routeEndpointCompatibilityPolicy
            : null,
        }
      : null,
    executionAttempt: selectedAttempt && identity && !unavailable
      ? {
          executionAttemptId: input.executionAttemptId ?? null,
          model: input.actualModel ?? null,
          executionTargetId: input.executionTargetId ?? null,
          accountId: identity.account.id,
          tokenId: identity.token?.id ?? null,
          siteId: identity.site.id,
          credential,
          affinity: null,
        }
      : null,
    requestUsage,
    state: {
      failureOverlay: {
        disabledExecutionAttemptIds: [...(input.failureOverlay.disabledExecutionAttemptIds || [])],
        disabledExecutionTargetIds: [...(input.failureOverlay.disabledExecutionTargetIds || [])],
      },
      executionAttemptState: state
        ? {
            executionTargetId: input.executionTargetId ?? null,
            successCount: state.successCount,
            failCount: state.failCount,
            totalLatencyMs: state.totalLatencyMs,
            latencySampleCount: state.latencySampleCount,
            consecutiveFailCount: state.consecutiveFailCount,
            cooldownLevel: state.cooldownLevel,
            cooldownUntil: state.cooldownUntil,
            lastUsedAt: state.lastUsedAt,
            lastSelectedAt: state.lastSelectedAt,
            lastFailAt: state.lastFailAt,
          }
        : null,
    },
    filters: {
      endpointPreference: input.selection.postBuildFilters.endpointPreference ?? null,
      postBuild: input.selection.postBuildFilters,
    },
    syntheticResponse: input.selection.syntheticResponse
      ? {
          statusCode: input.selection.syntheticResponse.statusCode,
          message: input.selection.syntheticResponse.message,
        }
      : null,
  };
}

async function unavailableRouteRuntimeDecision(input: {
  selection: RouteRuntimeSelection;
  selectorState: RouteRuntimeSelectorStateProposal;
  failureOverlay: RouteRuntimeFailureOverlay;
  rejectedAttempts: RouteRuntimeRejectedAttempt[];
  request?: CompiledRouteRuntimeRequest | null;
}): Promise<RouteRuntimeDecisionProposal> {
  return {
    decision: {
      kind: 'unavailable',
      routeEntrypointId: asText(input.selection.matchedEntryNodeId) || null,
      runtimeArtifactId: asText(input.selection.runtimeArtifactId) || null,
      routeRuntimeSnapshot: await routeRuntimeSnapshot({
        selection: input.selection,
        actualModel: asText(input.selection.upstreamModel) || asText(input.selection.currentModel) || null,
        failureOverlay: input.failureOverlay,
        request: input.request,
        unavailable: {
          reason: 'execution_attempts_exhausted',
          rejectedAttempts: input.rejectedAttempts,
        },
      }),
    },
    selectorState: input.selectorState,
  };
}

function unavailableRouteRuntimeDecisionFromSession(
  session: RouteRuntimeDecisionSession,
  input: Pick<RouteRuntimeDecisionInput, 'disabledExecutionAttemptIds' | 'disabledExecutionTargetIds'>,
): RouteRuntimeUnavailableDecision {
  const artifact = session.artifact;
  const bundle = artifact?.compiledGraph.compiledRouterBundle ?? null;
  const planId = bundle ? matchCompiledRouterPlanId(bundle, session.requestedModel) : null;
  const plan = planId && bundle ? getCompiledRouterPlanById(bundle, planId) : null;
  const reason: NonNullable<RouteRuntimeDecisionSnapshot['unavailable']>['reason'] = !artifact || !bundle
    ? 'no_active_runtime'
    : !plan
      ? 'no_matching_route'
      : 'execution_attempts_exhausted';
  return {
    kind: 'unavailable',
    routeEntrypointId: asText(plan?.entryNodeId) || null,
    runtimeArtifactId: artifact?.artifactId ?? null,
    routeRuntimeSnapshot: {
      compiledRuntime: {
        runtimeArtifactId: artifact?.artifactId ?? null,
        bundleHash: artifact
          ? asText(artifact.bundleHash)
            || asText(bundle?.hash)
            || asText(artifact.compiledGraph.hash)
            || null
          : null,
        program: plan ?? null,
      },
      match: {
        requestedModel: session.requestedModel || null,
        actualModel: null,
        planId: asText(plan?.id) || null,
        entryId: asText(plan?.entryNodeId) || null,
        publicModelName: asText(plan?.publicModelName) || null,
        terminalKind: null,
      },
      metadata: {
        graph: isRecord(bundle?.metadata) ? bundle.metadata : null,
        plan: isRecord(plan?.metadata) ? plan.metadata : null,
        selection: null,
        endpoint: null,
        executionAttempt: null,
      },
      decision: {
        selectedAlternativeId: null,
        selectors: [],
        fallbackStages: [],
        unavailable: {
          reason,
          rejectedAttempts: [],
        },
      },
      endpoint: null,
      executionAttempt: null,
      requestUsage: compiledRuntimeRequestUsageConstraints(session.request),
      state: {
        failureOverlay: {
          disabledExecutionAttemptIds: [...(input.disabledExecutionAttemptIds || [])],
          disabledExecutionTargetIds: [...(input.disabledExecutionTargetIds || [])],
        },
        executionAttemptState: null,
      },
      filters: {
        endpointPreference: null,
        postBuild: null,
      },
      syntheticResponse: null,
    },
  };
}

async function toRouteRuntimeExecutionAttempt(input: {
  selection: RouteRuntimeSelection;
  identity: ExecutionTargetIdentity;
  requestedModel: string;
  failureOverlay: RouteRuntimeFailureOverlay;
  request?: CompiledRouteRuntimeRequest | null;
}): Promise<RouteRuntimeExecutionAttempt> {
  const { selection, identity } = input;
  const executionTargetId = identity.executionTarget.id;
  const executionAttemptId = asText(selection.selectedExecutionAttempt?.executionAttemptId);
  if (!executionAttemptId) throw new Error('Compiled runtime selection is missing executionAttemptId');
  const tokenValue = resolveTokenValue(identity) || '';
  const state = identity.state;
  const actualModel = sourceModelForAttempt(selection);
  const runtimeIdentity = requireRouteRuntimeIdentity(selection);
  const runtimeSnapshotBody = await routeRuntimeSnapshot({
    selection,
    identity,
    executionAttemptId,
    executionTargetId,
    actualModel,
    failureOverlay: input.failureOverlay,
    request: input.request,
  });
  return {
    executionAttemptId,
    target: {
      id: executionTargetId,
      tokenId: identity.token?.id ?? identity.executionTarget.tokenId ?? null,
      sourceModel: actualModel,
      enabled: identity.executionTarget.enabled !== false,
      weight: asPositiveInteger(selection.selectedExecutionAttempt?.weight) ?? 10,
      successCount: state?.successCount ?? null,
      failCount: state?.failCount ?? null,
      totalLatencyMs: state?.totalLatencyMs ?? null,
      latencySampleCount: state?.latencySampleCount ?? null,
      lastUsedAt: state?.lastUsedAt ?? null,
      lastSelectedAt: state?.lastSelectedAt ?? null,
      lastFailAt: state?.lastFailAt ?? null,
      consecutiveFailCount: state?.consecutiveFailCount ?? null,
      cooldownLevel: state?.cooldownLevel ?? null,
      cooldownUntil: state?.cooldownUntil ?? null,
    },
    account: identity.account,
    site: identity.site,
    token: identity.token,
    tokenValue,
    tokenName: identity.token?.name || 'default',
    actualModel,
    routeExecutionScope: buildRouteExecutionScope({
      requestedModel: input.requestedModel,
      selection,
      failureOverlay: input.failureOverlay,
      executionAttemptId,
    }),
    routeEntrypointId: runtimeIdentity.routeEntrypointId,
    runtimeEndpointId: runtimeIdentity.runtimeEndpointId,
    runtimeArtifactId: runtimeIdentity.runtimeArtifactId,
    executionTargetId,
    postBuildFilters: selection.postBuildFilters,
    routeRuntimeSnapshot: runtimeSnapshotBody,
    routeEndpointCompatibilityPolicy: selection.routeEndpointCompatibilityPolicy || null,
    executionAttemptCompatibilityPolicy: selection.selectedExecutionAttempt?.compatibilityPolicy || null,
    failureBackoff: selection.selectedExecutionAttempt?.failureBackoff || null,
  };
}

export type RouteRuntimeDecisionInput = {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  downstreamPolicy?: DownstreamRoutingPolicy | null;
  retryCount?: number;
  stickyExecutionTargetId?: number | null;
  affinityKey?: string | null;
  forcedExecutionAttemptId?: string | null;
  disabledExecutionAttemptIds?: string[];
  disabledExecutionTargetIds?: number[];
};

export type RouteRuntimeDecisionSession = {
  readonly requestedModel: string;
  readonly request: CompiledRouteRuntimeRequest | null;
  readonly downstreamPolicy: DownstreamRoutingPolicy | null;
  readonly forcedExecutionAttemptId: string | null;
  readonly stickyExecutionTargetId: number | null;
  readonly affinity: RouteRuntimeAffinitySession | null;
  readonly artifact: ActiveRouteRuntimeArtifact | null;
};

type RouteRuntimeAffinitySession = {
  key: string;
  entryNodeId: string;
  policy: ResolvedRouteAffinityPolicy;
  targetIds: number[];
  poolIdByTargetId: Map<number, string>;
  targetIdsByPoolId: Map<string, number[]>;
  binding: ProxyAffinityBinding | null;
};

function resolveRouteRuntimeAffinitySession(
  artifact: ActiveRouteRuntimeArtifact | null,
  requestedModel: string,
  affinityKey?: string | null,
): RouteRuntimeAffinitySession | null {
  const key = asText(affinityKey);
  const bundle = artifact?.compiledGraph.compiledRouterBundle;
  if (!key || !bundle) return null;
  const planId = matchCompiledRouterPlanId(bundle, requestedModel);
  const plan = planId ? getCompiledRouterPlanById(bundle, planId) : null;
  if (!plan?.affinity?.policy) return null;
  const targetIds = Array.from(new Set((plan.executionAlternatives || []).flatMap((alternative) => {
    const id = asPositiveInteger(alternative.executionAttempt?.transportBinding?.executionTargetId);
    return id ? [id] : [];
  })));
  const targetIdsByPoolId = new Map<string, number[]>();
  const poolIdByTargetId = new Map<number, string>();
  for (const pool of plan.affinity.pools || []) {
    const ids = Array.from(new Set((pool.executionTargetIds || []).map(asPositiveInteger).filter((id): id is number => id != null)));
    if (!pool.id || ids.length === 0) continue;
    targetIdsByPoolId.set(pool.id, ids);
    for (const id of ids) poolIdByTargetId.set(id, pool.id);
  }
  let binding = proxyTargetCoordinator.getAffinityBinding(key);
  const validBinding = binding?.entryNodeId === plan.entryNodeId && (
    (plan.affinity.policy.kind === 'target'
      && binding.scope === 'target'
      && targetIds.includes(binding.primaryExecutionTargetId))
    || (plan.affinity.policy.kind === 'pool'
      && binding.scope === 'pool'
      && targetIdsByPoolId.has(binding.primaryPoolId))
  );
  if (binding && !validBinding) {
    proxyTargetCoordinator.clearAffinityBinding(key, binding.revision);
    binding = null;
  }
  return {
    key,
    entryNodeId: plan.entryNodeId,
    policy: plan.affinity.policy,
    targetIds,
    poolIdByTargetId,
    targetIdsByPoolId,
    binding,
  };
}

export type RouteRuntimeDecisionProposal = {
  readonly decision: RouteRuntimeDecision;
  readonly selectorState: RouteRuntimeSelectorStateProposal;
};

export async function createRouteRuntimeDecisionSession(
  input: Omit<RouteRuntimeDecisionInput, 'retryCount' | 'disabledExecutionAttemptIds' | 'disabledExecutionTargetIds'>,
): Promise<RouteRuntimeDecisionSession> {
  const requestedModel = asText(input.requestedModel);
  const artifact = await prepareRequestScopedRouteRuntimeArtifact(requestedModel, input.request);
  return Object.freeze({
    requestedModel,
    request: input.request ?? null,
    downstreamPolicy: input.downstreamPolicy ?? null,
    forcedExecutionAttemptId: asText(input.forcedExecutionAttemptId) || null,
    stickyExecutionTargetId: asPositiveInteger(input.stickyExecutionTargetId),
    affinity: resolveRouteRuntimeAffinitySession(artifact, requestedModel, input.affinityKey),
    artifact,
  });
}

async function proposeRouteRuntimeDecision(
  input: RouteRuntimeDecisionInput,
  pinnedArtifact?: ActiveRouteRuntimeArtifact | null,
): Promise<RouteRuntimeDecisionProposal | null> {
  const disabledExecutionAttemptIds = new Set(input.disabledExecutionAttemptIds || []);
  const disabledExecutionTargetIds = new Set(input.disabledExecutionTargetIds || []);
  const version = pinnedArtifact === undefined
    ? await prepareRequestScopedRouteRuntimeArtifact(input.requestedModel, input.request)
    : pinnedArtifact;
  if (!version || (version.compiledGraph.compiledRouterBundle?.plans?.length ?? 0) <= 0) return null;

  const forcedExecutionAttemptId = asText(input.forcedExecutionAttemptId);
  if (forcedExecutionAttemptId) {
    const failureOverlay: RouteRuntimeFailureOverlay = {
      disabledExecutionAttemptIds: Array.from(disabledExecutionAttemptIds),
      disabledExecutionTargetIds: Array.from(disabledExecutionTargetIds),
    };
    const selectionConstraint: RouteRuntimeSelectionConstraint = {
      forcedExecutionAttemptId,
    };
    const { selection, proposal } = evaluateRouteRuntimeDecisionProposal({
      version,
      requestedModel: input.requestedModel,
      request: input.request,
      failureOverlay,
      selectionConstraint,
    });
    if (!selection || selection.terminalKind !== 'endpoint') return null;
    if (selection.selectedExecutionAttempt?.executionAttemptId !== forcedExecutionAttemptId) return null;
    const forcedExecutionTargetId = executionTargetIdFromSelection(selection);
    if (!forcedExecutionTargetId) return null;
    if (!selectedRouteAllowedByDownstreamPolicy(selection, input.requestedModel, input.downstreamPolicy)) {
      return await unavailableRouteRuntimeDecision({
        selection,
        selectorState: proposal,
        failureOverlay: {
          disabledExecutionAttemptIds: [...(failureOverlay.disabledExecutionAttemptIds || []), forcedExecutionAttemptId],
          disabledExecutionTargetIds: [...(failureOverlay.disabledExecutionTargetIds || []), forcedExecutionTargetId],
        },
        rejectedAttempts: [{
          executionAttemptId: forcedExecutionAttemptId,
          executionTargetId: forcedExecutionTargetId,
          reason: 'route_scope_excluded',
        }],
        request: input.request,
      });
    }
    const identity = await loadExecutionTargetIdentity(forcedExecutionTargetId);
    if (!identity) {
      return await unavailableRouteRuntimeDecision({
        selection,
        selectorState: proposal,
        failureOverlay: {
          disabledExecutionAttemptIds: [...(failureOverlay.disabledExecutionAttemptIds || []), forcedExecutionAttemptId],
          disabledExecutionTargetIds: [...(failureOverlay.disabledExecutionTargetIds || []), forcedExecutionTargetId],
        },
        rejectedAttempts: [{
          executionAttemptId: forcedExecutionAttemptId,
          executionTargetId: forcedExecutionTargetId,
          reason: 'identity_missing',
        }],
        request: input.request,
      });
    }
    const unavailableReason = executionTargetUnavailableReason(identity, input.downstreamPolicy);
    if (unavailableReason) {
      return await unavailableRouteRuntimeDecision({
        selection,
        selectorState: proposal,
        failureOverlay: {
          disabledExecutionAttemptIds: [...(failureOverlay.disabledExecutionAttemptIds || []), forcedExecutionAttemptId],
          disabledExecutionTargetIds: [...(failureOverlay.disabledExecutionTargetIds || []), forcedExecutionTargetId],
        },
        rejectedAttempts: [{
          executionAttemptId: forcedExecutionAttemptId,
          executionTargetId: forcedExecutionTargetId,
          reason: unavailableReason,
        }],
        request: input.request,
      });
    }
    return {
      decision: { kind: 'execution_attempt', attempt: await toRouteRuntimeExecutionAttempt({
        selection,
        identity,
        requestedModel: input.requestedModel,
        failureOverlay,
        request: input.request,
      }) },
      selectorState: proposal,
    };
  }

  if (input.retryCount === 0 && input.stickyExecutionTargetId && !disabledExecutionTargetIds.has(input.stickyExecutionTargetId)) {
    const bundle = version.compiledGraph.compiledRouterBundle;
    const stickyExecutionAttemptId = bundle?.plans
      .map((plan) => getCompiledRouterPlanById(bundle, plan.id))
      .filter(Boolean)
      .flatMap((plan) => plan!.executionAlternatives || [])
      .map((alternative) => alternative.executionAttempt)
      .find((attempt) => (
        attempt?.transportBinding?.executionTargetId === input.stickyExecutionTargetId
      ))?.executionAttemptId || null;
    if (!stickyExecutionAttemptId) {
      disabledExecutionTargetIds.add(input.stickyExecutionTargetId);
    } else {
    const failureOverlay: RouteRuntimeFailureOverlay = {
      disabledExecutionAttemptIds: Array.from(disabledExecutionAttemptIds),
      disabledExecutionTargetIds: Array.from(disabledExecutionTargetIds),
    };
    const selectionConstraint: RouteRuntimeSelectionConstraint = {
      forcedExecutionAttemptId: stickyExecutionAttemptId,
    };
    const { selection, proposal } = evaluateRouteRuntimeDecisionProposal({
      version,
      requestedModel: input.requestedModel,
      request: input.request,
      failureOverlay,
      selectionConstraint,
    });
    if (
      selection?.terminalKind === 'endpoint'
      && executionTargetIdFromSelection(selection) === input.stickyExecutionTargetId
      && selectedRouteAllowedByDownstreamPolicy(selection, input.requestedModel, input.downstreamPolicy)
    ) {
      const identity = await loadExecutionTargetIdentity(input.stickyExecutionTargetId);
      if (identity && !executionTargetUnavailableReason(identity, input.downstreamPolicy)) {
        return {
          decision: { kind: 'execution_attempt', attempt: await toRouteRuntimeExecutionAttempt({
            selection,
            identity,
            requestedModel: input.requestedModel,
            failureOverlay,
            request: input.request,
          }) },
          selectorState: proposal,
        };
      }
    }
    }
  }

  let lastRejectedSelection: RouteRuntimeSelection | null = null;
  let lastRejectedSelectorState: RouteRuntimeSelectorStateProposal | null = null;
  const rejectedAttempts: RouteRuntimeRejectedAttempt[] = [];
  const rejectSelection = (input: {
    selection: RouteRuntimeSelection;
    proposal: RouteRuntimeSelectorStateProposal;
    executionAttemptId: string;
    executionTargetId: number;
    reason: RouteRuntimeRejectedAttempt['reason'];
  }) => {
    disabledExecutionTargetIds.add(input.executionTargetId);
    disabledExecutionAttemptIds.add(input.executionAttemptId);
    lastRejectedSelection = input.selection;
    lastRejectedSelectorState = input.proposal;
    rejectedAttempts.push({
      executionAttemptId: input.executionAttemptId,
      executionTargetId: input.executionTargetId,
      reason: input.reason,
    });
  };
  const exhaustedDecision = async (): Promise<RouteRuntimeDecisionProposal | null> => {
    if (!lastRejectedSelection || !lastRejectedSelectorState || rejectedAttempts.length === 0) return null;
    return await unavailableRouteRuntimeDecision({
      selection: lastRejectedSelection,
      selectorState: lastRejectedSelectorState,
      failureOverlay: {
        disabledExecutionAttemptIds: Array.from(disabledExecutionAttemptIds),
        disabledExecutionTargetIds: Array.from(disabledExecutionTargetIds),
      },
      rejectedAttempts,
      request: input.request,
    });
  };

  for (;;) {
    const failureOverlay: RouteRuntimeFailureOverlay = {
      disabledExecutionAttemptIds: Array.from(disabledExecutionAttemptIds),
      disabledExecutionTargetIds: Array.from(disabledExecutionTargetIds),
    };
    const { selection, proposal } = evaluateRouteRuntimeDecisionProposal({
      version,
      requestedModel: input.requestedModel,
      request: input.request,
      failureOverlay,
    });
    if (!selection) return await exhaustedDecision();
    if (selection.terminalKind === 'synthetic_response') {
      return {
        decision: {
          kind: 'synthetic_response',
          statusCode: selection.syntheticResponse?.statusCode || 503,
          message: selection.syntheticResponse?.message || 'No route is available.',
          terminalNodeId: selection.terminalNodeId,
          runtimeTrace: selection.trace,
        },
        selectorState: proposal,
      };
    }
    const executionTargetId = executionTargetIdFromSelection(selection);
    if (!executionTargetId) return null;
    const executionAttemptId = asText(selection.selectedExecutionAttempt?.executionAttemptId);
    if (!executionAttemptId) return null;
    const excludedCountBefore = disabledExecutionTargetIds.size + disabledExecutionAttemptIds.size;
    if (!selectedRouteAllowedByDownstreamPolicy(selection, input.requestedModel, input.downstreamPolicy)) {
      rejectSelection({ selection, proposal, executionAttemptId, executionTargetId, reason: 'route_scope_excluded' });
      if (disabledExecutionTargetIds.size + disabledExecutionAttemptIds.size === excludedCountBefore) return await exhaustedDecision();
      continue;
    }
    if (disabledExecutionTargetIds.has(executionTargetId) || disabledExecutionAttemptIds.has(executionAttemptId)) {
      disabledExecutionTargetIds.add(executionTargetId);
      disabledExecutionAttemptIds.add(executionAttemptId);
      if (disabledExecutionTargetIds.size + disabledExecutionAttemptIds.size === excludedCountBefore) return null;
      continue;
    }
    const identity = await loadExecutionTargetIdentity(executionTargetId);
    if (!identity) {
      rejectSelection({ selection, proposal, executionAttemptId, executionTargetId, reason: 'identity_missing' });
      if (disabledExecutionTargetIds.size + disabledExecutionAttemptIds.size === excludedCountBefore) return await exhaustedDecision();
      continue;
    }
    const unavailableReason = executionTargetUnavailableReason(identity, input.downstreamPolicy);
    if (unavailableReason) {
      rejectSelection({
        selection,
        proposal,
        executionAttemptId,
        executionTargetId,
        reason: unavailableReason as RouteRuntimeRejectedAttempt['reason'],
      });
      if (disabledExecutionTargetIds.size + disabledExecutionAttemptIds.size === excludedCountBefore) return await exhaustedDecision();
      continue;
    }
    return {
      decision: { kind: 'execution_attempt', attempt: await toRouteRuntimeExecutionAttempt({
        selection,
        identity,
        requestedModel: input.requestedModel,
        failureOverlay,
        request: input.request,
      }) },
      selectorState: proposal,
    };
  }
}

export function commitRouteRuntimeDecisionProposal(
  proposal: RouteRuntimeDecisionProposal,
): boolean {
  return commitRouteRuntimeSelectorStateProposal(proposal.selectorState);
}

function affinityFallbackBehavior(policy: ResolvedRouteAffinityPolicy): 'deny' | 'temporary' | 'promote_on_success' {
  if (policy.kind === 'pool') return policy.crossPoolFallback;
  if (policy.kind === 'target') return policy.crossTargetFallback;
  return 'deny';
}

function withAffinityDecision(
  proposal: RouteRuntimeDecisionProposal | null,
  affinity: RouteRuntimeAffinitySession | null,
  fallback: boolean,
): RouteRuntimeDecisionProposal | null {
  if (!proposal || proposal.decision.kind !== 'execution_attempt' || !affinity) return proposal;
  const selectedExecutionTargetId = proposal.decision.attempt.executionTargetId;
  const behavior = affinityFallbackBehavior(affinity.policy);
  const affinitySelection: ProxyAffinitySuccess = {
    affinityKey: affinity.key,
    entryNodeId: affinity.entryNodeId,
    mode: affinity.policy.kind,
    selectedExecutionTargetId,
    selectedPoolId: affinity.poolIdByTargetId.get(selectedExecutionTargetId) || null,
    primaryRevision: affinity.binding?.revision ?? null,
    primaryPoolId: affinity.binding?.scope === 'pool' ? affinity.binding.primaryPoolId : null,
    primaryExecutionTargetId: affinity.binding?.scope === 'target'
      ? affinity.binding.primaryExecutionTargetId
      : null,
    fallback,
    promoteOnSuccess: behavior === 'promote_on_success',
    ttlSec: affinity.policy.kind === 'disabled' ? 0 : affinity.policy.ttlSec,
  };
  return {
    ...proposal,
    decision: {
      ...proposal.decision,
      attempt: {
        ...proposal.decision.attempt,
        routeRuntimeSnapshot: {
          ...proposal.decision.attempt.routeRuntimeSnapshot,
          executionAttempt: proposal.decision.attempt.routeRuntimeSnapshot.executionAttempt
            ? {
                ...proposal.decision.attempt.routeRuntimeSnapshot.executionAttempt,
                affinity: {
                  mode: affinitySelection.mode,
                  selectedPoolId: affinitySelection.selectedPoolId || null,
                  selectedExecutionTargetId: affinitySelection.selectedExecutionTargetId,
                  primaryPoolId: affinitySelection.primaryPoolId || null,
                  primaryExecutionTargetId: affinitySelection.primaryExecutionTargetId || null,
                  primaryRevision: affinitySelection.primaryRevision || null,
                  fallback: affinitySelection.fallback,
                  promoteOnSuccess: affinitySelection.promoteOnSuccess,
                  bindingOutcome: affinitySelection.mode === 'disabled' ? 'disabled' : 'pending',
                  resultingPrimaryPoolId: null,
                  resultingPrimaryExecutionTargetId: null,
                  resultingRevision: null,
                },
              }
            : null,
        },
        affinity: affinitySelection,
      },
    },
  };
}

function mergeUnavailableDecisionEvidence(
  primary: RouteRuntimeDecisionProposal | null,
  fallback: RouteRuntimeDecisionProposal | null,
): RouteRuntimeDecisionProposal | null {
  if (primary?.decision.kind !== 'unavailable' || fallback?.decision.kind !== 'unavailable') {
    return fallback;
  }
  const primarySnapshot = primary.decision.routeRuntimeSnapshot;
  const fallbackSnapshot = fallback.decision.routeRuntimeSnapshot;
  const rejectedByIdentity = new Map<string, RouteRuntimeRejectedAttempt>();
  for (const rejected of [
    ...(primarySnapshot.decision?.unavailable?.rejectedAttempts || []),
    ...(fallbackSnapshot.decision?.unavailable?.rejectedAttempts || []),
  ]) {
    rejectedByIdentity.set(
      `${rejected.executionAttemptId || ''}:${rejected.executionTargetId || ''}:${rejected.reason}`,
      rejected,
    );
  }
  return {
    ...fallback,
    decision: {
      ...fallback.decision,
      routeRuntimeSnapshot: {
        ...fallbackSnapshot,
        decision: fallbackSnapshot.decision
          ? {
              ...fallbackSnapshot.decision,
              unavailable: {
                reason: 'execution_attempts_exhausted',
                rejectedAttempts: Array.from(rejectedByIdentity.values()),
              },
            }
          : fallbackSnapshot.decision,
        state: {
          ...fallbackSnapshot.state,
          failureOverlay: {
            disabledExecutionAttemptIds: Array.from(new Set([
              ...primarySnapshot.state.failureOverlay.disabledExecutionAttemptIds,
              ...fallbackSnapshot.state.failureOverlay.disabledExecutionAttemptIds,
            ])),
            disabledExecutionTargetIds: Array.from(new Set([
              ...primarySnapshot.state.failureOverlay.disabledExecutionTargetIds,
              ...fallbackSnapshot.state.failureOverlay.disabledExecutionTargetIds,
            ])),
          },
        },
      },
    },
  };
}

export async function proposeRouteRuntimeDecisionInSession(
  session: RouteRuntimeDecisionSession,
  input: Pick<RouteRuntimeDecisionInput, 'retryCount' | 'disabledExecutionAttemptIds' | 'disabledExecutionTargetIds'> = {},
): Promise<RouteRuntimeDecisionProposal | null> {
  const baseInput: RouteRuntimeDecisionInput = {
    requestedModel: session.requestedModel,
    request: session.request,
    downstreamPolicy: session.downstreamPolicy,
    forcedExecutionAttemptId: session.forcedExecutionAttemptId,
    stickyExecutionTargetId: session.affinity ? null : session.stickyExecutionTargetId,
    ...input,
  };
  const affinity = session.affinity;
  if (!affinity?.binding) {
    return withAffinityDecision(
      await proposeRouteRuntimeDecision(baseInput, session.artifact),
      affinity,
      false,
    );
  }

  const primaryTargetIds = affinity.binding.scope === 'target'
    ? [affinity.binding.primaryExecutionTargetId]
    : affinity.targetIdsByPoolId.get(affinity.binding.primaryPoolId) || [];
  const primaryTargetIdSet = new Set(primaryTargetIds);
  const disabledOutsidePrimary = affinity.targetIds.filter((id) => !primaryTargetIdSet.has(id));
  const primaryProposal = await proposeRouteRuntimeDecision({
    ...baseInput,
    stickyExecutionTargetId: null,
    disabledExecutionTargetIds: Array.from(new Set([
      ...(input.disabledExecutionTargetIds || []),
      ...disabledOutsidePrimary,
    ])),
  }, session.artifact);
  if (primaryProposal?.decision.kind === 'execution_attempt') {
    return withAffinityDecision(primaryProposal, affinity, false);
  }

  if (affinityFallbackBehavior(affinity.policy) === 'deny') {
    return primaryProposal;
  }
  const fallbackProposal = await proposeRouteRuntimeDecision({
    ...baseInput,
    stickyExecutionTargetId: null,
    disabledExecutionTargetIds: Array.from(new Set([
      ...(input.disabledExecutionTargetIds || []),
      ...primaryTargetIds,
    ])),
  }, session.artifact);
  const mergedFallbackProposal = mergeUnavailableDecisionEvidence(primaryProposal, fallbackProposal);
  return withAffinityDecision(
    mergedFallbackProposal,
    affinity,
    mergedFallbackProposal?.decision.kind === 'execution_attempt',
  );
}

export async function previewRouteRuntimeDecisionInSession(
  session: RouteRuntimeDecisionSession,
  input: Pick<RouteRuntimeDecisionInput, 'retryCount' | 'disabledExecutionAttemptIds' | 'disabledExecutionTargetIds'> = {},
): Promise<RouteRuntimeDecision | null> {
  const decision = (await proposeRouteRuntimeDecisionInSession(session, input))?.decision ?? null;
  return decision?.kind === 'unavailable' ? null : decision;
}

export async function selectRouteRuntimeDecisionInSession(
  session: RouteRuntimeDecisionSession,
  input: Pick<RouteRuntimeDecisionInput, 'retryCount' | 'disabledExecutionAttemptIds' | 'disabledExecutionTargetIds'> = {},
): Promise<RouteRuntimeDecision | null> {
  for (;;) {
    const proposal = await proposeRouteRuntimeDecisionInSession(session, input);
    if (!proposal) return unavailableRouteRuntimeDecisionFromSession(session, input);
    if (proposal.decision.kind === 'unavailable') return proposal.decision;
    if (commitRouteRuntimeDecisionProposal(proposal)) return proposal.decision;
  }
}

export async function previewRouteRuntimeDecision(
  input: RouteRuntimeDecisionInput,
): Promise<RouteRuntimeDecision | null> {
  const decision = (await proposeRouteRuntimeDecision(input))?.decision ?? null;
  return decision?.kind === 'unavailable' ? null : decision;
}

export async function selectRouteRuntimeDecision(
  input: RouteRuntimeDecisionInput,
): Promise<RouteRuntimeDecision | null> {
  const session = await createRouteRuntimeDecisionSession(input);
  return await selectRouteRuntimeDecisionInSession(session, input);
}

export async function selectRouteRuntimeExecutionAttempt(
  input: RouteRuntimeDecisionInput,
): Promise<RouteRuntimeExecutionAttempt | null> {
  const decision = await selectRouteRuntimeDecision(input);
  return decision?.kind === 'execution_attempt' ? decision.attempt : null;
}

export async function recordRouteRuntimeExecutionAttemptSelected(executionTargetId: number): Promise<void> {
  await ensureExecutionTargetState(executionTargetId);
  const nowIso = new Date().toISOString();
  await db.update(schema.runtimeExecutionTargetState).set({
    lastSelectedAt: nowIso,
    updatedAt: nowIso,
  }).where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).run();
  invalidateRouteRuntimeExecutionTargetState(executionTargetId);
}

/** Records a real upstream execution start, after routing has committed to an attempt. */
export async function recordRouteRuntimeExecutionAttemptStarted(input: {
  executionTargetId: number;
}): Promise<void> {
  const executionTargetId = asPositiveInteger(input.executionTargetId);
  if (executionTargetId == null) {
    throw new Error('Cannot record an execution start without an execution target id');
  }
  await recordRouteRuntimeExecutionAttemptSelected(executionTargetId);
}

export async function recordRouteRuntimeExecutionAttemptSuccess(input: {
  executionTargetId: number;
  accountId?: number | null;
  modelName?: string | null;
  latencyMs: number;
}): Promise<void> {
  const executionTargetId = input.executionTargetId;
  await ensureExecutionTargetState(executionTargetId);
  const nowIso = new Date().toISOString();
  await db.update(schema.runtimeExecutionTargetState).set({
    successCount: sql`${schema.runtimeExecutionTargetState.successCount} + 1`,
    totalLatencyMs: sql`${schema.runtimeExecutionTargetState.totalLatencyMs} + ${Math.max(0, Math.trunc(input.latencyMs || 0))}`,
    latencySampleCount: sql`${schema.runtimeExecutionTargetState.latencySampleCount} + 1`,
    lastUsedAt: nowIso,
    cooldownUntil: null,
    lastFailAt: null,
    consecutiveFailCount: 0,
    cooldownLevel: 0,
    updatedAt: nowIso,
  }).where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).run();
  invalidateRouteRuntimeExecutionTargetState(executionTargetId);
}

export async function markRouteRuntimeExecutionTargetRecovered(executionTargetId: number): Promise<void> {
  const normalizedId = asPositiveInteger(executionTargetId);
  if (normalizedId == null) throw new Error('Cannot recover an execution target without a valid id');
  await ensureExecutionTargetState(normalizedId);
  await db.update(schema.runtimeExecutionTargetState).set({
    consecutiveFailCount: 0,
    cooldownLevel: 0,
    cooldownUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.runtimeExecutionTargetState.executionTargetId, normalizedId)).run();
  invalidateRouteRuntimeExecutionTargetState(normalizedId);
}

async function resolveGlobalRouteFailureBackoffPolicy(): Promise<RouteFailureBackoffOverride> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, ROUTE_FAILURE_BACKOFF_SETTING_KEY))
    .get();
  if (!row?.value) return { mode: 'custom', policy: DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY };
  try {
    const parsed = JSON.parse(row.value);
    const override = normalizeRouteFailureBackoffOverride(parsed);
    if (override) return override;
    const legacyPolicy = normalizeRouteFailureBackoffPolicy(parsed);
    return legacyPolicy ? { mode: 'custom', policy: legacyPolicy } : { mode: 'custom', policy: DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY };
  } catch {
    return { mode: 'custom', policy: DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY };
  }
}

export function resolveRouteFailureBackoffPolicy(input: {
  global: RouteFailureBackoffOverride;
  macro?: RouteFailureBackoffOverride | null;
  group?: RouteFailureBackoffOverride | null;
  candidate?: RouteFailureBackoffOverride | null;
  executionAttempt?: RouteFailureBackoffOverride | null;
}): RouteFailureBackoffOverride {
  const selected = [input.executionAttempt, input.candidate, input.group, input.macro]
    .map((value) => normalizeRouteFailureBackoffOverride(value))
    .find(Boolean);
  return selected || normalizeRouteFailureBackoffOverride(input.global) || { mode: 'custom', policy: DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY };
}

export function resolveFailureCooldownMs(input: {
  consecutiveFailCount: number;
  cooldownLevel: number;
  policy: RouteFailureBackoffOverride;
}): number {
  if (input.policy.mode === 'disabled') return 0;
  const policy = input.policy.policy;
  const nextCount = Math.max(0, Math.trunc(input.consecutiveFailCount));
  if (nextCount < policy.failureThreshold) return 0;
  const level = Math.min(Math.max(0, Math.trunc(input.cooldownLevel)) + 1, policy.levelsSec.length - 1);
  return Math.min((policy.levelsSec[level] || 0) * 1000, policy.maxSec * 1000);
}

export async function recordRouteRuntimeExecutionAttemptFailure(input: {
  executionTargetId: number;
  status?: number;
  errorText?: string | null;
  failureBackoff?: RouteFailureBackoffOverride | null;
}): Promise<void> {
  const executionTargetId = input.executionTargetId;
  await ensureExecutionTargetState(executionTargetId);
  for (;;) {
    const state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
      .get();
    if (!state) throw new Error('Runtime execution target state does not exist');
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const failCount = state.failCount + 1;
    const nextConsecutiveFailCount = state.consecutiveFailCount + 1;
    const globalPolicy = await resolveGlobalRouteFailureBackoffPolicy();
    const effectivePolicy = resolveRouteFailureBackoffPolicy({
      global: globalPolicy,
      executionAttempt: input.failureBackoff,
    });
    const thresholdReached = effectivePolicy.mode === 'custom'
      && nextConsecutiveFailCount >= effectivePolicy.policy.failureThreshold;
    const cooldownLevel = thresholdReached
      ? Math.min(state.cooldownLevel + 1, effectivePolicy.policy.levelsSec.length - 1)
      : state.cooldownLevel;
    const cooldownMs = resolveFailureCooldownMs({
      consecutiveFailCount: nextConsecutiveFailCount,
      cooldownLevel: state.cooldownLevel,
      policy: effectivePolicy,
    });
    const result = await db.update(schema.runtimeExecutionTargetState).set({
      failCount,
      lastFailAt: nowIso,
      consecutiveFailCount: thresholdReached ? 0 : nextConsecutiveFailCount,
      cooldownLevel,
      cooldownUntil: cooldownMs > 0 ? new Date(nowMs + cooldownMs).toISOString() : null,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId),
      eq(schema.runtimeExecutionTargetState.failCount, state.failCount),
      eq(schema.runtimeExecutionTargetState.consecutiveFailCount, state.consecutiveFailCount),
      eq(schema.runtimeExecutionTargetState.cooldownLevel, state.cooldownLevel),
    )).run();
    if (Number(result?.changes || 0) === 1) break;
  }
  invalidateRouteRuntimeExecutionTargetState(executionTargetId);
}

export async function clearRouteRuntimeExecutionAttemptFailureState(executionTargetIds: number[]): Promise<number> {
  const normalized = Array.from(new Set(executionTargetIds
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .map((value) => Math.trunc(value))));
  if (normalized.length === 0) return 0;
  for (const executionTargetId of normalized) {
    await ensureExecutionTargetState(executionTargetId);
  }
  const result = await db.update(schema.runtimeExecutionTargetState).set({
    failCount: 0,
    lastFailAt: null,
    consecutiveFailCount: 0,
    cooldownLevel: 0,
    cooldownUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(inArray(schema.runtimeExecutionTargetState.executionTargetId, normalized)).run();
  invalidateRouteRuntimeExecutionTargetState(normalized);
  return Number(result?.changes || normalized.length);
}
