# ADR-0010: Supply Target API Variants And Fallback Planning

Status: Proposed
Date: 2026-06-22

## Context

Metapi already supports automatic endpoint fallback for several upstream
protocol surfaces. The current implementation mainly reasons in terms of
`chat`, `messages`, and `responses` endpoint candidates. It can recover from
common upstream mismatches such as:

- an OpenAI-compatible upstream requiring `/v1/responses`;
- an Anthropic-compatible upstream requiring `/v1/messages`;
- a legacy chat endpoint rejecting a Responses request;
- compact Responses fallback behavior;
- global cross-protocol fallback disablement.

That behavior is useful and must remain first-class. The route graph redesign
in ADR-0006 through ADR-0009 introduced a better semantic model:

- `route_endpoint endpointKind=supply` represents one upstream supply endpoint;
- `route_endpoint endpointKind=route_product` represents a reusable route
  product;
- candidate selector macros choose route endpoints;
- the route program bundle compiles graph semantics into executable dispatch
  operations.

The missing abstraction is that one concrete upstream model supply may expose
multiple callable API variants. For example, the same site, credential, base
URL, and model name may work through one or more of:

- OpenAI Chat Completions;
- OpenAI Responses;
- Anthropic Messages;
- Gemini GenerateContent;
- NewAPI relay endpoints;
- future vendor-native or emulated surfaces.

If this is modeled by duplicating supply nodes in the graph, the graph becomes
noisy, manual references become unstable, and route policy has to choose between
transport details instead of upstream model supplies. If it is hidden only in
ad-hoc runtime code, UI, health, pricing, compatibility, and fallback behavior
cannot explain what will actually be called.

## Decision

Metapi will keep `route_endpoint endpointKind=supply` as the graph-visible
stable supply identity and introduce an internal API variant model beneath it.

The conceptual layers are:

```text
Site
  -> ApiEndpointProfile[]
  -> Credential[]
      -> CredentialEndpointBinding[]
      -> SupplyTarget[]
          -> ApiVariant[]
              -> ApiAttemptPlan
```

`SupplyTarget` is the semantic upstream model supply selected by routes and
manual macros. It corresponds to the existing graph-visible
`route_endpoint endpointKind=supply`.

`ApiEndpointProfile` is a site-level callable API profile: API type,
executable request URL, auth shape, default capability, and compatibility
inheritance. ADR-0017 further separates executable endpoint profiles from model
catalog sources and replaces the earlier `baseUrl + pathTemplate` shape with a
single `requestUrl`.

`CredentialEndpointBinding` records whether a specific credential/API key can
use a specific endpoint profile, including key-scoped overrides and discovered
support state.

`ApiVariant` is one concrete callable API surface for a supply target. It owns
protocol-specific request shape, endpoint path, health, compatibility,
reference pricing, measured pricing, and fallback classification.

`ApiAttemptPlan` is the ordered runtime plan built from request requirements,
route policy, configured endpoint preferences, variant health, and learned
upstream mismatch signals.

Route graph objects select supply targets. They do not select API variants by
default.

## Domain Model

### API Endpoint Profile

An API endpoint profile is reusable site configuration. It says how a site can
be called, independent of a specific model:

```ts
type ApiEndpointProfile = {
  id: string;
  siteId: number;
  apiType: ApiType;
  label: string;
  requestUrl: string;
  authMode: 'bearer' | 'api_key_header' | 'query' | 'custom';
  enabled: boolean;
  priority?: number;
  capabilityDefaults: ApiVariantCapability;
  compatibilityPolicyRef?: string | null;
  modelCatalogSourceId?: string | null;
  metadata?: Record<string, unknown>;
};
```

Examples:

```text
api-endpoint:site-openai:chat-completions
api-endpoint:site-openai:responses
api-endpoint:site-anthropic:messages
api-endpoint:site-gemini:generate-content
```

A site can have multiple endpoint profiles for the same credential and model.
Profiles are not graph nodes. They are used to derive API variants under a
supply target through credential endpoint bindings.

### Credential Endpoint Binding

A credential endpoint binding answers: "Can this site/key call this endpoint
profile, and should the planner use it?"

```ts
type CredentialEndpointBinding = {
  id: string;
  siteId: number;
  credentialId: string;
  apiEndpointProfileId: string;
  enabled: boolean;
  support: 'supported' | 'unsupported' | 'unknown' | 'blocked';
  source: 'discovered' | 'manual' | 'inherited';
  priority?: number;
  capabilityOverride?: Partial<ApiVariantCapability>;
  compatibilityPolicyRef?: string | null;
  pricingPolicyRef?: string | null;
  measuredPricingRef?: string | null;
  metadata?: Record<string, unknown>;
};
```

