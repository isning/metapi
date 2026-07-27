# ADR-0001: Complete The Payload Transformation Boundary

Status: Accepted
Date: 2026-06-14

## Context

Metapi proxies multiple downstream API shapes, including OpenAI Chat, OpenAI
Responses, Anthropic Messages, Gemini GenerateContent, embeddings, images, and
videos. It also routes those requests through different upstream sites,
accounts, runtime executors, endpoint fallback paths, and model-specific
compatibility behavior.

The current direction requires the payload conversion layer to be reliable for
provider-specific features such as DeepSeek reasoning, Anthropic thinking
blocks, OpenAI Responses output items, Gemini thought parts, tool calls, files,
and continuation state. These protocol fields should not leak into routing,
runtime dispatch, billing, or route registration code.

Upstream already has several pieces of this architecture:

- `ProtocolTransformer` describes parse, build, normalize, and serialize
  operations.
- `transformers/canonical/**` provides a canonical request model.
- normalized response and stream event helpers exist under transformer modules.
- route files already delegate most proxy work to proxy-core surfaces.
- `DefaultProxyConductor`, `executeEndpointFlow`, and shared surface helpers
  already capture parts of retry, failover, and bookkeeping.

These pieces are directionally correct, but they do not yet form an enforced
design. The current effective center of gravity is still the surface layer:
surfaces directly import concrete transformers, endpoint compatibility helpers,
runtime-specific stream readers, OAuth/session helpers, debug tracing, billing,
and endpoint fallback behavior. As a result, payload conversion remains too easy
to couple to orchestration and routing.

Metapi's advanced routing is a separate strength and should remain focused on
model-to-channel selection. The payload conversion design must not force a
rewrite of route matching, route-channel priority, weighted selection,
stable-first routing, sticky channel handling, downstream policy checks, health
penalties, cooldowns, or route decision explanations.

This ADR therefore does not introduce a replacement architecture from scratch.
It completes the existing upstream direction by making the payload
transformation boundary explicit and executable.

## Decision

Metapi will make protocol-centered payload transformation the only supported
way for proxy orchestration to parse, build, normalize, or serialize protocol
payloads.

Existing code may keep the upstream implementation names where convenient, such
as `ProtocolTransformer`, canonical request types, and conductor helpers. The
conceptual design, however, is defined by this ADR rather than by historical
file names. If an existing module name or shape is too broad, too shallow, or
couples unrelated behavior, implementation may adapt it instead of preserving
the current shape.

Implementation should avoid unnecessary code churn. If an upstream module
already matches the responsibility and boundary described here, keep it and
build on it. Minimal change is an implementation preference, not a design
constraint: code should not keep an incorrect seam, mixed responsibility, or
leaky abstraction merely to reduce the diff.

The target flow is:

```text
HTTP routes
  -> surface
  -> proxy orchestrator
  -> route selection
  -> protocol adapter
  -> runtime executor
  -> protocol adapter
  -> downstream response
```

Routes only register endpoints. Surfaces convert HTTP requests into proxy jobs.
The proxy orchestrator owns the request attempt loop and calls route selection
for each attempt. Route selection chooses the channel, account, site, token, and
actual model. The proxy orchestrator handles retries, endpoint fallback,
runtime dispatch, billing, logging, debug traces, and stream lifecycle.
Protocol adapters own all payload parsing, upstream request construction,
upstream response normalization, and downstream response serialization.

The current decoupling branch may be used as an implementation source when it
provides cleaner code. Upstream code may also be used when it is already closer
to the intended seam. The merge strategy should be pragmatic, but the resulting
architecture must satisfy the boundaries in this ADR.

## Protocol Adapter Contract

Each protocol will be represented by a protocol adapter. In upstream-facing
implementation, the existing `ProtocolTransformer` interface is the preferred
adapter shape when it is sufficient. A thin wrapper or rename is only warranted
when the current interface cannot express the required boundary. The important
requirement is the seam, not the historical name.

The conceptual shape, equivalent to the existing transformer contract, is:

