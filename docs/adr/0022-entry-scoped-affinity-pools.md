# ADR-0022: Entry-Scoped Affinity Pools

Status: Accepted
Date: 2026-08-16

## Context

ADR-0021 introduced strict-session evidence and bound that evidence to one
`executionTargetId + endpointType`. That preserves target-local continuation,
but it also makes a successful fallback become the next sticky target. A
session that temporarily leaves a failed inexpensive target can therefore stay
on a more expensive fallback after the original target recovers.

One fixed-target rule is also too broad for the available upstream topologies:

- ordinary full-context requests may require no affinity;
- several execution targets may share one upstream session or state domain;
- a self-hosted target may keep continuation or KV state on one instance;
- an operator may need to forbid crossing state domains, use another domain
  temporarily, or promote a successful fallback domain to the new primary.

These targets need not belong to the same route endpoint, dispatcher, fallback
stage, or graph node. Affinity must constrain the already compiled route plan
without replacing its graph topology or selection policy.

## Decision

Strict affinity is an Entry-scoped runtime policy. An affinity pool is a named
set of atomic execution targets reachable from that Entry that the operator
asserts share one upstream session/state domain.

Affinity does not create a route group, merge graph nodes, define fallback
order, or select a candidate. Existing dispatcher policies, ordered fallback
stages, cost signals, weights, health, and target cooldowns remain authoritative
after affinity has reduced the eligible candidate set.

This ADR extends ADR-0021. ADR-0021 continues to own affinity evidence,
endpoint-type isolation, content hints, and cache-aware expected cost. This ADR
supersedes its assumption that every strict binding must identify one concrete
execution target.

## Source Graph Contract

Affinity configuration belongs directly to an external Entry:

```ts
type AffinityPolicy =
  | { kind: 'inherit_default' }
  | { kind: 'disabled' }
  | {
      kind: 'pool';
      ttlSec?: number;
      crossPoolFallback: 'deny' | 'temporary' | 'promote_on_success';
    }
  | {
      kind: 'target';
      ttlSec?: number;
      crossTargetFallback: 'deny' | 'temporary' | 'promote_on_success';
    };

type EntryAffinityPoolMember = {
  kind: 'execution_target';
  sourceRef: string;
};

type EntryAffinityPool = {
  id: string;
  label?: string;
  members: EntryAffinityPoolMember[];
};

type EntryAffinityConfig = {
  policy: AffinityPolicy;
  pools?: EntryAffinityPool[];
};

type EntryNode = {
  // Existing Entry fields.
  affinity?: EntryAffinityConfig;
};
```

Pool membership uses the stable execution-target `sourceRef`, not a database
auto-increment ID. Members may be reached through unrelated graph branches.
The Entry is the ownership and validation boundary, not the parent node of the
members.

A `candidate_selector` macro with an external surface may author the same
configuration:

```ts
type CandidateSelectorMacroConfig = {
  // Existing macro fields.
  affinity?: EntryAffinityConfig;
};
```

Macro lowering copies this configuration to its generated Entry. Route Group
commands therefore edit the same graph-native configuration as the advanced
Graph editor; they do not introduce a Route Group affinity runtime.

Pools are not a global registry or separate persistence resource. Import,
export, publication, and deletion remain atomic with the owning Entry. Reusing
the same topology across Entries is an authoring concern for presets or macros,
not a reason to share live affinity bindings across public models.

## Global Default

Settings provides the default policy for Entries that specify
`inherit_default` or omit affinity configuration:

```ts
type GlobalAffinityDefault =
  | { kind: 'disabled' }
  | {
      kind: 'pool';
      ttlSec: number;
      crossPoolFallback: 'deny' | 'temporary' | 'promote_on_success';
    }
  | {
      kind: 'target';
      ttlSec: number;
      crossTargetFallback: 'deny' | 'temporary' | 'promote_on_success';
    };
```

The global setting supplies behavior only. Pool membership always remains on
the Entry because it depends on that Entry's reachable execution alternatives.
The initial global default is `disabled`.

`PROXY_STICKY_SESSION_ENABLED` is not migrated into this setting and is not an
input to graph-native affinity policy resolution.

## Validation And Compilation

Publication resolves each Entry independently and rejects an invalid affinity
topology. Validation requires:

- pool IDs are non-empty and unique within the Entry;
- member `sourceRef` values resolve to atomic execution targets;
- every explicit member is reachable from the Entry;
- one execution target belongs to at most one explicit pool within the Entry;
- a macro-authored configuration lowers without changing member identity;
- an effective `pool` policy cannot refer to malformed or unresolved members.

When pool mode is effective, a reachable execution target without explicit
membership is treated as a safe implicit single-member pool identified by the
compiled target. Publication emits a warning so operators can complete the
topology, but it never assumes that two unassigned targets share state.

