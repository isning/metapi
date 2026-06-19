# ADR-0002: Graph-Native Model Routing

Status: Proposed
Date: 2026-06-15

## Context

Metapi already has several routing concepts:

- pattern routes match requested model names with exact, glob, and safe `re:`
  regex patterns;
- explicit group routes expose a public display name and aggregate source
  routes;
- route channels bind accounts, tokens, upstream models, priority, weight,
  cooldown, and runtime health;
- payload rules can inject, override, or remove payload fields.

These features solve related problems, but they are not one architecture.
Pattern routes, groups, channel selection, payload mutation, health-aware
failover, and provider compatibility rules currently risk becoming separate
control paths.

The long-term architecture must let operators express all routing behavior as a
single graph:

```text
public model entry
  -> request/filter transforms
  -> dispatcher policy
  <- model_endpoint[] / synthetic_endpoint[] candidate resources
  -> selected terminal or flow execution
  -> response
```

The graph must also support future provider quirks such as reasoning/thinking
payload injection, model suffix rewrites, synthetic 429/503 endpoints, and
metadata-driven dispatch without hardcoding model names or provider branches in
protocol transformers.

## Decision

Metapi will use a **graph-native model routing architecture**.

The core abstraction is:

```text
Route Graph = typed nodes + typed ports + pure edges + compiled runtime plan
```

The final node vocabulary is:

```ts
type RouteGraphNode =
  | EntryNode
  | FilterNode
  | DispatcherNode
  | ModelEndpointNode
  | SyntheticEndpointNode
  | AutoNode;
```

The previous `route_ref`, `route_query`, `routes`, and `channel_pool` concepts
are not final runtime concepts:

- `route_ref` is removed. Graph node IDs and port edges are the reference
  mechanism.
- `route_query` is removed. Querying and candidate selection are represented by
  explicit route-mode `dispatcher` policy over connected `model_endpoint[]`
  inputs.
- `routes` candidate flow is removed. Candidate resources are
  `model_endpoint[]`.
- `channel_pool` is replaced by `model_endpoint`. A model endpoint is a
  user-facing terminal resource abstraction, not a low-level channel bucket.

Protocol transformers remain protocol-pure. They must not import route graph
runtime modules, Fastify route adapters, token routing services, or provider
policy logic.

## Core Semantics

### Entry

`entry` is a public or internal ingress node. Public entries are the only graph
nodes that may appear as downstream model names.

```text
entry.bidirect.out -> filter.bidirect.in | dispatcher.bidirect.in
```

Entry nodes own model matching:

```ts
type EntryNode = BaseRouteGraphNode & {
  type: 'entry';
  visibility: 'public' | 'internal';
  match: RouteMatchSpec;
};
```

Public model names must be globally unique across manual and generated entries.

### Filter

`filter` mutates request or response state. It does not select endpoints.

Filters may be request-only or bidirectional:

```text
filter.request.in  -> filter.request.out
filter.bidirect.in -> filter.bidirect.out
```

Examples:

- rewrite model suffixes;
- inject or remove payload fields;
- set headers;
- map reasoning/thinking fields;
- normalize tool choice;
- transform response metadata.

```ts
type FilterNode = BaseRouteGraphNode & {
  type: 'filter';
  flow: 'request' | 'bidirect';
  operations: RouteFilter[];
};
```

`filter` may read graph state and configured metadata, but any behavior that
affects routing must be expressed in a downstream `dispatcher` policy.

### Model Endpoint

`model_endpoint` is a candidate executable model resource. It does not dispatch
between other graph nodes.

It can represent one or more concrete upstream targets:

```ts
type ModelEndpointNode = BaseRouteGraphNode & {
  type: 'model_endpoint';
  metadata?: Record<string, unknown>;
  config: {
    targets: ModelEndpointTarget[];
    targetSelection?: TargetSelectionPolicy;
  };
};

type ModelEndpointTarget = {
  channelId: string;
  model: string;
  tokenId?: string;
  accountId?: string;
  siteId?: string;
  weight?: number;
  priority?: number;
  compatibilityPolicy?: UpstreamCompatibilityPolicy;
  metadata?: Record<string, unknown>;
};
```

`model_endpoint` may choose among its own `targets[]` using local execution
metadata such as priority, weight, availability, and credential state. It must
not silently jump to another graph endpoint or implement cross-endpoint
fallback policy.

`targetSelection.strategy: 'defer_to_router'` is reserved for graph projections
that should preserve candidate multiplicity for downstream token routing. In
that mode the graph still terminates at `model_endpoint`, but it does not
collapse `targets[]` to a single concrete target. Legacy projections use this
mode so the router can keep applying health, cost, and stable-first policy
over the underlying channels.

