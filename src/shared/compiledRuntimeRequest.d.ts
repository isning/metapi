export type CompiledRuntimeJsonValue =
  | null
  | boolean
  | number
  | string
  | CompiledRuntimeJsonValue[]
  | { [key: string]: CompiledRuntimeJsonValue };

export type CompiledRouteRuntimeRequest = {
  requestedModel?: string | null;
  payload?: CompiledRuntimeJsonValue;
  normalizedPayload?: CompiledRuntimeJsonValue;
  headers?: Record<string, unknown> | null;
  method?: string | null;
  path?: string | null;
  endpointType?: string | null;
  query?: Record<string, unknown> | null;
  clientContext?: Record<string, unknown> | null;
};
