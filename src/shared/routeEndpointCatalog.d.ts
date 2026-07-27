import type {
  RouteGraphEndpointExposure,
  RouteGraphEndpointKind,
  RouteGraphEndpointResolutionStatus,
  RouteGraphEndpointSourceKind,
} from './routeGraph.js';

export type RouteEndpointCatalogItem = {
  endpointId: string;
  nodeId: string;
  label: string;
  endpointKind: RouteGraphEndpointKind;
  exposure: RouteGraphEndpointExposure;
  resolutionStatus: RouteGraphEndpointResolutionStatus;
  ownerKind: 'manual' | 'macro' | null;
  sourceKind: RouteGraphEndpointSourceKind | null;
  enabled: boolean;
  displayIcon: string | null;
  modelPattern: string;
  publicModelName: string | null;
  upstreamModels: string[];
  siteNames: string[];
  candidateCount: number;
  sourceEndpointIds: string[];
  tags: string[];
  metadata: Record<string, unknown>;
};

export type RouteEndpointCatalogPage = {
  revision: string;
  items: RouteEndpointCatalogItem[];
  pageInfo: {
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  };
};