```ts
interface ProtocolAdapter {
  readonly protocol: ProtocolId;

  parseDownstreamRequest(input: DownstreamRequestInput): ParseResult;

  buildUpstreamRequest(input: BuildUpstreamRequestInput): BuildResult;

  normalizeUpstreamFinal(input: NormalizeFinalInput): NormalizedFinalResponse;

  normalizeUpstreamStreamEvent(input: NormalizeStreamInput): NormalizedStreamEvent;

  serializeDownstreamFinal(input: SerializeFinalInput): unknown;

  serializeDownstreamStreamEvent(input: SerializeStreamInput): string[];
}
```

Protocol adapters may use existing transformer modules internally, but the
orchestrator must only depend on the protocol adapter contract.

The adapter boundary is responsible for both downstream and upstream protocol
shapes. For example, an OpenAI Chat downstream request routed to an Anthropic
Messages upstream must pass through:

```text
OpenAI Chat downstream
  -> canonical request
  -> Anthropic Messages upstream request
  -> normalized upstream response/events
  -> OpenAI Chat downstream response/events
```

No route, routing module, runtime executor, or generic orchestrator should need
to know that `reasoning_content`, `thinking_delta`, or Gemini thought parts are
the concrete protocol names involved.

## Canonical Request And Normalized Response

Cross-protocol conversion must flow through canonical request and normalized
response structures, not direct protocol-to-protocol rewrites.

```text
Downstream protocol
  -> CanonicalRequest
  -> Upstream protocol

Upstream response
  -> NormalizedResponse / NormalizedStreamEvent
  -> Downstream protocol
```

Representative canonical request shape:

```ts
type CanonicalRequest = {
  operation: 'generate' | 'count_tokens' | 'embed' | 'image' | 'video' | 'file';
  surface: ProtocolId;
  cliProfile?: CliProfileId;
  model: string;
  stream: boolean;
  messages?: CanonicalMessage[];
  tools?: CanonicalTool[];
  toolChoice?: CanonicalToolChoice;
  reasoning?: CanonicalReasoning;
  continuation?: CanonicalContinuation;
  responseFormat?: CanonicalResponseFormat;
  files?: CanonicalFile[];
  attachments?: CanonicalAttachment[];
  passthrough?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
```

Representative normalized stream event shape:

```ts
type NormalizedStreamEvent = {
  kind:
    | 'message_start'
    | 'text_delta'
    | 'reasoning_delta'
    | 'tool_call_delta'
    | 'tool_result'
    | 'usage'
    | 'message_stop'
    | 'error';
  index?: number;
  text?: string;
  reasoning?: string;
  toolCall?: NormalizedToolCallDelta;
  usage?: NormalizedUsage;
  finishReason?: string;
};
```

For example, DeepSeek/OpenAI-compatible `reasoning_content`, Anthropic
`thinking_delta`, and Gemini thought parts all normalize to
`reasoning_delta`. The downstream serializer decides whether to emit that as
OpenAI `delta.reasoning_content`, Anthropic `thinking_delta`, Responses
reasoning events, or Gemini thought parts.

## Endpoint Compatibility

Endpoint fallback is not model routing and is not payload conversion. It is
handled by an endpoint strategy owned by proxy orchestration.

The endpoint strategy may ask protocol adapters for alternate upstream request
forms, but the strategy itself must not know protocol field details. It should
reason in terms of endpoint capability and normalized failure categories.

Only chat-style generation endpoints participate in compatibility fallback:

```text
chat <-> messages <-> responses
```

Fixed-operation endpoints do not participate in this fallback group:

```text
embeddings
completions
images
videos
audio
files
```

These fixed operations use their own surface and protocol adapter paths.

This distinction matters for upstream mergeability. The upstream code already
has endpoint compatibility helpers and transformer compatibility modules. The
target is not to delete those concepts, but to place them behind a clear
endpoint strategy so routing and generic orchestration do not grow protocol
special cases.

## Routing Boundary

Routing does not need a broad rewrite. It remains responsible for selecting the
channel for a model request:

```ts
type RouteSelectionInput = {
  requestedModel: string;
  downstreamPolicy: DownstreamRoutingPolicy;
  excludeChannelIds?: number[];
  retryCount?: number;
  stickySessionKey?: string | null;
  forcedChannelId?: number | null;
};
```

The route selector returns:

```ts
type RouteSelection = {
  channelId: number;
  routeId: number | null;
  site: SiteRef;
  account: AccountRef;
  tokenValue: string;
  actualModel: string;
  routeDecision?: RouteDecision;
};
```

Routing must not know downstream endpoints, upstream endpoint fallback,
protocol payload fields, stream event formats, or request/response conversion
rules.

Existing `tokenRouter`, downstream policy, sticky channel, forced channel, and
route decision behavior should be preserved. The routing change requested by
this ADR is negative space: routing must not absorb payload transformation or
endpoint compatibility work.

## Runtime Executor Boundary

Runtime executors only dispatch already-built upstream requests:

```ts
interface RuntimeExecutor {
  dispatch(request: RuntimeRequest): Promise<RuntimeResponse>;
}
```

Runtime executors must not parse downstream payloads or perform protocol
conversion. Platform-specific executors such as HTTP, Codex, Claude OAuth,
Gemini CLI, and Antigravity are implementation details behind this runtime
boundary.

Provider/platform profiles may own platform-specific request preparation,
headers, session hooks, custom stream readers, and OAuth recovery. They must not
become payload transformers. If a platform needs a different upstream protocol
body, the protocol adapter builds that body before runtime dispatch.

## Implementation Relationship To Upstream

This ADR is intended to be implementable on top of upstream rather than as a
fork-only rewrite.

The implementation baseline is upstream `origin/main`, not the current local
decoupling branch. The local branch can be mined for proven fixes, tests, and
cleaner helper implementations, but it should not be merged as a whole. This
keeps upstream merge work reviewable and avoids carrying over half-migrated
surface or format-driver structure.

Upstream concepts to preserve and deepen:

- `ProtocolTransformer` should become, or be wrapped by, the protocol adapter
  seam.
- canonical request types should remain the cross-protocol request model.
- normalized final and stream event types should remain the cross-protocol
  response model.
- route files should remain thin endpoint registration and delegation modules.
- conductor and endpoint flow helpers should remain the home for retry and
  failover mechanics.
- `tokenRouter`, downstream policy, sticky channel, forced channel, and route
  decision behavior should remain the route selection machinery.
- existing billing, usage, debug trace, alerting, and persistence services
  should be reused as orchestration side effects rather than rewritten.
- existing transformer tests should be reused and extended as the main
  regression surface for protocol conversion behavior.

Upstream concepts that should not constrain the design:

- surface modules should not remain the place where every concern meets simply
  because they currently do so.
- a "downstream driver" interface should not collect registration, routing,
  validation, stream lifecycle, response serialization, and channel selection in
  one broad interface.
- provider/platform profiles should not perform protocol payload conversion.
- fixed-operation endpoints should not be forced into the chat compatibility
  fallback model.

When choosing code to port, prefer the implementation that moves behavior
closest to its owning seam, regardless of whether that implementation currently
lives in upstream or in the decoupling branch.

Do not rewrite modules solely to match new terminology. Rename, wrap, or split
only when the existing module shape blocks the design. Conversely, do not
preserve an upstream shape solely because it already exists if that shape would
force protocol conversion, orchestration, routing, or runtime dispatch to stay
coupled.

## Source-Of-Code Decisions

Use upstream `origin/main` as the starting point for implementation.

Reuse from upstream as-is when the existing module already matches this ADR:

- `ProtocolTransformer` and transformer contract types.
- canonical request modules under `transformers/canonical/**`.
- protocol-specific request, response, stream, usage, and aggregator helpers
  inside transformer modules.
- normalized response and stream event types, with targeted extensions when
  required by reasoning, tools, files, continuation, or fixed operations.
- thin route files that delegate proxy work to proxy-core.
- route selection machinery, including `tokenRouter`, downstream policy,
  forced channel, sticky channel, and route decision behavior.
- `executeEndpointFlow` and existing retry/failover primitives where their
  responsibility remains endpoint execution rather than payload conversion.