The persisted runtime artifact contains only resolved immutable data:

```ts
type ResolvedAffinityPolicy =
  | { kind: 'disabled' }
  | {
      kind: 'pool';
      ttlSec: number;
      crossPoolFallback: 'deny' | 'temporary' | 'promote_on_success';
    }
  | {
      kind: 'target';
      ttlSec: number;
      crossTargetFallback: 'deny' | 'temporary' | 'promote_on_success';
    };

type CompiledAffinityPool = {
  id: string;
  executionTargetIds: number[];
};

type CompiledRouterPlan = {
  // Existing compiled plan fields.
  affinity: {
    policy: ResolvedAffinityPolicy;
    pools: CompiledAffinityPool[];
  };
};
```

The runtime must consume this compiled representation. It must not reconstruct
Pool membership from Route Group projections, editor state, account fields, or
model/provider names.

## Binding Identity And State

Only strict-session evidence from ADR-0021 can create a binding. Content hints
remain non-binding cost evidence.

The binding key includes the downstream API-key owner, client kind, normalized
endpoint type, Entry/public model identity, and explicit session identity. A
binding value is one of:

```ts
type AffinityBinding =
  | {
      scope: 'pool';
      entryNodeId: string;
      primaryPoolId: string;
      expiresAtMs: number;
      revision: number;
    }
  | {
      scope: 'target';
      entryNodeId: string;
      primaryExecutionTargetId: number;
      expiresAtMs: number;
      revision: number;
    };
```

The normalized endpoint type remains part of the key. Responses, Chat
Completions, Anthropic Messages, Gemini Generate Content, and other protocol
surfaces cannot accidentally share continuation state.

A graph publication does not invalidate all bindings merely because the
artifact hash changed. On lookup, the runtime verifies that the Entry and
primary target or Pool still exist in the active compiled plan. A permanently
removed, disabled, or unreachable primary invalidates the binding and permits a
fresh initial selection. Temporary health failure or cooldown does not.

## Selection Semantics

### Disabled

No binding is read or written. Every request uses the normal graph selection
path and remains free to choose the cheapest eligible target.

### Pool

Before a binding exists, the route executes normally. The first completely
successful execution binds the session to the selected target's explicit or
implicit Pool.

With a valid Pool binding, the runtime first evaluates the same compiled plan
with execution attempts outside the primary Pool made ineligible. Health,
cooldown, downstream policy, failure overlays, stage order, and dispatcher
selection continue to apply to members inside the Pool.

Failure of one Pool member does not fail or cool down the Pool. Other healthy
members remain eligible. The cross-Pool policy is considered only when no
member of the primary Pool can complete the request.

### Target

Before a binding exists, the route executes normally and binds the first
completely successful execution target. With a valid binding, that target is
preferred whenever eligible. Its ordinary target cooldown determines when it
is retried after failure.

The primary target is not cleared merely because one attempt failed. Otherwise
a fallback success would accidentally become permanent and prevent failback.

## Cross-Scope Fallback

Pool and target modes use the same three behaviors, with Pool or target as the
scope boundary.

### Deny

If the primary scope has no eligible execution attempt, execution fails. The
binding is retained, so a later request can resume after health or cooldown
recovery. The runtime must not silently select or bind another scope.

### Temporary

If the primary scope has no eligible execution attempt, the runtime may run the
normal graph outside that scope. A successful fallback is request-local and
does not replace or refresh the primary binding. After the primary scope's
cooldown expires, the next request attempts it again automatically.

This mode is appropriate only when the request carries enough context to run
correctly in another state domain.

### Promote On Success

The runtime may execute outside the primary scope. The fallback becomes the new
primary only after the request completes successfully:

```text
primary Pool A unavailable
  -> select Pool B through normal graph semantics
  -> Pool B completes successfully
  -> compare-and-set binding from Pool A to Pool B
  -> reset binding TTL
  -> subsequent requests prefer Pool B
```

Promotion must not occur when a target is merely selected, when a connection
opens, or when response headers arrive. Success means:

- a non-stream response was fully read and passed protocol validation;
- an SSE response reached its protocol completion event and ended normally;
- a WebSocket response reached its matching completed event;
- no partial-output disconnect, protocol error, cancellation, or failed
  bookkeeping invalidated the attempt.

Concurrent requests for one session use a revision-aware compare-and-set. A
promotion succeeds only while the observed primary and revision are unchanged.
The first successful promotion wins; a later completion cannot overwrite a
newer binding based on stale state.

For `temporary` and `promote_on_success`, attempts made outside the primary
scope are fallback executions. They must never be mistaken for a primary
affinity hit in selection diagnostics or billing logs.

## Failback