Identity:

```text
credential-endpoint:{credentialKey}:{apiEndpointProfileId}
```

Rules:

- endpoint profiles describe what the site can theoretically call;
- credential endpoint bindings describe what a specific key can actually call;
- discovery may create or update bindings;
- manual configuration may enable, disable, or mark bindings unsupported;
- a planner must not use bindings with `enabled = false`, `unsupported`, or
  `blocked` unless an explicit diagnostic/debug mode is requested;
- normal endpoint pickers may select only bindings for the active site/key with
  `enabled = true` and `support = supported`;
- `unknown` bindings can be shown as "needs probe" and can be manually tested
  or force-enabled through advanced configuration, but they are not silently
  added to production attempt plans;
- key-scoped compatibility and pricing overrides live on the binding, not on
  the site-wide endpoint profile.

### Supply Target

A supply target is the stable upstream model target that route products and
manual macros reference:

```ts
type SupplyTarget = {
  id: string;
  routeEndpointId: string;
  siteId: number;
  credentialId?: string | null;
  upstreamModel: string;
  canonicalModel: string;
  platform: string;
  scopeKey?: string | null;
  enabled: boolean;
  resolutionStatus: 'resolved' | 'unresolved' | 'degraded';
  defaultVariantPolicy: ApiVariantPolicy;
  metadata?: Record<string, unknown>;
};
```

The graph generated view remains:

```ts
type RouteEndpointSupplyNode = RouteEndpointNode & {
  endpointKind: 'supply';
  exposure: 'none';
  resolvesTo: {
    kind: 'supply_target';
    id: string;
  };
};
```

Supply target identity should be derived from stable operational dimensions:

```text
supply-target:{siteKey}:{credentialKey}:{scopeKey}:{canonicalModel}
```

`scopeKey` is optional and site-defined. It should be used only when the site
intentionally treats two upstream scopes as different supplies, such as
separate regions, accounts, or upstream pools. A base URL or path that only
selects an API type should normally live on `ApiEndpointProfile` and must not
force a new supply target id.

If a persisted route target or imported endpoint row already has a stable
database identity, that identity may be part of the fingerprint source, but
display labels and local row ids must not be the whole identity.

### API Variant

An API variant is one callable protocol/path/adapter choice under a supply
target:

```ts
type ApiVariant = {
  id: string;
  supplyTargetId: string;
  apiType: ApiType;
  apiEndpointProfileId: string;
  credentialEndpointBindingId: string;
  requestUrl: string;
  adapterId: string;
  capability: ApiVariantCapability;
  health: ApiVariantHealth;
  pricingPolicyRef?: string | null;
  measuredPricingRef?: string | null;
  compatibilityPolicyRef?: string | null;
  fallbackPolicy: ApiVariantFallbackPolicy;
  priority?: number;
  metadata?: Record<string, unknown>;
};
```

Variant identity is derived from the stable supply target id plus the endpoint
binding:

```text
api-variant:{supplyTargetId}:{credentialEndpointBindingId}
```

This means adding a new API type to a site creates a new variant without
changing the route graph supply target selected by manual routes. It also means
two keys under the same site can expose different variant sets.

Initial `ApiType` values:

```ts
type ApiType =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'openai_embeddings'
  | 'openai_completions'
  | 'openai_images_generations'
  | 'openai_images_edits'
  | 'openai_videos_generations'
  | 'openai_videos'
  | 'gemini_generate_content'
  | 'newapi_chat_completions'
  | 'newapi_responses'
  | 'vendor_native'
  | 'custom_http';
```

The existing `CompatibilityEndpoint` values map into the first implementation
slice as:

```text
chat      -> openai_chat_completions
responses -> openai_responses
messages  -> anthropic_messages
```

### Capability

Capability must be explicit. Variants do not inherit feature completeness just
because a platform adapter exists:

```ts
type ApiVariantCapability = {
  status: 'supported' | 'unsupported' | 'emulated' | 'unknown';
  input: {
    text: CapabilityState;
    image: CapabilityState;
    audio: CapabilityState;
    tools: CapabilityState;
    toolChoice: CapabilityState;
    jsonSchema: CapabilityState;
    stream: CapabilityState;
  };
  output: {
    text: CapabilityState;
    reasoning: CapabilityState;
    toolCalls: CapabilityState;
    usage: CapabilityState;
    citations: CapabilityState;
  };
  limits?: {
    maxContextTokens?: number;
    maxOutputTokens?: number;
  };
};

type CapabilityState = 'native' | 'emulated' | 'unsupported' | 'unknown';
```