Custom metadata is first-class:

```json
{
  "type": "model_endpoint",
  "id": "endpoint.deepseek.reasoning",
  "label": "DeepSeek Reasoning",
  "metadata": {
    "vendor": "deepseek",
    "tier": "premium",
    "region": "sg",
    "qualityScore": 0.94,
    "supportsReasoning": true
  },
  "config": {
    "targets": [
      {
        "channelId": "deepseek-main",
        "model": "deepseek-reasoner",
        "weight": 100,
        "metadata": {
          "tokenPool": "reasoning-a",
          "costRank": 2
        }
      }
    ]
  }
}
```

Model endpoints also carry upstream compatibility policy. This policy is not a
router and is not provider-specific transformer code. It is declarative metadata
compiled with the selected endpoint and handed to the protocol request builder
as a resolved policy.

### Upstream Compatibility Policy

Some OpenAI-compatible upstreams support structured reasoning history through
`reasoning_content`; others only preserve reasoning when it is embedded in the
assistant `content` as `<think>...</think>`. Claude, Responses, and Gemini use
their own native reasoning/thinking carriers. These differences are endpoint
compatibility concerns, not routing concerns and not model-name branches.

Metapi will model them with an inherited **Upstream Compatibility Policy**:

```ts
type ReasoningHistoryTransportMode =
  | 'native'
  | 'content_think_tag'
  | 'drop';

type UpstreamCompatibilityPolicy = {
  reasoningHistory?: {
    transport?: {
      mode?: ReasoningHistoryTransportMode | null;
      maxReasoningBytes?: number | null;
      overflow?: 'truncate' | 'drop' | null;
      thinkTag?: {
        openTag?: string | null;
        closeTag?: string | null;
        separator?: string | null;
      } | null;
      applyTo?: {
        assistantHistory?: boolean | null;
        assistantToolCalls?: boolean | null;
        responseContinuation?: boolean | null;
      } | null;
      toolCallMessageBehavior?:
        | 'same_as_assistant'
        | 'native'
        | 'drop'
        | null;
    } | null;
  } | null;

  payloadDefaults?: Array<{
    path: string;
    value: unknown;
    mode?: 'default' | 'override';
  }> | null;

  requestTransforms?: Array<{
    id: string;
    type: string;
    config: Record<string, unknown>;
  }> | null;
};
```

The resolved runtime shape is total and contains no inheritance markers:

```ts
type ResolvedUpstreamCompatibilityPolicy = {
  reasoningHistory: {
    transport: {
      mode: 'native' | 'content_think_tag' | 'drop';
      maxReasoningBytes: number;
      overflow: 'truncate' | 'drop';
      thinkTag: {
        openTag: string;
        closeTag: string;
        separator: string;
      };
      applyTo: {
        assistantHistory: boolean;
        assistantToolCalls: boolean;
        responseContinuation: boolean;
      };
      toolCallMessageBehavior:
        | 'same_as_assistant'
        | 'native'
        | 'drop';
    };
  };
  payloadDefaults: ResolvedPayloadOperation[];
  requestTransforms: ResolvedRequestTransform[];
};
```

#### Reasoning History Transport

`native` is the default. It means "encode the canonical reasoning history using
the selected upstream protocol's structured carrier":

- OpenAI-compatible Chat: assistant `reasoning_content`;
- Anthropic Messages: `thinking` blocks;
- OpenAI Responses: `reasoning` items;
- Gemini Generate Content: thought/thinking metadata where the upstream
  protocol supports it.

`content_think_tag` means "encode canonical reasoning history inside ordinary
assistant content":

```json
{
  "role": "assistant",
  "content": "<think>\ninternal reasoning\n</think>\n\nvisible answer"
}
```

This mode exists for self-hosted or wrapper-based upstreams that do not preserve
structured reasoning fields but do honor `<think>` prompt history. It must be
opt-in because it deliberately moves internal reasoning into visible content
history.

`drop` means "do not send historical reasoning to the selected upstream":

```json
{
  "role": "assistant",
  "content": "visible answer"
}
```

This mode is useful when crossing trust boundaries, reducing prompt cost, or
using upstreams that reject reasoning history.

Historical reasoning is bounded before it is injected into upstream request
history. `maxReasoningBytes` is a high safety limit, expressed in UTF-8 bytes,
and `overflow` decides whether excess history is truncated or dropped. This is
part of compatibility policy because different upstreams tolerate different
history sizes, and it prevents a client from forcing unbounded server-side
prompt assembly.

