import type { ButtonHTMLAttributes, ReactNode, RefCallback } from 'react';
import type { BrandInfo } from '../../components/BrandIcon.js';
import type { RouteDecision, RouteDecisionCandidate, RouteMode } from '../../../shared/tokenRouteContract.js';
import type { RouteGraphBackendSpec, RouteGraphMatchSpec } from '../../../shared/routeGraph.js';
import type { RouteGraphVisibility } from '../../../shared/routeGraph.js';
export type { RouteDecision, RouteDecisionCandidate, RouteMode } from '../../../shared/tokenRouteContract.js';

export type RouteSortBy = 'modelPattern' | 'targetCount';
export type RouteSortDir = 'asc' | 'desc';
export type GroupFilter = null | '__all__' | number;
export type RouteRoutingStrategy = 'weighted' | 'round_robin' | 'stable_first';
export type OAuthRouteUnitStrategy = 'round_robin' | 'stick_until_unavailable';
export type RouteRowKind = 'persisted' | 'zero_target';
export type RouteEndpointTargetDraft = {
  accountId: number;
  tokenId: number;
  sourceModel: string;
};

export type RouteEndpointTargetRouteUnitMember = {
  accountId: number;
  username: string | null;
  siteName: string | null;
};

export type RouteEndpointTargetRouteUnit = {
  id: number | string;
  name: string | null;
  strategy: OAuthRouteUnitStrategy;
  memberCount: number;
  members?: RouteEndpointTargetRouteUnitMember[];
};

export type RouteEndpointTarget = {
  id: number;
  routeId?: number;
  accountId: number;
  tokenId: number | null;
  sourceModel?: string | null;
  priority: number;
  weight: number;
  enabled: boolean;
  manualOverride: boolean;
  successCount: number;
  failCount: number;
  cooldownUntil?: string | null;
  account?: {
    username: string | null;
    accessToken?: string | null;
    extraConfig?: string | null;
    credentialMode?: string | null;
  };
  site?: {
    id: number;
    name: string | null;
    platform: string | null;
  };
  token?: {
    id: number;
    name: string;
    accountId: number;
    enabled: boolean;
    isDefault: boolean;
  } | null;
  oauthRouteUnitId?: number | null;
  routeUnit?: RouteEndpointTargetRouteUnit | null;
};

export type RouteRow = {
  id: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  presentation: {
    displayName: string | null;
    displayIcon: string | null;
  };
  modelMapping?: string | null;
  routingStrategy?: RouteRoutingStrategy | null;
  visibility?: RouteGraphVisibility;
  decisionSnapshot?: RouteDecision | null;
  decisionRefreshedAt?: string | null;
  enabled: boolean;
  targets: RouteEndpointTarget[];
};

export type RouteSummaryRow = {
  id: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  presentation: {
    displayName: string | null;
    displayIcon: string | null;
  };
  modelMapping: string | null;
  routingStrategy?: RouteRoutingStrategy | null;
  visibility?: RouteGraphVisibility;
  enabled: boolean;
  targetCount: number;
  enabledTargetCount: number;
  siteNames: string[];
  decisionSnapshot: RouteDecision | null;
  decisionRefreshedAt: string | null;
  kind?: RouteRowKind;
  readOnly?: boolean;
  isVirtual?: boolean;
};

export type RouteEndpointCatalogItem = {
  endpointId: string;
  nodeId: string;
  routeId: number | null;
  label: string;
  endpointKind: 'supply' | 'route_product';
  exposure: 'none' | RouteGraphVisibility;
  resolutionStatus: 'resolved' | 'degraded' | 'unresolved';
  ownerKind: 'automatic_route' | 'manual_route' | 'macro';
  sourceKind: 'upstream_model' | 'automatic_model_group' | 'manual_group' | 'synthetic' | 'inline';
  enabled: boolean;
  displayIcon: string | null;
  modelPattern: string;
  publicModelName: string | null;
  upstreamModels: string[];
  siteNames: string[];
  tags: string[];
  metadata: Record<string, unknown>;
};

export type TargetDecisionState = {
  probability: number;
  showBar: boolean;
  reasonText: string;
  reasonColor: string;
};

export type RouteTokenOption = {
  id: number;
  name: string;
  isDefault: boolean;
  sourceModel?: string;
};

export type RouteIconOption = {
  value: string;
  label: string;
  description?: string;
  iconNode?: ReactNode;
  iconUrl?: string;
  iconText?: string;
};

export type MissingTokenRouteSiteActionItem = {
  key: string;
  siteName: string;
  accountId: number;
  accountLabel: string;
};

export type MissingTokenGroupRouteSiteActionItem = {
  key: string;
  siteName: string;
  accountId: number;
  accountLabel: string;
  missingGroups: string[];
  requiredGroups: string[];
  availableGroups: string[];
  groupCoverageUncertain?: boolean;
};

export type SortableRouteTargetRowProps = {
  target: RouteEndpointTarget;
  displayPriority?: number;
  showPriorityBadge?: boolean;
  dragging?: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  dragHandleRef?: RefCallback<HTMLButtonElement>;
  decisionCandidate?: RouteDecisionCandidate;
  isExactRoute: boolean;
  loadingDecision: boolean;
  isSavingPriority: boolean;
  readOnly?: boolean;
  targetManagementDisabled?: boolean;
  dragInProgress?: boolean;
  mobile?: boolean;
  tokenOptions: RouteTokenOption[];
  activeTokenId: number;
  isUpdatingToken: boolean;
  onTokenDraftChange: (targetId: number, tokenId: number) => void;
  onSaveToken: () => void;
  onDeleteTarget: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onSiteBlockModel?: () => void;
};

export type GroupRouteItem = {
  id: number;
  title: string;
  icon: { kind: 'auto' } | { kind: 'none' } | { kind: 'text'; value: string } | { kind: 'brand'; value: string };
  brand: BrandInfo | null;
  modelPattern: string;
  targetCount: number;
  sourceRouteCount: number;
};

export type PriorityRailSection = {
  priority: number;
  targetCount: number;
  targetIds: number[];
};

export type PriorityRailDragTarget =
  | {
    kind: 'existing_layer';
    priority: number;
    highlighted: boolean;
  }
  | {
    kind: 'new_layer';
    priority: number;
    highlighted: boolean;
  };
