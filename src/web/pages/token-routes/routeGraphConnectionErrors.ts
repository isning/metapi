import { tr } from '../../i18n.js';

const ROUTE_GRAPH_CONNECTION_ERROR_CODES = new Set([
  'element_not_found', 'port_not_found', 'same_element', 'source_not_output', 'target_not_input',
  'port_disabled', 'manual_edge_denied', 'port_kind_mismatch',
  'duplicate_connection', 'input_capacity_exceeded', 'cycle', 'stale_revision', 'invalid_connection_cursor',
  'edge_not_found', 'edge_not_authorable', 'replacement_source_mismatch',
]);

export function routeGraphConnectionErrorMessage(error: unknown): string {
  const code = routeGraphConnectionErrorCode(error);
  return ROUTE_GRAPH_CONNECTION_ERROR_CODES.has(code)
    ? tr(`pages.tokenRoutes.routeGraphConnection.error.${code}`)
    : tr('pages.tokenRoutes.routeGraphConnection.error.generic');
}

export function routeGraphConnectionErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.message : '';
}

export function routeGraphCommandErrorMessage(error: unknown, fallbackKey: string): string {
  const code = routeGraphConnectionErrorCode(error);
  if (ROUTE_GRAPH_CONNECTION_ERROR_CODES.has(code)) {
    return tr(`pages.tokenRoutes.routeGraphConnection.error.${code}`);
  }
  const isApiRequestError = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number';
  return isApiRequestError ? tr(fallbackKey) : (
    error instanceof Error ? error.message : tr(fallbackKey)
  );
}