`passthrough` is intentionally not part of the first-class policy. Preserving
raw client carrier shape requires raw-message lineage across protocol
conversion, route graph filters, and endpoint fallback. That would make the
runtime interface less deterministic. If raw lineage is needed later, it must be
introduced as an explicit advanced feature with separate storage and tests, not
as implicit transformer behavior.

`toolCallMessageBehavior` handles assistant messages that contain tool calls:

- `same_as_assistant`: apply the configured transport to tool-call assistant
  messages as well;
- `native`: force structured reasoning for tool-call assistant messages, even
  when normal assistant messages use `<think>`;
- `drop`: omit reasoning for tool-call assistant messages.

The default is `same_as_assistant`. Operators can set `native` or `drop` for
upstreams whose tool-call parser is sensitive to `<think>` prefixes.

#### Inheritance

Compatibility policy is inherited from broad defaults to precise endpoint
overrides:

```text
global default
  -> protocol default
  -> site default
  -> account/token default
  -> model endpoint default
  -> route graph node override
```

Merge rules:

- scalar fields override;
- object fields deep-merge;
- arrays append by default;
- a future array entry may specify `strategy: 'replace'` if replacement is
  needed;
- `null` explicitly clears an inherited value;
- omitted fields inherit.

The compiler resolves this stack before runtime execution. Transformers and
protocol adapters receive only `ResolvedUpstreamCompatibilityPolicy`.

Example: a self-hosted vLLM site can default all OpenAI-compatible Chat targets
to `<think>` history while a specific official DeepSeek endpoint overrides back
to structured reasoning:

```json
{
  "site": {
    "reasoningHistory": {
      "transport": {
        "mode": "content_think_tag"
      }
    }
  },
  "modelEndpoint": {
    "reasoningHistory": {
      "transport": {
        "mode": "native"
      }
    }
  }
}
```

#### Execution Boundary

Policy resolution belongs to graph compilation and upstream endpoint selection.
Policy execution belongs to the protocol request builder. The builder may apply
the resolved transport when converting canonical assistant history to the
selected upstream protocol.

The following are forbidden:

- `if model.includes('qwen')` or `if model.includes('deepseek')` carrier
  branches in protocol transformers;
- route handlers deciding whether to use `<think>` or `reasoning_content`;
- token router selection mutating reasoning history transport;
- graph filters silently changing transport mode without representing that
  mutation as policy metadata.

The following are allowed:

- a graph filter setting or overriding compatibility policy metadata;
- a site/account/model endpoint storing default compatibility policy;
- a model endpoint target overriding inherited compatibility policy for one
  concrete target;
- a protocol request builder encoding canonical reasoning history according to
  the resolved policy.

#### UI Requirements

The route and endpoint editors must expose compatibility policy as inherited
configuration, not as duplicated per-form fields.

Recommended UI model:

- site settings: "Compatibility defaults";
- account/token settings: "Override site compatibility";
- model endpoint inspector: "Endpoint compatibility";
- route graph filter: "Set compatibility policy";
- compiled preview: show the resolved policy for each candidate endpoint;
- route trace: show which layer supplied each resolved field.

For `reasoningHistory.transport.mode`, the editor should present:

- `Native structured fields` (`native`);
- `Content <think> tags` (`content_think_tag`);
- `Drop reasoning history` (`drop`).

The UI must warn when `content_think_tag` is selected because internal reasoning
will be inserted into assistant content history.

Metadata is allowed at node, target, edge, and graph levels. Metadata must not
implicitly change behavior. Any behavior that reads metadata must be declared
in a dispatcher or target-selection policy.

### Dispatcher

`dispatcher` is the single policy-driven choice node in the graph. It has two
roles, controlled by `mode`:

```ts
type DispatcherNode = BaseRouteGraphNode & {
  type: 'dispatcher';
  mode: 'route' | 'flow';
  config: {
    policy: DispatcherPolicy;
  };
};
```

The policy engine is shared. It receives:

```text
payload
metadata
idx
stateStore
graph context
runtime stats
candidate-local fields
```

It can operate in either of two evaluation forms:

```ts
type DispatcherPolicy =
  | {
      strategy: 'priority_order' | 'weighted' | 'round_robin' | 'stable_first';
      score?: DispatcherScoreInput[];
      fallback?: FallbackPolicy;
    }
  | {
      strategy: 'direct';
      select: string;
      fallback?: FallbackPolicy;
    };
```

In `route` mode, the dispatcher consumes:

```text
entry/filter.bidirect.out -> dispatcher.bidirect.in
model_endpoint.route.out[] | synthetic_endpoint.route.out[] -> dispatcher.route.in
```

