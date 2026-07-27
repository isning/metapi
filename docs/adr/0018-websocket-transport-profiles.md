# ADR-0018: WebSocket Transport Profiles For Realtime Upstream Dispatch

Status: Proposed
Date: 2026-06-28

## Context

ADR-0017 makes HTTP endpoint execution explicit through
`ApiEndpointProfile.requestUrl`. Codex Responses WebSocket currently works, but
it is still a special runtime path:

- it selects a route target, then builds a `/responses` URL from the selected
  site API endpoint;
- it decides WebSocket support from global settings and account extra config;
- it records fallback behavior through the WebSocket flow, not through the same
  resolved attempt contract used by HTTP dispatch;
- the user cannot configure a WebSocket-specific executable URL or handshake
  policy per endpoint.

This is acceptable as an implementation detail, but it is not a clean long-term
model. WebSocket support is a transport capability of a selected executable
API surface. It should not become a second routing graph, and it should not be
folded into HTTP `requestUrl` fields.

## Decision

Metapi will introduce explicit transport profiles for non-HTTP transports.
HTTP remains represented by `ApiEndpointProfile`. WebSocket is represented by a
transport profile attached to an endpoint profile.

```text
SupplyEndpoint
  -> ResolvedApiAttempt
      -> ApiEndpointProfile        // HTTP request surface
      -> ApiTransportProfile[]     // optional alternate transports
```

The route graph continues to select supply endpoints. Transport profiles are
not graph nodes.

Non-goals:

- Do not add WebSocket nodes, edges, or ports to Graph Routing.
- Do not store WebSocket settings in HTTP `requestUrl`.
- Do not detect WebSocket support by probing every model and endpoint
  combination.
- Do not make WebSocket fallback re-run route selection unless the route retry
  policy explicitly asks for a different supply endpoint.

## Transport Profile

```ts
type ApiTransportProfile = {
  id: string;
  siteId: number;
  apiEndpointProfileId: string;
  transport: 'websocket';
  label: string;
  requestUrlMode: 'derive_from_endpoint' | 'override';
  requestUrl?: string | null;
  handshakeHeaders?: Record<string, string>;
  enabled: boolean;
  priority: number;
  sessionPolicy: {
    reuse: 'conversation' | 'request' | 'disabled';
    closeOnTerminalError: boolean;
    idleTtlMs?: number;
  };
  fallbackPolicy: {
    httpFallback: boolean;
    fallbackStatuses: number[];
  };
  metadata?: Record<string, unknown>;
};
```

Rules:

- `requestUrlMode = derive_from_endpoint` converts the endpoint profile HTTP
  URL from `https/http` to `wss/ws`.
- `requestUrlMode = override` stores the full executable WebSocket URL. This
  is for upstreams whose WebSocket URL is not a direct scheme conversion.
- Transport profile headers are handshake headers only. Request payload
  transformation remains owned by the protocol adapter.
- Transport profiles are below endpoint profiles. A route macro cannot select
  WebSocket directly.
- A disabled transport profile removes only that transport. The endpoint
  profile remains available for HTTP execution.

Validation:

- `apiEndpointProfileId` must reference an enabled endpoint profile on the same
  site.
- `requestUrlMode = override` requires a valid `ws:` or `wss:` URL.
- `requestUrlMode = derive_from_endpoint` requires an endpoint profile
  `requestUrl` with `http:` or `https:`.
- `priority` is unique only within `(apiEndpointProfileId, transport)`.
- Header names are case-insensitive and must not include downstream-only
  WebSocket upgrade headers such as `sec-websocket-key`.

URL derivation:

```text
https://chatgpt.com/backend-api/codex/responses
  -> wss://chatgpt.com/backend-api/codex/responses

http://localhost:3000/v1/responses
  -> ws://localhost:3000/v1/responses
```

The derivation only changes the scheme. It does not rewrite paths. If an
upstream uses a different WebSocket path, use `override`.

## Credential Transport Support

Credential endpoint bindings stay the source of truth for whether a credential
may use an endpoint profile. Transport support is an optional refinement:

```ts
type CredentialTransportBinding = {
  id: string;
  siteId: number;
  credentialEndpointBindingId: string;
  apiTransportProfileId: string;
  enabled: boolean;
  support: 'supported' | 'unsupported' | 'unknown' | 'blocked';
  source: 'default' | 'discovered' | 'manual' | 'runtime';
  priority?: number;
  metadata?: Record<string, unknown>;
};
```

