import type {
  RouteGraphDiagnostic,
  RouteGraphEdgeKind,
  RouteGraphNodeType,
  RouteGraphSource,
} from './routeGraph.js';
import type { RouteGraphWorkspaceOperation } from './routeGraphOperations.js';

export type RouteGraphElementRef = {
  kind: 'macro' | 'node';
  id: string;
};

export type RouteGraphFocusRef = RouteGraphElementRef;

export type RouteGraphWorkspaceConnectionEndpointRef = {
  element: RouteGraphElementRef;
  portId: string;
};

export type RouteGraphWorkspaceConnectionTarget = {
  endpoint: RouteGraphWorkspaceConnectionEndpointRef;
  graphElementId: string;
  elementLabel: string;
  elementKind: 'macro' | RouteGraphNodeType;
  elementSubtitle: string | null;
  enabled: boolean;
  ownership: 'manual' | 'system' | 'derived';
  port: {
    id: string;
    label: string;
    direction: 'input' | 'output';
    kind: 'request' | 'bidirect' | 'route';
    manualEdgePolicy: import('./routeGraph.js').RouteGraphManualEdgePolicy;
    description?: string;
  };
  focuses: Array<{
    focus: RouteGraphFocusRef;
    label: string;
  }>;
};

export type RouteGraphWorkspaceConnectionTargetPage = {
  revision: string;
  source: RouteGraphWorkspaceConnectionTarget;
  items: RouteGraphWorkspaceConnectionTarget[];
  nextCursor: string | null;
  totalCount: number;
};

export type RouteGraphWorkspaceConnectionTargetFilters = {
  source: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string | null;
  cursor?: string | null;
  limit?: number;
  query?: string | null;
  revision?: string;
  operations?: RouteGraphWorkspaceOperation[];
};

export type RouteGraphWorkspaceRemovalImpact = {
  revision: string;
  element: RouteGraphElementRef;
  elementLabel: string;
  incidentConnections: {
    total: number;
    incoming: number;
    outgoing: number;
  };
};

export type RouteGraphWorkspaceRepresentation = 'semantic' | 'primitive';

export type RouteGraphWorkspaceIndexFilters = {
  cursor?: string | null;
  limit?: number;
  query?: string | null;
  elementKind?: 'macro' | 'entry' | 'component' | null;
  ownership?: 'manual' | 'system' | 'mixed' | null;
  diagnosticState?: 'all' | 'issues' | 'errors' | 'warnings' | null;
};

export type RouteGraphWorkspaceIndexItem = {
  focus: RouteGraphFocusRef;
  label: string;
  subtitle: string | null;
  elementKind: 'macro' | 'entry' | 'component';
  status: 'enabled' | 'disabled' | 'mixed';
  ownership: 'manual' | 'system' | 'mixed';
  counts: {
    directConnections: number;
    errors: number;
    warnings: number;
  };
};

export type RouteGraphWorkspaceIndexPage = {
  revision: string;
  summary: {
    nodes: number;
    edges: number;
    macros: number;
    focuses: number;
    errors: number;
    warnings: number;
  };
  items: RouteGraphWorkspaceIndexItem[];
  nextCursor: string | null;
  totalCount: number;
};

export type RouteGraphWorkspaceResume = {
  revision: string;
  focus: RouteGraphFocusRef | null;
};

type RouteGraphWorkspacePortalBase = {
  id: string;
  direction: 'incoming' | 'outgoing';
  resident: { element: RouteGraphElementRef; portId: string };
  label: string;
};

export type RouteGraphWorkspaceBoundaryPortal = RouteGraphWorkspacePortalBase & {
  kind: 'neighbor' | 'overflow';
  preview: {
    elementKind: 'macro' | RouteGraphNodeType;
    subtitle: string | null;
    enabled: boolean;
  };
  destination: { kind: 'focus'; focus: RouteGraphFocusRef };
  connection: {
    edgeKind: RouteGraphEdgeKind;
    count: number;
    portLabel: string;
    edges: Array<{
      id: string;
      destinationPortId: string;
      ownership: 'manual' | 'system' | 'derived';
    }>;
  };
};

export type RouteGraphWorkspaceCollectionPortal = RouteGraphWorkspacePortalBase & {
  kind: 'collection';
  collection: {
    action: 'previous' | 'next';
    start: number;
    end: number;
    total: number;
  };
  destination: { kind: 'window'; token: string };
  connection: { edgeKind: RouteGraphEdgeKind; count: number; portLabel: string };
};

export type RouteGraphWorkspacePortal =
  | RouteGraphWorkspaceBoundaryPortal
  | RouteGraphWorkspaceCollectionPortal;

export type RouteGraphWorkspaceResidentElement = {
  element: RouteGraphElementRef;
  graphElementId: string;
};

export type RouteGraphFocusedWorkspace = {
  revision: string;
  representation: RouteGraphWorkspaceRepresentation;
  focus: RouteGraphFocusRef & {
    label: string;
    subtitle: string | null;
  };
  residentGraph: RouteGraphSource;
  residentElements: RouteGraphWorkspaceResidentElement[];
  portals: RouteGraphWorkspacePortal[];
  diagnostics: RouteGraphDiagnostic[];
  totals: { nodes: number; edges: number; macros: number };
  capabilities: {
    editable: boolean;
    primitiveAvailable: boolean;
  };
};