`route` mode is a terminal route chooser. It selects one terminal candidate and
terminates the bidirect flow at that candidate. Its job is to decide the final
endpoint, not to produce another graph hop.

In `flow` mode, the dispatcher consumes:

```text
dispatcher.bidirect.in
dispatcher.bidirect[1...].out
```

`flow` mode is a bidirect path dispatcher. It chooses one ordered downstream
bidirect edge and continues the request/response lifecycle to the next node.

The same candidate evaluation model applies in both modes:

- `priority_order`, `weighted`, `round_robin`, `stable_first` are rank-based;
- `direct` is index-based and returns a selected `idx` directly from CEL;
- custom CEL expressions may read candidate metadata, payload, state store,
  runtime statistics, and candidate index;
- `route` mode candidates may expose metadata;
- `flow` mode candidates may expose per-output static metadata such as label,
  weight, and priority, but not endpoint metadata.

Rank-based policies evaluate each candidate independently. The CEL expression
receives one candidate at a time and may return any subset of:

```ts
type DispatcherRankResult = {
  enabled?: boolean;
  weight?: number;
  priority?: number;
  score?: number;
};
```

Direct policies evaluate once and return an integer candidate index:

```ts
type DispatcherDirectResult = {
  idx: number;
};
```

The CEL context shape is stable across modes:

```ts
type DispatcherCelContext = {
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  stateStore: Record<string, unknown>;
  idx: number;
  candidate: {
    idx: number;
    kind: 'route' | 'bidirect';
    metadata: Record<string, unknown>;
    weight?: number;
    priority?: number;
    enabled?: boolean;
    runtime?: Record<string, unknown>;
  };
  candidates: Array<{
    idx: number;
    kind: 'route' | 'bidirect';
    metadata: Record<string, unknown>;
    weight?: number;
    priority?: number;
    enabled?: boolean;
    runtime?: Record<string, unknown>;
  }>;
};
```

In `route` mode, `candidate.metadata` comes from the connected
`model_endpoint`, `synthetic_endpoint`, target metadata, edge metadata, and
computed runtime health. In `flow` mode, `candidate.metadata` comes only from
the indexed output configuration and edge metadata. Flow-mode bidirect
candidates must not inherit endpoint metadata by implication.

Example ranked route dispatcher:

```json
{
  "type": "dispatcher",
  "id": "dispatcher.reasoning",
  "mode": "route",
  "config": {
    "policy": {
      "strategy": "weighted",
      "score": [
        { "source": "candidate.metadata.qualityScore", "weight": 0.5 },
        { "source": "candidate.runtime.successRate", "weight": 0.3 },
        { "source": "candidate.runtime.latencyP95", "weight": -0.15 },
        { "source": "candidate.metadata.costRank", "weight": -0.05 }
      ]
    }
  }
}
```

Example direct flow dispatcher:

```json
{
  "type": "dispatcher",
  "id": "dispatcher.pipeline",
  "mode": "flow",
  "config": {
    "policy": {
      "strategy": "direct",
      "select": "payload.force_idx != null ? int(payload.force_idx) : 0"
    }
  }
}
```

This keeps the routing language small: one node type, two modes, one policy
engine, one CEL model.

### Synthetic Endpoint

`synthetic_endpoint` is an executable endpoint that does not call an upstream
provider. It returns a configured response, usually for deny, overload,
maintenance, quota, or test flows.

```ts
type SyntheticEndpointNode = BaseRouteGraphNode & {
  type: 'synthetic_endpoint';
  config: {
    statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;
    message: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
};
```

It exposes the same route candidate port as `model_endpoint`, so route-mode
dispatchers can include it in fallback policy:

```text
synthetic_endpoint.route.out -> dispatcher.route.in
```

## Ports And Edges

Edges connect typed ports, never whole nodes.

```ts
type RouteGraphPortKind =
  | 'request'
  | 'bidirect'
  | 'route'
  | 'response'
  | 'control'
  | 'metrics';

type RouteGraphPort = {
  id: string;
  label: string;
  direction: 'input' | 'output';
  kind: RouteGraphPortKind;
  accepts?: RouteGraphPortKind[];
  required?: boolean;
  multiple?: boolean;
  collection?: RouteGraphPortCollection;
  readonly?: boolean;
};

type RouteGraphPortCollection =
  | { type: 'single' }
  | { type: 'arr'; min?: number; max?: number }
  | { type: 'set'; min?: number; max?: number };

type RouteGraphEdge = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  kind: RouteGraphEdgeKind;
  ownership: RouteGraphOwnership;
  metadata?: Record<string, unknown>;
};
```

Default ports:

```text
entry:
  bidirect.out

filter:
  request.in
  request.out
  bidirect.in
  bidirect.out

model_endpoint:
  route.out

synthetic_endpoint:
  route.out

dispatcher:
  bidirect.in
  bidirect[1...].out
  route.in      accepts route, set
```

`dispatcher` is the single policy-driven choice node. Its `mode` determines the
candidate domain:

- `mode: 'route'` consumes `route.in` candidates and terminates at a selected
  `model_endpoint` or `synthetic_endpoint`;
- `mode: 'flow'` consumes ordered `bidirect[1...].out` candidates and continues
  the bidirectional path.

Mode controls runtime relevance:

- in `mode: 'route'`, `bidirect[1...].out` is ignored for compilation,
  validation, runtime candidate evaluation, and traces;
- in `mode: 'flow'`, `route.in` is ignored for compilation, validation,
  runtime candidate evaluation, and traces.

Editors may still display both port families when the user is designing a node,
but diagnostics and compiled plans must only use the active port family for the
selected mode.

`route.in` is the graph-native candidate input for route-mode dispatch. It is
not legacy `route_ref` or a persisted route table row.

`arr` means an ordered multi-value parameter or port. Order must be preserved
by validation, compiler, runtime, and trace output. `bidirect[1...].out` is an
`arr` with `min: 1` and no upper bound.

Both `arr` input ports and `arr` output ports can be used in two connection
forms:

1. whole-value passing, where the array is treated as one connected value;
2. split pin passing, where each item is exposed as an indexed pin and connected
   separately.

Both forms are explicit. The compiler must know whether a connection is using
the whole array or individual indexed pins on both the source and target sides.

`set` means an unordered multi-value parameter or port. Duplicate values are not
semantically significant. `route.in` is a `set`.

`single` means a single logical value or a single connection target.

`arr` and `set` may declare `min` and `max` bounds. A bounded set such as
`set(max: 4)` accepts at most four unique values. A bounded array such as
`arr(min: 1, max: 3)` accepts one to three ordered values. Validators, editors,
the compiler, import/export, and runtime traces must all enforce the same
bounds.

When an `arr` is split into indexed pins, the split form must still obey the
same `min/max` bounds, and pin order must be stable. This applies equally to
split input pins and split output pins.

## Pin Visual Semantics

Pin rendering must follow the base type system.

`kind` controls semantic color:

- `request`
- `bidirect`
- `route`
- `response`
- `control`
- `metrics`

`collection` controls circle treatment:

- `single`: solid circle, no stroke;
- `arr`: circle with white stroke;
- `set`: circle with dashed stroke.

Expanded `arr` pins are rendered as `single` pins in the collapsed visual
state. Their split representation uses indexed pins, but the expanded display
must remain visually aligned with `single`.

Type color and circle style are not decorative-only hints. They are part of the
graph's base visual language and must stay consistent across graph editor,
inspector, trace view, and any route preview surfaces.

`fallback` is not an input port kind. Fallback is a dispatcher policy outcome
over route candidates.

If an output port supports multiple outgoing connections, its label should use
a plural noun and show `[...]`. Input ports may accept multiple incoming edges
without adding `[...]` to the label.

## Request, Bidirect, And Response Flow

`request` means request-only transformation.

`bidirect` means request plus response lifecycle. A bidirect edge carries the
request into a node that may also observe or transform the response on the way
back.

Reasoning/thinking transfer is response metadata on a bidirect flow, not a
separate route category. A reasoning view in the UI may highlight bidirect
edges and show response metadata, but it must not create a separate runtime
graph language.

## Graph State

Runtime evaluation carries explicit state:

```ts
type RouteGraphState = {
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  downstreamProtocol: ProtocolId;
  upstreamProtocol?: ProtocolId;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  metadata: Record<string, unknown>;
};
```

`requestedModel` is immutable. `currentModel` may be rewritten by filters.
`upstreamModel` is the selected model passed to upstream request construction
unless the selected endpoint target has a more specific model.

## Matching

All route-like model matching uses one pattern language:

- exact literal;
- glob with `*` and `?`;
- safe `re:` regex.

There must not be a second model pattern language. Existing token route matcher
semantics remain the single source of truth for model pattern matching.

## Semantic Graph Lowering

Metapi has two graph IRs:

```text
SemanticRouteGraph
  -> lowering pipeline
PrimitiveRouteGraph
  -> compiler
ExecutableRoutePlan
```

`PrimitiveRouteGraph` is the only graph form consumed by the compiler and
runtime. It contains only primitive nodes, primitive ports, and primitive
edges.

`SemanticRouteGraph` is the graph form authored by humans, UI flows, importers,
and automatic builders. It may contain primitive graph objects plus high-level
macros. A macro is a user-facing routing intent that lowers to one or more
primitive nodes and edges before compilation.