- billing, usage recovery, debug trace, alerting, OAuth quota, and persistence
  services.

Reuse from upstream with a wrapper, split, or narrowed interface when the
concept is right but the module currently owns too much:

- `DefaultProxyConductor`: keep the conductor concept, but extend or compose it
  into the proxy orchestrator instead of treating the current small retry loop
  as the whole orchestrator.
- shared surface helpers: keep sticky-channel, lease, dispatch, success,
  failure, billing, and OAuth helper behavior, but prevent `sharedSurface` from
  becoming the long-term owner of every orchestration concern.
- provider profiles: keep platform request preparation, headers, session hooks,
  custom runtime readers, and OAuth recovery there; do not move protocol body
  conversion there.
- endpoint compatibility helpers: keep the rules, but expose them through an
  endpoint strategy so routing and generic orchestration do not inspect
  protocol fields.
- upstream request builder code: reuse safe header, endpoint, and platform
  preparation logic, but move protocol body conversion behind protocol
  adapters.

Do not reuse these shapes as implementation targets:

- the current upstream shape where `chatSurface`, `openAiResponsesSurface`, or
  `geminiSurface` directly coordinate protocol conversion, endpoint fallback,
  runtime-specific stream handling, OAuth/session behavior, billing, debug
  traces, and route selection in one module.
- the local decoupling branch's large `genericSurface` as a whole.
- broad downstream-driver or format-driver interfaces that combine route
  registration, request parsing, validation, stream lifecycle, response
  serialization, channel selection, and runtime behavior.
- any design where provider/platform profiles perform protocol payload
  conversion.
- any design where fixed-operation endpoints participate in the
  `chat <-> messages <-> responses` compatibility fallback group.

Mine the local decoupling branch selectively for:

- concrete reasoning/thinking conversion fixes.
- tests that capture OpenAI-compatible `reasoning_content`, Anthropic
  `thinking_delta`, Responses reasoning events, and Gemini thought parts.
- platform/header/session/runtime helpers that are cleaner than the upstream
  equivalent and still respect the runtime boundary.
- small adapter or registry code that can be applied without importing the
  broad local format-driver shape.

Do not mine the local decoupling branch for:

- wholesale surface replacement.
- wholesale format-driver replacement.
- changes that move routing, billing, debug persistence, or runtime dispatch
  into protocol format modules.

## Consequences

- Payload conversion bugs become local to protocol adapters and transformer
  modules.
- Proxy orchestration can evolve without knowing protocol-specific fields.
- Advanced routing can remain stable and independent from payload conversion.
- Endpoint fallback can be reasoned about separately from model routing and
  transformer behavior.
- New protocols can be added by implementing a surface plus protocol adapter,
  instead of editing route, orchestration, routing, and runtime code together.
- The migration can be incremental: OpenAI Chat and Anthropic Messages should
  be adapted first, followed by Responses, Gemini, and fixed-operation
  endpoints.
- Upstream merge work can be split into small reliability and boundary PRs
  instead of one large architectural replacement PR.

## Guardrails

- `routes/**` must not import protocol transformers.
- Routing modules must not import protocol transformers or runtime executors.
- Runtime executors must not import protocol transformers.
- The proxy orchestrator may call payload conversion only through the protocol
  adapter/transformer seam.
- Protocol adapters and protocol transformers must not import Fastify, token
  routing, billing, persistence, or runtime dispatch modules.
- Endpoint strategy must handle endpoint capability and fallback only; it must
  not inspect protocol payload fields beyond normalized capability hints.
- Upstream compatibility policy inheritance and resolution belongs to routing
  compilation or endpoint selection. Protocol transformers may execute a
  resolved policy, but they must not discover policy from sites, tokens, route
  graph nodes, or model-name heuristics.
- Surface modules must not be the long-term owner of protocol conversion,
  endpoint fallback policy, platform runtime behavior, billing, and debug trace
  persistence at the same time.
- New reasoning, thinking, tool-call, file, or continuation behavior must be
  tested at the protocol adapter/transformer seam before being exposed through
  proxy orchestration.
