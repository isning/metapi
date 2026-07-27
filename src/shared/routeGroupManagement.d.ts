import type { DispatcherPolicy, RouteFilter, TargetSelectionPolicy } from "./routeGraph.js";

export type RouteGroupExplicitSourceReference =
  | { kind: "execution_target"; sourceRef: string }
  | { kind: "route_group"; id: string };

export type RouteGroupSourceSelection =
  | { kind: "explicit"; sources: RouteGroupExplicitSourceReference[] }
  | { kind: "model_pattern"; pattern: string };

export type RouteGroupCreateCommand = {
  model: { publicName: string; upstreamName?: string | null };
  sourceSelection?: RouteGroupSourceSelection;
  presentation?: { displayName?: string | null; displayIcon?: string | null };
  dispatcherPolicy?: DispatcherPolicy | null;
  modelMapping?: string | null;
  filters?: unknown;
  visibility?: "public" | "internal";
  enabled?: boolean;
};

export type RouteGroupUpdateCommand = Partial<RouteGroupCreateCommand>;

export type RouteGroupSourceProjection = {
  source: RouteGroupExplicitSourceReference;
  label: string;
  modelName: string | null;
  siteName: string | null;
  enabled: boolean;
};

/** A selectable management source. This is not a Graph endpoint catalog item. */
export type RouteGroupSourceCatalogItem = RouteGroupSourceProjection;
export type RouteGroupSourceCatalogPage = {
  items: RouteGroupSourceCatalogItem[];
  nextCursor: string | null;
};

/**
 * Management read model. It deliberately contains no Graph endpoint, macro,
 * matcher or compiler identity. Graph navigation is resolved server-side from
 * the Route Group key.
 */
export type RouteGroupManagementSummary = {
  id: string;
  kind: "automatic" | "manual";
  sourceMode: "auto" | "manual" | "mixed";
  model: {
    publicName: string | null;
    upstreamName: string | null;
    normalizedName: string | null;
  };
  presentation: {
    displayName: string | null;
    displayIcon: string | null;
  };
  filters: { operations: RouteFilter[] } | null;
  dispatcherPolicy: DispatcherPolicy | null;
  visibility: "public" | "internal";
  enabled: boolean;
  sourceSelection:
    | { kind: "explicit"; sources: RouteGroupSourceProjection[] }
    | { kind: "model_pattern"; pattern: string };
  candidateCount: number;
  enabledCandidateCount: number;
  siteNames: string[];
};

export type RouteGroupManagementListItem = RouteGroupManagementSummary;

type RouteGroupManagementCandidateBase = {
  /** Opaque identity scoped to the displayed dispatcher stage. */
  id: string;
  routeGroupId: string;
  routeGroupKey: string;
  fallbackStageId: string;
  fallbackStageLabel: string | null;
  fallbackStageOrder: number;
  sortOrder: number;
  weight: number;
  enabled: boolean;
  /** Management edits that must survive automatic regeneration; not candidate creation provenance. */
  manualOverride: boolean;
  successCount: number;
  failCount: number;
  cooldownUntil: string | null;
};

/** A dispatcher member that resolves directly to an executable endpoint. */
export type RouteGroupExecutionTargetProjection = {
    id: number;
    sourceRef: string;
    accountId: number;
    tokenId: number | null;
    sourceModel: string | null;
    account: { username: string | null };
    site: { id: number; name: string | null; platform: string | null };
    token: {
      id: number;
      name: string;
      accountId: number;
      enabled: boolean;
      isDefault: boolean;
    } | null;
    enabled: boolean;
    successCount: number;
    failCount: number;
    cooldownUntil: string | null;
};

export type RouteGroupExecutionEndpointCandidate =
  RouteGroupManagementCandidateBase & {
    kind: "execution_endpoint";
    modelName: string | null;
    targetSelection: TargetSelectionPolicy | null;
    targets: RouteGroupExecutionTargetProjection[];
  };

/** A dispatcher member that delegates to another Route Group. */
export type RouteGroupReferenceCandidate = RouteGroupManagementCandidateBase & {
  kind: "route_group";
  referencedRouteGroup: {
    id: string;
    label: string;
    modelName: string | null;
    enabled: boolean;
  };
};

export type RouteGroupManagementCandidate =
  RouteGroupExecutionEndpointCandidate | RouteGroupReferenceCandidate;

/** A selectable runtime endpoint for adding an execution member to a Route Group. */
export type RouteGroupCandidateCatalogItem = {
  sourceRef: string;
  accountId: number;
  tokenId: number | null;
  sourceModel: string;
  accountLabel: string;
  siteName: string | null;
  tokenName: string | null;
  enabled: boolean;
  alreadyMember: boolean;
};

export type RouteGroupCandidateCatalogPage = {
  items: RouteGroupCandidateCatalogItem[];
  pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
};

export type RouteGroupCandidateCreateCommand = {
  sourceRef: string;
  stageId?: string;
  weight?: number;
};

export type RouteGroupCandidateBatchCreateCommand = {
  sourceRefs: string[];
  stageId?: string;
};

export type RouteGroupCandidateUpdateCommand = {
  stageId?: string;
  weight?: number;
  enabled?: boolean;
};

export type RouteGroupManagementFallbackStage = {
  id: string;
  label: string | null;
  order: number;
  enabled: boolean;
  dispatcherPolicy: DispatcherPolicy | null;
  candidateManagement: "explicit" | "generated";
  candidates: RouteGroupManagementCandidate[];
};