The term **lowering** is intentional. Macros are not runtime annotations and are
not a parallel router. They are a higher-level IR that is deterministically
lowered into the primitive IR.

```ts
type SemanticRouteGraph = {
  version: 1;
  primitives: {
    nodes: RouteGraphNode[];
    edges: RouteGraphEdge[];
  };
  macros: RouteGraphMacro[];
  metadata?: Record<string, unknown>;
};

type PrimitiveRouteGraph = {
  version: 1;
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  metadata?: Record<string, unknown>;
};

type RouteGraphMacro = {
  id: string;
  kind: string;
  enabled: boolean;
  visibility: 'public' | 'internal';
  ownership: 'manual' | 'auto_generated' | 'system';
  name?: string;
  config: unknown;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
};
```

Macros must not be encoded as fake primitive node types. This keeps primitive
validation strict and prevents macro semantics from leaking into runtime.

The lowering pipeline is:

```text
normalize semantic graph
  -> validate semantic macros
  -> expand macros
  -> merge manual primitives and derived primitives
  -> validate primitive graph
  -> compile executable plan
```

Each macro kind is owned by one processor:

```ts
type RouteGraphMacroProcessor<TConfig = unknown> = {
  kind: string;
  version: number;

  normalizeConfig(input: unknown): TConfig;

  validate(input: {
    macro: RouteGraphMacro;
    config: TConfig;
    source: SemanticRouteGraph;
  }): RouteGraphDiagnostic[];

  expand(input: {
    macro: RouteGraphMacro;
    config: TConfig;
    source: SemanticRouteGraph;
  }): {
    nodes: RouteGraphNode[];
    edges: RouteGraphEdge[];
    diagnostics: RouteGraphDiagnostic[];
  };
};
```

Processor requirements:

- processors are pure functions;
- processors do not read or write the database;
- processors do not inspect runtime mutable state;
- processors do not mutate the input semantic graph;
- equal semantic input produces equal primitive output;
- processors may emit diagnostics but may not silently drop invalid intent;
- processors may generate only primitive nodes and edges;
- generated IDs must be stable and deterministic;
- generated primitives must carry provenance;
- generated primitives default to `ownership: 'derived'` unless the processor
  explicitly declares `system` ownership for built-in guardrails.

Generated node and edge provenance is mandatory:

```ts
type RouteGraphProvenance =
  | { source: 'manual' }
  | { source: 'legacy'; routeId: number }
  | {
      source: 'macro';
      macroId: string;
      macroKind: string;
      role: string;
    };
```

For macro-derived primitives:

```json
{
  "provenance": {
    "source": "macro",
    "macroId": "group.claude-opus",
    "macroKind": "candidate_selector",
    "role": "dispatcher"
  }
}
```

Edges also carry candidate-local metadata when the macro expresses candidate
ordering:

```json
{
  "metadata": {
    "provenance": {
      "source": "macro",
      "macroId": "group.claude-opus",
      "macroKind": "candidate_selector",
      "role": "candidate_edge"
    },
    "candidate": {
      "routeId": 11,
      "enabled": true,
      "weight": 10,
      "priority": 0
    }
  }
}
```

The editor must treat macro-derived primitives as read-only. Editing a derived
entry, dispatcher, endpoint, or edge must route the user to the source macro
editor instead of saving a primitive mutation. Expanded primitive views are for
inspection, traceability, and diagnostics.

### Candidate Selector Macro

`candidate_selector` is the semantic selection macro. It is the generic
priority-banded candidate selection primitive that can be used for model group
presets, internal flow routing, provider aggregation, fallback composition, and
future selection surfaces.

The user-facing preset name for the common public-model case is **Model Group**.
`Model Group` is not a legacy label. It is a first-class preset of the generic
selector macro.

```ts
type CandidateSelectorMacroConfig = {
  surface: {
    entry:
      | {
          kind: 'external';
          visibility: 'public' | 'internal';
          match: RouteMatchSpec;
        }
      | {
          kind: 'embedded';
          input: 'request' | 'bidirect';
        };
    output: 'route' | 'bidirect';
  };
  policy: {
    strategy:
      | 'priority_order'
      | 'weighted'
      | 'round_robin'
      | 'stable_first'
      | 'cel_select'
      | 'cel_score';
    cel?: string;
  };
  groups: Array<{
    id: string;
    label?: string;
    enabled: boolean;
    priority: number;
    input:
      | { kind: 'route_ids'; routeIds: number[] }
      | { kind: 'model_pattern'; pattern: string }
      | { kind: 'metadata_query'; cel: string }
      | { kind: 'endpoint_query'; cel: string }
      | { kind: 'inline_endpoints'; endpoints: ModelEndpointTarget[] }
      | { kind: 'synthetic'; statusCode: number; message: string };
    defaults?: {
      enabled?: boolean;
      weight?: number;
      priority?: number;
      metadata?: Record<string, unknown>;
    };
    materialization?: {
      sort?:
        | 'route_id'
        | 'model_name'
        | 'health'
        | 'cel';
      limit?: number;
      dedupeBy?: 'route_id' | 'endpoint_id' | 'model' | 'metadata';
    };
    metadata?: Record<string, unknown>;
  }>;
  presentation?: {
    displayIcon?: string | null;
  };
};
```

