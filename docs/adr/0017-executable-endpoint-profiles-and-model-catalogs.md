# ADR-0017: Executable Endpoint Profiles And Model Catalog Sources

Status: Accepted
Date: 2026-06-28

## Context

ADR-0010 introduced the right separation between graph-visible supply targets
and protocol-specific API variants. The transport part of that design still
used `baseUrl` and `pathTemplate` on `ApiEndpointProfile`, and the current
runtime can still collapse a planned API attempt back into endpoint names such
as `chat`, `messages`, or `responses`.

That is not expressive enough for real upstreams:

- official providers and compatible gateways often publish the exact request
  URL the caller must use, and it is easy to get duplicated path fragments such
  as `/v1/v1` when the system rebuilds the URL from pieces;
- the same site can expose OpenAI Chat and Anthropic Messages surfaces with
  different executable URLs but the same model catalog;
- model discovery should not probe every endpoint-profile-and-model
  combination by default;
- runtime traces must explain the exact endpoint profile and request URL that
  was attempted;
- graph routing must continue to select stable supply endpoints, not protocol
  request surfaces.

DeepSeek is the motivating example. It can expose an OpenAI-compatible chat
surface and an Anthropic-compatible messages surface for the same API key and
models. Those request surfaces should be selectable and explainable without
duplicating graph supply nodes or running endpoint-by-model detection for every
model.

## Decision

Metapi will model endpoint execution, model catalog discovery, and runtime
evidence as three separate concepts:

```text
Site
  -> ModelCatalogSource[]
  -> ApiEndpointProfile[]
  -> Credential[]
      -> CredentialEndpointBinding[]
      -> SupplyEndpoint[]
          -> ResolvedApiAttempt[]
```

`ApiEndpointProfile` is an executable request surface. It stores the full
request URL used by runtime dispatch.

`ModelCatalogSource` is a reusable model discovery source. Multiple endpoint
profiles may share one catalog source.

`EndpointModelObservation` is runtime evidence that a specific model worked or
failed through a specific endpoint profile and credential. It improves planning
and diagnostics but does not replace the catalog source.

The route graph continues to reference only supply endpoints. Endpoint profiles
and catalog sources are not graph nodes.

This ADR is about HTTP request execution. Codex Responses WebSocket transport
is a separate runtime transport path: it may select the same site credential and
still needs the same health, retry, and trace vocabulary, but it does not use
`ApiEndpointProfile.requestUrl` as its persisted contract. If WebSocket needs
user-configurable executable surfaces later, that should be modeled as an
explicit transport profile rather than folded into this HTTP endpoint profile
schema.

## Endpoint Profile

An endpoint profile describes one callable API surface for a site:

```ts
type ApiEndpointProfile = {
  id: string;
  siteId: number;
  label: string;
  apiType: ApiType;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  authMode: 'bearer' | 'api_key_header' | 'query' | 'custom';
  defaultHeaders?: Record<string, string>;
  enabled: boolean;
  priority: number;
  capabilityDefaults: ApiVariantCapability;
  compatibilityPolicyRef?: string | null;
  modelCatalogSourceId?: string | null;
  metadata?: Record<string, unknown>;
};
```

Rules:

- `requestUrl` is the canonical executable address. Runtime must not rebuild it
  from `site.url` plus a hard-coded path.
- The UI should label this field as "request URL" or "请求地址", not
  "base URL", because the stored value includes the final API path.
- Defaults and presets may derive `requestUrl` from provider conventions, but
  the saved profile must be directly executable.
- A site may have multiple endpoint profiles for the same credential and model.
- Endpoint profiles are below supply endpoints. They do not appear as graph
  nodes and should not be selected by route macros directly.

Examples:

```ts
{
  apiType: 'openai_chat_completions',
  requestUrl: 'https://api.deepseek.com/chat/completions'
}

{
  apiType: 'anthropic_messages',
  requestUrl: 'https://api.deepseek.com/anthropic/v1/messages'
}

{
  apiType: 'openai_chat_completions',
  requestUrl: 'https://gateway.example.com/v1/chat/completions'
}
```

