/**
 * Web aliases for the canonical route graph contract.  The editor must not
 * maintain a second graph schema: graph validation and workspace operations
 * use these exact types on both sides of the API boundary.
 */
export type {
  RouteGraphOwnership,
  RouteGraphNodeType,
  RouteGraphPortKind,
  RouteGraphEdgeKind,
  RouteGraphPort,
  RouteGraphNode,
  RouteGraphEdge,
  RouteGraphMacro,
  RouteFilter,
  RouteGraphPosition,
} from '../../../shared/routeGraph.js';