This preserves the current chat messages adaptation story. For example, a
downstream Chat request may be transformed to a target-native Messages or
Responses variant when the variant declares the needed capabilities.

### API Attempt Plan

Runtime does not execute variants directly from graph order. It asks a planner
for ordered attempts:

```ts
type ApiAttemptPlan = {
  supplyTargetId: string;
  attempts: ApiAttempt[];
  diagnostics: ApiAttemptDiagnostic[];
};

type ApiAttempt = {
  variantId: string;
  apiType: ApiType;
  adapterId: string;
  requestUrl: string;
  requestTransform: string;
  responseTransform: string;
  reason: ApiAttemptReason[];
  downgradeAllowed: boolean;
  retryClassifiers: RetryClassifierRef[];
};
```

The planner is a pure policy module. It takes:

- downstream request format and requested capabilities;
- route program selected supply target;
- endpoint bindings for the selected supply target's credential;
- supply target variant policy;
- global settings such as `disable_cross_protocol_fallback`;
- upstream platform capabilities;
- variant health and cooldown state;
- learned mismatch hints from recent upstream errors.

It returns the ordered attempts for that one supply target.

## Fallback Order

Fallback has three layers, in this order:

1. **API variant fallback inside the same supply target.**
   Try another API variant under the same supply target when the error
   indicates an endpoint/protocol mismatch or a configured compact fallback.
2. **Supply target fallback inside the route candidate group.**
   If the selected supply target fails for retryable, health, quota, or
   non-recoverable protocol reasons, the route dispatcher may choose another
   supply/product candidate according to route policy.
3. **Route or synthetic fallback.**
   If no supply target can execute, use the route program's synthetic fallback
   or return an actionable route diagnostic.

This order prevents an upstream model from being skipped just because the first
API surface was wrong. It also prevents protocol probing from jumping across
unrelated accounts before exhausting known compatible surfaces for the chosen
target.

## Preserving Current Fallback Behavior

The current endpoint fallback behavior maps into the planner:

| Current concept | New concept |
| --- | --- |
| `CompatibilityEndpoint` | `ApiType` subset |
| `endpointCandidates` | `ApiAttempt[]` for one supply target |
| `resolveUpstreamEndpointCandidates()` | variant candidate derivation input |
| `promoteRequiredEndpointCandidateAfterProtocolError()` | learned mismatch reorder within `ApiAttemptPlan` |
| `promoteResponsesCandidateAfterLegacyChatError()` | learned mismatch reorder within `ApiAttemptPlan` |
| `disable_cross_protocol_fallback` | planner constraint |
| `responses_compact_fallback_to_responses_enabled` | planner rule |

The existing `executeEndpointFlow()` seam remains the orchestration seam. The
first implementation may adapt `ApiAttemptPlan` to the current
`endpointCandidates` interface internally, but the long-term caller-facing
contract should be attempt-based.

Routes remain adapters. Protocol conversion stays in transformer/protocol
modules. Proxy orchestration calls the planner and executes attempts; it does
not own protocol inference rules inline.

## Pricing And Measurement

Pricing attaches at the API variant layer first and may roll up to the supply
target:

- official/reference pricing belongs to `ApiVariant.pricingPolicyRef`;
- measured entry pricing belongs to observed selected attempts;
- equivalent multiplier uses the effective probability of reaching each
  candidate and variant;
- variant-specific cache, context-tier, batch, reasoning, image, audio, or
  request fees are modeled by the pricing policy referenced by the variant.

Route product theoretical cost is computed as:

```text
sum(route candidate probability * supply target probability *
    api variant attempt probability * effective variant price)
```

When the planner uses deterministic fallback rather than weighted selection,
variant probabilities are derived from observed fallback rates or reported as a
range until enough measurements exist.

## Route Program Integration

`RouteProgramBundle` keeps `select_supply` as the executable graph operation:

```ts
type SelectSupplyOp = {
  op: 'select_supply';
  endpointId: string;
  supplyTargetId: string;
  targets: CompiledEndpointTarget[];
  variantPolicy?: ApiVariantPolicy;
};
```

The route program should not grow `select_chat`, `select_responses`, or
protocol-specific graph operations. Those are API variant attempt details
resolved below `select_supply`.

The endpoint catalog may expose variant summaries for UI and diagnostics:

```ts
type RouteProgramSupplyEndpoint = RouteProgramEndpoint & {
  endpointKind: 'supply';
  supplyTargetId: string;
  apiVariants: ApiVariantSummary[];
};
```

## UI/UX

