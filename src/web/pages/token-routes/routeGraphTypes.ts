export type RouteGraphOwnership = 'manual' | 'auto_generated' | 'system' | 'derived';
export type RouteGraphNodeType = 'entry' | 'route_endpoint' | 'filter' | 'dispatcher' | 'model_endpoint' | 'synthetic_endpoint' | 'auto_node';
export type RouteGraphPortKind =
  | 'request'
  | 'bidirect'
  | 'route'
  | 'response'
  | 'control'
  | 'metrics';
export type RouteGraphEdgeKind =
  | 'request_flow'
  | 'bidirect_flow'
  | 'route_flow'
  | 'response_flow'
  | 'control_flow'
  | 'metrics_link';

export type RouteGraphPort = {
  id: string;
  label: string;
  direction: 'input' | 'output';
  kind: RouteGraphPortKind;
  accepts?: RouteGraphPortKind[];
  required?: boolean;
  multiple?: boolean;
  collection?: { type: 'single' } | { type: 'arr'; min?: number; max?: number } | { type: 'set'; min?: number; max?: number };
  readonly?: boolean;
  enabled?: boolean;
};

export type RouteGraphNode = {
  id: string;
  type: RouteGraphNodeType;
  name?: string | null;
  enabled: boolean;
  visibility: 'public' | 'internal';
  ownership: RouteGraphOwnership;
  position?: { x: number; y: number };
  dynamicPorts?: RouteGraphPort[];
  [key: string]: unknown;
};

export type RouteFilter =
  | { type: 'rewrite_model'; source: 'current_model' | 'upstream_model'; operation: 'strip_suffix' | 'set'; suffix?: string; value?: string }
  | { type: 'set_payload'; path: string; value: unknown; mode?: 'default' | 'override' }
  | { type: 'remove_payload'; path: string }
  | { type: 'set_header'; name: string; value: string; mode?: 'default' | 'override' }
  | { type: 'remove_header'; name: string }
  | { type: 'set_endpoint_preference'; endpoint: 'chat' | 'messages' | 'responses' };

export type RouteGraphEdge = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  kind: RouteGraphEdgeKind;
  ownership: RouteGraphOwnership;
  metadata?: Record<string, unknown>;
};

export type RouteGraphMacro = {
  id: string;
  kind: string;
  enabled: boolean;
  visibility: 'public' | 'internal';
  ownership: Exclude<RouteGraphOwnership, 'derived'>;
  name?: string | null;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
};

export type AddTemplate = {
  id: string;
  category: 'Core' | 'Transform' | 'Fallback';
  title: string;
  kicker: string;
  detail: string;
  primitiveType?: RouteGraphNodeType;
  create: (index: number, position?: { x: number; y: number }) => RouteGraphNode;
};