Target affinity preserves the primary target while it is temporarily cooling
down. Once cooldown expires, the next request attempts that target before
normal fallback. A temporary fallback success never overwrites it.

Pool affinity does not preserve one member inside a Pool. Each request runs the
normal selector among eligible Pool members. If the original inexpensive member
recovers, an existing cost-aware or ordered policy may choose it again without
changing the Pool binding.

`promote_on_success` intentionally disables automatic return to the previous
scope: promotion declares that the successful fallback is now primary. The old
scope can become primary again only after a later promotion, binding expiry, or
explicit binding reset.

## Lease And Continuation Boundaries

Affinity binding and target concurrency leases are separate concerns. Pool
mode binds a state domain, while a lease still protects the concrete execution
target selected for one request. Disabling affinity must not implicitly disable
credential or provider concurrency protection.

Adapter or endpoint capabilities may declare a minimum affinity requirement
when continuation correctness demands one. Such requirements are capability
data, never model-name checks. A policy that is weaker than a required scope
must produce a validation or request error rather than silently changing
operator configuration.

Cross-scope fallback is unsafe when the client provides only target-local
continuation state such as an inaccessible upstream response ID. Such routes
should use `deny`, or use `promote_on_success` only when the fallback request can
be reconstructed and its successful response establishes the new continuation
scope.

## UI

Settings exposes:

- global default mode: Disabled, Pool, or Fixed target;
- default TTL;
- the relevant cross-scope fallback behavior.

An Entry editor exposes:

- Inherit global, Disabled, Pool, or Fixed target;
- Entry-scoped Pool definitions and members;
- Deny cross-Pool fallback;
- Temporary cross-Pool fallback and return after recovery;
- Promote successful fallback Pool to primary.

The automatic Route Group editor writes the macro `affinity` configuration and
publishes it through the normal graph command path. The advanced Graph editor
writes the Entry configuration directly. Both surfaces must render the same
server-driven policy vocabulary and validation results.

The UI must explain that Pool membership asserts shared upstream state, not
merely the same model name or provider brand. It must not infer membership from
GPT, Claude, DeepSeek, site platform, account mode, hostname, or price.

## Observability

Runtime decisions and proxy logs expose at least:

```ts
type AffinityDecisionTelemetry = {
  affinityMode: 'disabled' | 'pool' | 'target';
  affinityEvidence: 'strict_session' | 'content_hint' | 'none';
  primaryPoolId?: string | null;
  primaryExecutionTargetId?: number | null;
  selectedPoolId?: string | null;
  selectedExecutionTargetId?: number | null;
  affinityHit: boolean;
  affinityFallback: boolean;
  affinityRebound: boolean;
  previousPrimaryPoolId?: string | null;
  previousPrimaryExecutionTargetId?: number | null;
  rebindReason?: 'fallback_succeeded' | null;
};
```

Diagnostics distinguish these outcomes:

- primary Pool member selected;
- primary target selected;
- another member of the primary Pool selected;
- primary scope cooling down;
- cross-scope fallback denied;
- temporary fallback executed;
- fallback promoted successfully;
- stale concurrent promotion ignored;
- binding invalidated because its graph identity disappeared.

## Verification Requirements

Tests cover the behavior as a protocol and transport matrix, not only one HTTP
surface:

- non-stream HTTP;
- SSE upstream and downstream combinations;
- aggregated SSE-to-non-stream execution;
- Responses WebSocket execution;
- protocol/API-variant fallback;
- automatic and manually authored Entries;
- graph publication, import/export, and source-reference validation.

Required state-machine cases include:

- disabled mode never creates a binding;
- targets from different graph nodes can share one Entry Pool;
- a Pool member failure selects another member without crossing the Pool;
- `deny` never executes outside the primary scope;
- `temporary` executes outside the primary scope without rebinding;
- the recovered primary target is retried after cooldown;
- Pool selection returns to a recovered cheaper member when the dispatcher
  policy selects it;
- `promote_on_success` updates only after complete success;
- partial streams and failed WebSocket responses never promote;
- concurrent promotions use compare-and-set and cannot overwrite newer state;
- removal of a primary from the active Entry invalidates the binding;
- republishing an equivalent Entry does not invalidate a usable binding;
- endpoint types remain isolated;
- content hints never create Pool or target bindings.

## Consequences

- Routes that do not need continuity can retain ordinary cost-aware routing.
- Shared upstream state can be modeled across targets on unrelated graph nodes.
- Target-local state can remain fixed without pretending every provider needs
  sticky routing.
- Operators explicitly choose availability versus continuity at the scope
  boundary.
- Temporary fallback and permanent promotion have different, observable
  semantics.
- The route graph remains the only authoring source and the compiled artifact
  remains the only proxy runtime input.
