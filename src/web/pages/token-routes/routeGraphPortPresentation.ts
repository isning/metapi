import { tr } from '../../i18n.js';
import type { RouteGraphPort } from './routeGraphTypes.js';

const portDirectionLabelKeys: Record<RouteGraphPort['direction'], string> = {
  input: 'pages.tokenRoutes.routeGraphViewModel.portDirection.input',
  output: 'pages.tokenRoutes.routeGraphViewModel.portDirection.output',
};

const portKindLabelKeys: Record<RouteGraphPort['kind'], string> = {
  request: 'pages.tokenRoutes.routeGraphViewModel.portKind.request',
  bidirect: 'pages.tokenRoutes.routeGraphViewModel.portKind.bidirect',
  route: 'pages.tokenRoutes.routeGraphViewModel.portKind.route',
};

const portLabelKeys: Record<string, { single: string; plural: string }> = {
  'reuse input': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.reuseInput',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.reuseInputs',
  },
  'matched flow': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.matchedFlow',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.matchedFlows',
  },
  'before mutation': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.beforeMutation',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.beforeMutations',
  },
  'after mutation': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.afterMutation',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.afterMutations',
  },
  'before round trip': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.beforeRoundTrip',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.beforeRoundTrips',
  },
  'after round trip': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.afterRoundTrip',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.afterRoundTrips',
  },
  'dispatch input': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchInput',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchInputs',
  },
  'dispatch path': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchPath',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchPaths',
  },
  'endpoint candidates': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.endpointCandidates',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.endpointCandidates',
  },
  'route product': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.routeProduct',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.routeProducts',
  },
  'invoke route': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.invokeRoute',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.invokeRoutes',
  },
  'synthetic response': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.syntheticResponse',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.syntheticResponses',
  },
  'return response': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.returnResponse',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.returnResponses',
  },
  'candidate targets': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.candidateSet',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.candidateSet',
  },
  'route input': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.routeInput',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.routeInputs',
  },
  'selected path': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.selectedPath',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.selectedPaths',
  },
  'fallback when exhausted': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.fallbackWhenExhausted',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.fallbackWhenExhausted',
  },
  'request fallback': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.requestFallback',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.requestFallbacks',
  },
  response: {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.response',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.responses',
  },
  route: {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.route',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.routes',
  },
  request: {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.request',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.requests',
  },
  error: {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.error',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.errors',
  },
  'endpoint target': {
    single: 'pages.tokenRoutes.routeGraphViewModel.portLabel.endpointTarget',
    plural: 'pages.tokenRoutes.routeGraphViewModel.portLabel.endpointTargets',
  },
};

function knownPortLabel(label: string, cardinality: 'single' | 'plural'): string | null {
  const key = portLabelKeys[label]?.[cardinality];
  return key ? tr(key) : null;
}

export function pluralizePortLabel(label: string): string {
  const known = knownPortLabel(label, 'plural');
  if (known) return known;
  if (label.endsWith('s')) return label;
  return `${label}s`;
}

export function getPortDisplayLabel(port: RouteGraphPort): string {
  if (port.direction === 'input') return knownPortLabel(port.label, 'single') || port.label;
  return pluralizePortLabel(port.label);
}

export function getPortDirectionDisplayLabel(direction: RouteGraphPort['direction']): string {
  return tr(portDirectionLabelKeys[direction]);
}

export function getPortKindDisplayLabel(kind: RouteGraphPort['kind']): string {
  return tr(portKindLabelKeys[kind]);
}

export function getPortCollectionKind(port: RouteGraphPort): 'single' | 'arr' | 'set' {
  return port.collection?.type || 'single';
}

export function getPortTypeSignature(port: RouteGraphPort): string {
  const collection = port.collection;
  if (!collection || collection.type === 'single') return port.kind;
  const open = collection.type === 'set' ? '{' : '[';
  const close = collection.type === 'set' ? '}' : ']';
  const min = typeof collection.min === 'number' ? String(collection.min) : '';
  const max = typeof collection.max === 'number' ? String(collection.max) : '';
  if (!min && !max) return `${port.kind}${open}${close}`;
  return `${port.kind}${open}${min},${max}${close}`;
}