### Route Graph

Default graph view shows supply targets, not API variants. A supply target node
can show compact badges such as:

```text
2 API types
Chat + Responses
Messages fallback learned
```

API variants are shown in inspector and debug views:

- variant list with API type, path, capability state, health, and pricing;
- fallback order preview for the current downstream request;
- last mismatch reason and learned reorder status;
- copyable endpoint details in hover cards, not primary labels.

Graph canvas expansion should not create one node per API variant by default.
If a future debug mode visualizes variants, it must be explicitly labeled as an
attempt plan view and remain read-only.

### Site And Upstream Compatibility UI

A site may expose multiple API endpoint profiles. UI should separate:

- platform/default capability;
- discovered or manually configured API variants;
- compatibility policy inheritance;
- per-variant overrides.

Inherited settings should show their source and hide local detail fields until
the user chooses an override mode. Advanced JSON remains available for escape
hatches, but normal API type configuration should use structured controls.

Endpoint support should be edited as a site/key matrix:

```text
Credential / key      Chat Completions      Responses      Messages
key-a                 supported             supported      blocked
key-b                 supported             unknown        unsupported
```

The matrix edits `CredentialEndpointBinding` records. Site-wide endpoint
profiles remain reusable templates; toggling support for one key must not
silently change another key. Discovery updates binding support state, while a
manual override can lock a binding as enabled, disabled, unsupported, or
blocked.

### Manual Route Picker

Manual route groups continue selecting route endpoints:

- default picker selects route products;
- advanced picker selects supply targets;
- selecting an endpoint directly means selecting one of the endpoint bindings
  supported by that supply target's site/key;
- selecting an API variant directly is a pin/override on the supply target and
  credential endpoint binding, not a separate route graph candidate.

This keeps manual route references stable when a site adds or removes protocol
surfaces.

When a user pins a preferred API variant, the planner treats it as the first
attempt for that supply target. Unless fallback is explicitly disabled, other
compatible variants remain available after the pinned attempt fails with a
variant-recoverable error. Pinning is therefore an execution preference, not a
graph topology change.

Endpoint pickers must always be scoped by site and credential when the user is
editing a concrete supply target. The UI may show disabled/unsupported bindings
for explanation, but selectable endpoint options are only bindings that belong
to the same site/key as the supply target and are currently supported.

## Validation

Compile-time and runtime validation should cover:

- every `route_endpoint endpointKind=supply` resolves to one supply target;
- every enabled resolved supply target has at least one enabled API variant;
- every API variant references a credential endpoint binding with the same
  site and credential as the supply target;
- endpoint pins reference bindings supported by that supply target's key;
- unsupported variants are not planned unless explicitly allowed as emulated;
- request capabilities are satisfiable by at least one planned variant;
- variant fallback does not violate `disable_cross_protocol_fallback`;
- variant cycles or aliases cannot produce duplicate attempts;
- route product duplicate public model checks remain entry-only.

Diagnostics should name the layer:

- `supply_target.unresolved`;
- `api_variant.missing`;
- `api_variant.unsupported_capability`;
- `api_variant.fallback_disabled`;
- `api_attempt.no_supported_variant`;
- `api_attempt.learned_endpoint_mismatch`.

## Migration

No long-term compatibility with old semantic route shapes is required. Existing
runtime settings and endpoint fallback behavior still need to be mapped into the
new model during the implementation transition.

Migration steps:

1. Create a supply target for each existing supply route endpoint.
2. Create site-level endpoint profiles from current platform and compatibility
   settings.
3. Create credential endpoint bindings for each existing key/profile pair.
4. Create API variants from supply targets and enabled credential endpoint
   bindings.
5. Map existing `chat`, `messages`, and `responses` endpoint preferences into
   variant policy.
6. Preserve global settings:
   `disable_cross_protocol_fallback` and
   `responses_compact_fallback_to_responses_enabled`.
7. Recompile route graphs so `select_supply` operations point at supply target
   ids and carry variant summaries.
8. Drop old endpoint-candidate-only persistence once planner execution is
   active.

## Consequences

Positive:

- graph references stay stable and semantic;
- current automatic API fallback becomes explainable and testable;
- variant-specific pricing, health, and capability checks have a natural owner;
- route dispatch can prefer fixing protocol mismatch before abandoning a supply;
- future vendor-native APIs can be added without changing graph node types.

Costs:

- an API variant planner must be introduced and tested against existing
  fallback behavior;
- UI needs a richer supply inspector;
- pricing aggregation must distinguish route candidate probability from variant
  fallback probability;
- migration must carefully preserve current fallback settings.