Candidate group semantics:

- `groups[]` are priority bands, not merely a flat candidate list;
- each group may resolve candidates by route IDs, patterns, CEL, endpoint
  metadata, inline endpoints, or synthetic fallback definitions;
- `priority` is band ordering and controls lowering order;
- `defaults` are applied to resolved candidates unless overridden by the
  resolver result;
- `enabled: false` preserves the configured band for later re-enable while
  excluding it from lowering;
- UI drag ordering should reorder bands and/or resolved rows depending on the
  active editor surface, but it must always materialize an explicit `priority`
  in the authored semantic graph.

The `candidate_selector` processor lowers one macro into primitive graph
elements appropriate to the selected surface:

```text
external public entry
  -> dispatcher(mode: 'route')
  -> model_endpoint[] / synthetic_endpoint[] candidate adapters

embedded selector
  -> dispatcher(mode: 'flow' | 'route')
  -> primitive candidate adapters
```

Stable ID scheme:

```text
macro:<macroId>:entry
macro:<macroId>:dispatcher
macro:<macroId>:group:<groupId>
macro:<macroId>:candidate:<groupId>:<candidateId>
macro:<macroId>:edge:entry-dispatcher
macro:<macroId>:edge:group:<groupId>
macro:<macroId>:edge:candidate:<groupId>:<candidateId>
```

The generated entry visibility follows `surface.entry.visibility`. External
public entries appear in downstream model lists; external internal entries are
editable and callable inside the graph but not exposed as public downstream
models.

Candidate adapter `model_endpoint` nodes use `targetSelection.strategy:
'defer_to_router'` when they reference legacy/projection route channels. This
preserves the source route's internal channel-level health, cooldown, stable
selection, weight, and priority behavior while the selector dispatcher makes
only the higher-level candidate choice.

### Model Group Preset

`Model Group` is the user-facing preset for `candidate_selector` with an
external entry. It is the canonical replacement for the old grouped-route
editing experience, but it is not a legacy-only concept.

Legacy explicit group data maps to this preset as follows:

```text
token_routes row for group
  -> candidate_selector macro shell

route_group_sources rows
  -> candidate_selector.groups[].input when the source is route-id based

token_routes.displayName / graph match.displayName
  -> candidate_selector.surface.entry.match.displayName

token_routes.routingStrategy
  -> candidate_selector.policy.strategy

token_routes.displayIcon
  -> candidate_selector.presentation.displayIcon
```

Legacy `route_group_sources` did not store group-local weight or priority.
During migration:

```ts
groups = sourceRouteIds.map((routeId, index) => ({
  id: `source:${routeId}`,
  enabled: true,
  priority: index,
  input: {
    kind: 'route_ids',
    routeIds: [routeId],
  },
  defaults: {
    weight: 10,
    priority: index,
    enabled: true,
  },
}));
```

If a newer legacy database already contains ordered source rows, the preserved
source order becomes the initial `priority`. Channel-level priority and weight
remain inside each source route and must not be copied into group-local
candidate fields.

This preset makes the previous list-page behavior first-class again:

- the list/wizard editor edits `candidate_selector.groups`;
- drag-and-drop reorders priority bands and updates semantic priority;
- per-candidate weight and enabled state are edited on the resolved candidate
  rows when a group is materialized;
- the graph expanded view shows the lowered entry, dispatcher, candidate
  adapters, and candidate edges as derived, read-only primitives;
- runtime still receives only the lowered primitive graph.

The old graph facade:

```ts
backend: { kind: 'routes'; routeIds: number[] }
```

is a compatibility projection over `candidate_selector.groups`. It is not the
canonical semantic representation once macro support exists.

## Compilation

The graph compiler produces a bounded executable plan.

The compiler must reject:

- unknown node types;
- unknown static or dynamic ports;
- input-to-input or output-to-output edges;
- incompatible port kinds;
- missing required inputs;
- duplicate public model names;
- cycles;
- dangling edges;
- mutation of non-manual nodes through manual edits;
- public entries that cannot reach an active dispatcher path;
- route-mode dispatchers without route candidates;
- flow-mode dispatchers without at least one bidirect output;
- model endpoints without executable targets, unless explicitly marked disabled
  or synthetic.

Compilation starts from public `entry` nodes and follows typed port edges. A
valid public route must reach a dispatcher whose active mode is satisfiable:
`mode: 'route'` requires at least one connected route candidate, while
`mode: 'flow'` requires at least one connected bidirect output.

## Automatic Route Construction

Automatic route construction is a semantic graph producer, not a parallel
router.

```text
model availability + accounts + tokens + presets
  -> automatic route builder
  -> semantic route graph source
  -> lowering pipeline
  -> primitive route graph
  -> compiler
  -> executable plan
```

Automatic builders should generate macros when the operator-facing concept is
semantic, and primitive nodes when the concept is already primitive.

Generated primitive nodes must use the same final node vocabulary:

- discovered public model -> `entry`;
- discovered executable target -> `model_endpoint`;
- generated route selection policy -> `dispatcher(mode: 'route')`;
- generated bidirectional composition -> `dispatcher(mode: 'flow')`;
- provider compatibility preset -> `filter`;
- maintenance/quota fallback -> `synthetic_endpoint`.

Generated objects must carry ownership:

```ts
type RouteGraphOwnership =
  | 'manual'
  | 'auto_generated'
  | 'system'
  | 'derived';
```

Only `manual` objects are editable in normal graph/list/JSON editors.
`auto_generated` objects may be refreshed by rebuild. `system` objects are
built-in guardrails or presets. `derived` objects are compiler output and
runtime traces.

Manual drafts must not be overwritten silently by automatic rebuilds. If an
automatic rebuild creates new generated model endpoints, the system may add
them as read-only route candidate resources, but conflicts with manual edits
must be shown as draft conflicts before publish.

## Legacy Migration

Legacy pattern routes and explicit groups are migration inputs only.

Migration target:

```text
legacy token_routes / route_group_sources / route_channels
  -> semantic route graph macros and primitives
  -> lowering pipeline
  -> entry / filter / dispatcher / model_endpoint / synthetic_endpoint graph
```

Mapping:

- legacy exact or pattern route -> route-like semantic object, or directly to
  public `entry` + route-mode `dispatcher` + `model_endpoint` when no higher
  semantic editor is needed;
- legacy explicit group -> `Model Group` preset backed by a
  `candidate_selector` macro with route-id based priority bands;
- legacy route channel -> `model_endpoint.config.targets[]`;
- legacy payload rule -> `filter.operations[]`;
- legacy cooldown/health state -> computed runtime metadata used by dispatcher
  policy;
- legacy dummy fallback -> `synthetic_endpoint`.

The final runtime API must not preserve `route_ref`, `route_query`,
`channel_pool`, backend route arrays, or node-level route edges as compatibility
architecture.

## Frontend Model

The route editor has three graph-native editing modes:

- list/wizard mode for common entry, dispatcher, model
  endpoint, synthetic endpoint, and filter presets;
- graph mode for direct port-to-port editing with XYFlow;
- advanced JSON mode for whole-graph editing and import/export.

The graph editor should expose:

- typed handles for `request`, `bidirect`, and `route`;
- draggable node creation;
- port-to-empty quick create;
- edge insertion;
- context menus;
- command palette;
- node inspector with form fields and node JSON;
- graph-level advanced JSON in a separate tab;
- validation diagnostics;
- compiled preview and route trace;
- model endpoint metadata and runtime metadata panels.

The UI must not expose internal generated nodes as public downstream models.
Model marketplace flow visualization must use compiled trace data, not raw
legacy route rows or model-name inference.

## Architecture Boundaries

- `src/server/routes/**` may expose CRUD, preview, validation, and publish
  endpoints, but must not evaluate graph plans.
- Route graph validation, compilation, and runtime execution belong in server
  service/proxy-core modules, not route adapters.
- `src/server/transformers/**` remain protocol-pure and must not import route
  graph runtime or Fastify adapters.
- Whole-body upstream reads in proxy orchestration should use
  `readRuntimeResponseText()`.

## Consequences

- Routing behavior becomes visible and explainable as a graph.
- Provider-specific adaptations become configured filters and dispatcher
  policies rather than transformer branches.
- Health-aware routing is explicit policy over computed metadata.
- Custom model endpoint metadata is supported without becoming an implicit routing
  language.
- Pattern routes and groups remain user-facing presets and migration inputs,
  but no longer define the runtime architecture.