Rules:

- If no credential transport binding exists, runtime uses provider defaults.
  For Codex OAuth this default may be `supported` when the global WebSocket
  setting is enabled and the account metadata does not explicitly disable it.
- A user override creates a credential transport binding.
- `blocked` and `unsupported` prevent WebSocket attempts but do not block HTTP
  attempts for the same endpoint profile.
- `unknown` is explainable in UI but does not enter production WebSocket
  execution unless the provider default explicitly allows optimistic use.
- Credential transport bindings are not copied into the route graph. They only
  refine the attempt after a supply endpoint has been selected.

## Persistence

Transport profile tables are normalized below endpoint profiles:

```text
api_transport_profiles
  id
  site_id
  api_endpoint_profile_id
  transport
  label
  request_url_mode
  request_url
  handshake_headers_json
  enabled
  priority
  session_policy_json
  fallback_policy_json
  metadata_json
  created_at
  updated_at

credential_transport_bindings
  id
  site_id
  credential_endpoint_binding_id
  api_transport_profile_id
  enabled
  support
  source
  priority
  metadata_json
  created_at
  updated_at
```

Indexes:

- `api_transport_profiles(site_id, api_endpoint_profile_id, transport)`;
- `credential_transport_bindings(site_id, credential_endpoint_binding_id)`;
- unique binding on `(credential_endpoint_binding_id, api_transport_profile_id)`.

Schema changes must update the Drizzle schema, SQLite migration history, and
checked-in schema artifacts together.

## Runtime Attempt Contract

Resolved attempts gain a transport section:

```ts
type ResolvedApiAttempt = {
  apiType: ApiType;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  apiEndpointProfileId: string;
  credentialEndpointBindingId: string;
  transport: {
    selected: 'http' | 'websocket';
    profileId?: string | null;
    requestUrl?: string | null;
    fallbackToHttp: boolean;
    diagnostics: string[];
  };
};
```

The planner interface should be protocol-neutral:

```ts
type ResolveTransportInput = {
  attempt: ResolvedApiAttempt;
  downstreamTransport: 'http' | 'websocket';
  requestApiType: ApiType;
  requestModel: string;
  credentialId: string;
};

type ResolvedTransportAttempt = {
  selected: 'http' | 'websocket';
  profileId: string | null;
  requestUrl: string;
  handshakeHeaders: Record<string, string>;
  sessionPolicy: ApiTransportProfile['sessionPolicy'] | null;
  fallbackPolicy: ApiTransportProfile['fallbackPolicy'] | null;
  diagnostics: string[];
};
```

Execution flow:

```text
RouteExecutionScope
  -> selected supply endpoint
  -> API attempt planner
  -> transport planner
  -> WebSocket runtime or HTTP runtime
```

For downstream `GET /v1/responses` WebSocket requests:

1. Authorize downstream key.
2. Normalize the WebSocket frame through the Responses protocol adapter.
3. Select the route target and resolved API attempt as HTTP dispatch does.
4. Resolve a WebSocket transport profile for the selected endpoint profile.
5. If supported, execute WebSocket runtime.
6. If WebSocket fails with a configured fallback status, execute the same
   request through HTTP using the resolved HTTP attempt.

The HTTP fallback must receive the selected supply endpoint and resolved API
attempt. It must not call normal target selection again as an accidental side
effect of fallback.

## Codex Defaults

For Codex OAuth, Metapi creates a default WebSocket transport profile attached
to the OpenAI Responses endpoint profile:

```text
Endpoint profile:
  apiType: openai_responses
  requestUrl: https://chatgpt.com/backend-api/codex/responses

Transport profile:
  transport: websocket
  requestUrlMode: derive_from_endpoint
  sessionPolicy.reuse: conversation
  fallbackPolicy.httpFallback: true
  fallbackPolicy.fallbackStatuses: [401, 403, 404, 409, 426, 429, 500, 502, 503, 504]
```

The WebSocket beta header remains a transport profile handshake concern. It
must not be added to normal HTTP requests unless HTTP fallback explicitly needs
to preserve incremental semantics.

Existing account metadata remains an input to the transport planner:

```json
{
  "websockets": false
}
```

This maps to effective support `unsupported` for provider defaults. A manual
credential transport binding can override it when the user has verified that a
specific credential supports the transport.

## UI Rules

Endpoint profile UI should show a compact "Transports" section:

- HTTP is always shown as the base transport from `ApiEndpointProfile`.
- WebSocket appears when the provider preset or user configuration enables it.
- Users can configure:
  - enabled state;
  - derived URL vs custom URL;
  - custom handshake headers;
  - session reuse policy;
  - HTTP fallback enabled state and fallback statuses.

Credential support matrix should gain a transport detail view for each endpoint
profile. The default table should stay compact; transport controls belong in an
expanded row or detail panel.

Recommended UI layout:

- Endpoint profile detail:
  - base HTTP request URL;
  - transport list with HTTP as read-only base and WebSocket as optional;
  - derived/custom URL toggle;
  - handshake header editor;
  - session and fallback policy controls.
- Credential detail:
  - endpoint support status as the primary matrix;
  - transport support as an expanded detail for the selected endpoint binding;
  - clear effective-state text: "uses provider default", "manually disabled",
    "blocked by credential metadata", or "manually enabled".
- Model workspace and trace:
  - show the selected supply endpoint first;
  - show API endpoint profile second;
  - show transport third.

The UI should not present WebSocket as a route target. Users choose upstream
model supply through routes; transport is selected by execution policy.

## Observability

Trace events should record:

- selected endpoint profile id;
- selected transport (`http` or `websocket`);
- transport profile id;
- WebSocket request URL label, without secrets;
- session key reuse state;
- fallback reason and final fallback transport;
- terminal frame status when available.

Health classification should use the same failure vocabulary as HTTP endpoint
attempts. WebSocket-only failures update transport observations, not endpoint
availability for HTTP.

Transport observations should be separate from endpoint observations:

```text
endpoint observation:
  credential + endpoint profile + model + api type

transport observation:
  credential endpoint binding + transport profile + model + status
```

This prevents a WebSocket upgrade failure from incorrectly marking the HTTP
endpoint profile as unusable.

## Migration

Existing settings remain valid:

- `codex_upstream_websocket_enabled` becomes the global default enablement
  gate for Codex WebSocket transport profiles.
- account extra config `websockets: false` maps to an effective credential
  transport support state of `unsupported` unless the user creates an explicit
  manual override.

No route graph migration is required because transport profiles are not graph
nodes.

Migration defaults:

- Existing Codex endpoint profiles get one derived WebSocket transport profile
  when the provider preset supports Responses WebSocket.
- Existing account metadata that disables `websockets` is not materialized into
  rows unless the user saves a manual transport override.
- Backup/import includes transport profiles and credential transport bindings
  with the same site/credential ownership as endpoint profiles.

## Implementation Plan

1. Add `api_transport_profiles` and `credential_transport_bindings` tables.
2. Extend endpoint profile services to create provider default transport
   profiles.
3. Add a transport planner that resolves WebSocket support from:
   credential transport binding -> account metadata -> provider default ->
   global setting.
4. Refactor `responsesWebsocketFlow` to use resolved API attempts and transport
   profiles instead of building URLs directly from the site API endpoint pool.
5. Keep HTTP fallback through the existing `/v1/responses` HTTP path, but pass
   the selected route target/attempt so fallback does not reselect a different
   upstream unless the route policy explicitly allows retry.
6. Add UI for transport profiles under endpoint profile configuration.
7. Add tests for:
   - derived WebSocket URL;
   - custom WebSocket URL;
   - credential-level disabled transport;
   - fallback status behavior;
   - trace fields and session reuse;
   - no graph nodes are created for transport profiles.

Suggested module ownership:

- `src/server/services/apiEndpointProfileService.ts` owns profile persistence
  and provider defaults.
- `src/server/services/apiTransportProfileService.ts` owns transport
  persistence and effective transport resolution.
- `src/server/proxy-core/transportPlanner.ts` owns runtime transport planning.
- `src/server/proxy-core/orchestration/responsesWebsocketFlow.ts` stays the
  downstream WebSocket adapter and delegates selection/planning.
- `src/server/proxy-core/runtime/codexWebsocketRuntime.ts` stays the socket
  runtime and receives a prepared URL, headers, session policy, and payload.

## Consequences

- WebSocket becomes configurable and observable without changing route graph
  semantics.
- HTTP endpoint profiles remain clean and executable.
- Codex WebSocket support keeps its session reuse behavior while becoming
  explainable in the same runtime attempt model.
- Future realtime transports can reuse the same transport-profile shape rather
  than adding provider-specific branches.