## Model Catalog Source

A model catalog source describes where model names come from:

```ts
type ModelCatalogSource = {
  id: string;
  siteId: number;
  label: string;
  discoveryMethod: 'GET' | 'POST' | 'manual' | 'none';
  discoveryUrl?: string | null;
  parser: 'openai_models' | 'anthropic_models' | 'gemini_models' | 'newapi_models' | 'custom_json';
  credentialScope: 'site' | 'credential' | 'anonymous';
  refreshPolicy: {
    mode: 'manual' | 'scheduled' | 'on_credential_change';
    intervalMinutes?: number;
  };
  enabled: boolean;
  metadata?: Record<string, unknown>;
};
```

Rules:

- A catalog source is not required to match an executable request URL.
- Multiple endpoint profiles may point at the same catalog source.
- Model refresh runs per catalog source and credential scope, not per endpoint
  profile and model.
- A site without a discovery API may use `manual` or `none` and still expose
  endpoint profiles for manually entered models.
- Catalog results declare candidate supply endpoints. They do not prove every
  endpoint profile can execute every model.

DeepSeek-style setup:

```ts
{
  id: 'deepseek-models',
  discoveryMethod: 'GET',
  discoveryUrl: 'https://api.deepseek.com/models',
  parser: 'openai_models',
  credentialScope: 'credential'
}
```

## Credential Endpoint Binding

A credential endpoint binding answers whether a specific credential may use a
specific endpoint profile:

```ts
type CredentialEndpointBinding = {
  id: string;
  siteId: number;
  credentialId: string;
  apiEndpointProfileId: string;
  enabled: boolean;
  support: 'supported' | 'unsupported' | 'unknown' | 'blocked';
  source: 'default' | 'discovered' | 'inherited' | 'manual';
  priority?: number;
  capabilityOverride?: Partial<ApiVariantCapability>;
  compatibilityPolicyRef?: string | null;
  pricingPolicyRef?: string | null;
  measuredPricingRef?: string | null;
  metadata?: Record<string, unknown>;
};
```

Rules:

- The planner may use only enabled bindings with `support = supported` during
  normal production dispatch.
- `unknown` means "not yet verified"; it can be tested or force-enabled through
  explicit advanced configuration, but it is not silently inserted into a
  production attempt plan.
- Key-scoped compatibility, pricing, and support overrides belong on the
  binding rather than the site-level endpoint profile.

## Endpoint Model Observation

Runtime requests and explicit tests can record evidence:

```ts
type EndpointModelObservation = {
  id: string;
  siteId: number;
  credentialId: string;
  apiEndpointProfileId: string;
  modelName: string;
  status: 'confirmed' | 'rejected' | 'transient_failure';
  failureClass?: string | null;
  observedAt: string;
  expiresAt?: string | null;
  source: 'runtime' | 'manual_test' | 'catalog_refresh';
};
```

Rules:

- Observations are advisory runtime evidence with TTL.
- A successful request can confirm that one endpoint profile works for one
  model.
- A protocol rejection can demote or skip that endpoint profile for the same
  model until the observation expires.
- Observations must not create or delete graph nodes directly.

This avoids endpoint-by-model probing as the default behavior while still
letting Metapi learn from real requests.

## Runtime Attempt Contract

Runtime dispatch should execute resolved attempts, not endpoint strings:

```ts
type ResolvedApiAttempt = {
  apiType: ApiType;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  apiEndpointProfileId: string;
  credentialEndpointBindingId: string;
  credentialId: string;
  adapterId: string;
  headers: Record<string, string>;
  compatibilityPolicyRef?: string | null;
  capability: ApiVariantCapability;
  fallbackAllowed: boolean;
  diagnostics: string[];
};
```

The proxy orchestration flow becomes:

```text
RouteExecutionScope
  -> selected supply endpoint
  -> API attempt planner
  -> ResolvedApiAttempt[]
  -> execute requestUrl with selected adapter
```

Rules:

- `executeEndpointFlow()` should iterate `ResolvedApiAttempt[]`.
- The request builder receives `requestUrl` from the attempt.
- Protocol adapters remain responsible for request and response transformation.
- Retry and health classification use the same failure vocabulary as route
  health.
- Debug traces include endpoint profile id, binding id, API type, and request
  URL label. They must not include secrets.

The old flow is invalid for new implementation work:

```text
ApiAttemptPlan
  -> ['chat', 'messages', 'responses']
  -> site.url + hard-coded path
```

## DeepSeek Preset Shape

A DeepSeek official preset should create one site with multiple endpoint
profiles and a shared catalog source:

```text
Site: DeepSeek
  Model catalog:
    DeepSeek models
      GET https://api.deepseek.com/models
      parser: openai_models

  Endpoint profiles:
    OpenAI Chat
      apiType: openai_chat_completions
      requestUrl: https://api.deepseek.com/chat/completions
      catalog: DeepSeek models

    Anthropic Messages
      apiType: anthropic_messages
      requestUrl: https://api.deepseek.com/anthropic/v1/messages
      catalog: DeepSeek models
```

If an upstream gateway requires `/v1/chat/completions`, its endpoint profile
stores that exact URL. Metapi should not normalize it into a base URL and path
pair.

## UI Rules

Site and credential UI should expose these as separate sections:

- endpoint profiles: API type, request URL, auth mode, default headers,
  capability, compatibility policy, linked catalog source;
- model catalog sources: discovery URL, parser, refresh policy, last refresh,
  model count, last error;
- credential endpoint support: enabled/support state, priority, overrides,
  latest observation;
- route/model explain views: selected supply endpoint, ordered API attempts,
  request URL labels, and observations that affected planning.

The model detection UI should default to catalog refresh and optional targeted
tests. It should not encourage "test every model on every endpoint profile" as
the normal workflow.

## Migration

The schema moves from `base_url + path_template` to `request_url` as the
persisted endpoint profile contract. The old columns are removed by the ADR
migration; import and migration code must write `request_url` only.

Implementation work must update the Drizzle schema, SQLite migration history,
and generated schema artifacts together. New runtime code should not add a
second compatibility path that keeps rebuilding request URLs from old transport
fields.

## Implementation Boundary

The accepted implementation includes:

- persisted model catalog sources, endpoint profiles, credential endpoint
  bindings, and endpoint-model observations;
- site/credential UI for editing endpoint request URLs, default headers,
  linked catalog sources, and the credential support matrix;
- model refresh through enabled model catalog sources before adapter-level
  probing, with refresh status written back to the catalog source;
- runtime attempt planning through endpoint profiles and credential bindings;
- runtime dispatch using the resolved attempt `requestUrl`;
- advisory endpoint-model observations that can skip rejected profile/model
  pairs;
- backup/export/import and database migration support for the new tables and
  fields;
- removal of endpoint-profile `base_url` and `path_template` from the current
  schema contract.

Model catalog refresh is not a separate scheduler in this ADR. It is part of
the existing model refresh workflow: when a credential is refreshed, enabled
catalog sources for the site are queried first, parsed according to their
declared parser, and then adapter-level discovery is used only when catalog
sources do not produce models. This keeps one refresh workflow while making
`ModelCatalogSource` the source of truth for configurable discovery URLs.

## Consequences

- Endpoint execution becomes explicit and explainable.
- DeepSeek-like multi-surface providers can be represented as one site without
  duplicating supply endpoints.
- Model discovery becomes cheaper and easier to reason about because catalog
  refresh is reusable.
- Route graph semantics stay focused on model supplies and route products.
- Runtime traces can show exactly which profile URL was attempted without
  leaking credentials.
