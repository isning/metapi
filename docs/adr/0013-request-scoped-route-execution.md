# ADR-0013: Request-Scoped Route Execution

Status: Proposed
Date: 2026-06-23

## Context

ADR-0010 keeps route graph objects focused on graph-visible supply targets and
places API variants underneath the selected supply target. ADR-0011 and ADR-0012
move route execution toward a compiled data-plane model. That direction is
sound, but the current request hot path still has an important gap:

- route graph runtime can select from a graph candidate set;
- proxy orchestration can retry target selection after an upstream failure;
- retry selection currently re-enters route matching from `requestedModel`
  instead of continuing from the candidate set selected for the current request;
- API variant fallback can switch protocol endpoints inside the selected target;
- site API endpoint fallback can switch base URLs inside the selected site.

Those are different fallback scopes. If they are not modeled explicitly, a
request can become hard to reason about. In the worst case, a retry may evaluate
the graph again and select a supply target outside the candidate set that the
original graph decision exposed for this request. That would violate the
operator expectation that graph edges define a closed routing domain for the
request.

The graph should remain semantic and graph-native. It should not grow protocol
operations such as `select_chat` or `select_responses`. However, the runtime
must preserve graph candidate boundaries across retries.

## Decision

Metapi will introduce a request-scoped `RouteExecutionScope`.

The route graph runtime evaluates the active graph once at the beginning of a
proxy request and produces a closed execution scope. The scope records:

- the graph version and matched entry;
- the route/product candidate set selected by graph dispatchers;
- the target ids allowed under each candidate;
- the selected candidate for the current attempt, if any;
- post-build filters and resolved graph trace;
- immutable source refs for debugging and log snapshots.

All target selection and target failover for that request must stay inside the
scope. Proxy orchestration must not call global model matching for a retry once
a scope exists.

The runtime layering becomes:

```text
Route graph
  -> RouteExecutionScope
      -> route candidate selection within scope
          -> target selection within selected candidate
              -> API variant attempt plan
                  -> transport replica attempts
```

Only the outer proxy request creates a new scope. Internal retries advance the
existing scope.

## Runtime Contract

The scope is a request-local runtime contract, not an editable graph object:

```ts
type RouteExecutionScope = {
  scopeId: string;
  graphVersionId: number;
  requestedModel: string;
  matchedEntryNodeId: string;
  matchedRouteId: number | null;
  selectedRouteId: number | null;
  selectedCandidateId: string | null;
  candidates: RouteExecutionCandidate[];
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
};

type RouteExecutionCandidate = {
  candidateId: string;
  routeEndpointId: string;
  routeId: number | null;
  supplyTargetId: string | null;
  targetIds: number[];
  priority: number;
  weight: number;
  enabled: boolean;
  sourceRef: RouteProgramSourceRef;
  variantPolicy?: ApiVariantPolicy;
};
```

The exact runtime shape may be optimized, but these invariants are mandatory:

- candidate ids are stable for the lifetime of the request;
- every retried target id must appear in `scope.candidates`;
- graph version and candidate source refs are captured before execution;
- downstream policy filters may remove candidates from eligibility but must not
  add candidates outside the scope;
- route refresh must not mutate an existing scope.

## Selection Rules

`tokenRouter` remains the owner of target eligibility, token resolution, runtime
health state mutation, cooldown checks, route-unit member dispatch, and dynamic
score inputs. Its selection interface must become scope-aware:

```ts
selectInitialTargetWithinScope(scope, downstreamPolicy)
selectNextTargetWithinScope(scope, excludeTargetIds, downstreamPolicy)
explainSelectionWithinScope(scope, excludeTargetIds, downstreamPolicy)
```

The global model-matching methods remain valid only for request entry and
administrative explanation paths. They must not be used for retry after a scope
has been created.

If the graph terminal uses `targetSelection.strategy: 'defer_to_router'`, the
scope includes all route-table target ids for that terminal. If the graph
terminal preselects one inline target, the scope includes only the selected
target unless the compiled terminal explicitly exposes a candidate set for
failover.

## Fallback Scopes

Fallback decisions must classify their scope explicitly:

```ts
type FailureScope =
  | 'api_variant'
  | 'transport_replica'
  | 'route_candidate'
  | 'terminal';
```

Rules:

- `api_variant`: switch only among API variants under the same selected supply
  target and credential.
- `transport_replica`: switch only among replicas for the same API variant.
- `route_candidate`: select another eligible target or candidate from the
  current `RouteExecutionScope`.
- `terminal`: stop retrying and return an upstream or synthetic response.

Examples:

| Failure | Scope | Expected action |
| --- | --- | --- |
| `messages is required` | `api_variant` | Try the Messages variant for the same target. |
| `input is required` | `api_variant` | Try the Responses variant for the same target. |
| endpoint URL timeout | `transport_replica` | Try another replica for the same API variant. |
| 502 from selected target after replicas are exhausted | `route_candidate` | Pick another target inside the scope. |
| invalid request body | `terminal` | Return the error without changing target. |

This replaces vague names such as `cross_protocol_downgrade` in operator-facing
trace output. The underlying behavior is an API variant fallback, not graph
fallback.

## API Variant And Transport Plan

ADR-0010's `ApiAttemptPlan` remains below the selected supply target. The next
runtime contract should be attempt-based rather than endpoint-string based:

```ts
type ProxyExecutionPlan = {
  scope: RouteExecutionScope;
  targetAttempts: TargetAttemptPlan[];
};

type TargetAttemptPlan = {
  candidateId: string;
  targetId: number;
  apiAttempts: ApiAttempt[];
};

type ApiAttempt = {
  apiVariantId: string;
  apiType: ApiType;
  credentialEndpointBindingId: string;
  transportReplicas: TransportReplica[];
  fallbackAllowed: boolean;
};

type TransportReplica = {
  replicaId: string;
  baseUrl: string;
  priority: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
};
```

The legacy `site_api_endpoints` pool should be migrated into transport replicas
under API endpoint profiles. Long term, base URL failover should not be a second
independent fallback model beside `ApiEndpointProfile.baseUrl` and
`pathTemplate`.

## Logging And Explainability

Usage logs and debug traces must present two separate graphs:

```text
Route decision:
  requested model -> matched entry -> candidate set -> selected supply target

Execution attempts:
  selected target -> API variant attempts -> transport replicas -> final result
```

New logs should snapshot enough immutable ids and labels to explain both graphs
after route tables change. Snapshots must not store token secrets.

Trace fields should name the layer:

- `fallbackScope`;
- `failureClass`;
- `candidateId`;
- `targetId`;
- `apiVariantId`;
- `transportReplicaId`;
- `sourceRef`;
- `scopeId`.

## Validation

Runtime and tests must enforce:

- a retry cannot select a target id outside the request scope;
- API variant fallback cannot change target, account, site, route candidate, or
  supply target;
- transport fallback cannot change API variant;
- route refresh cannot expand an existing request scope;
- downstream policy can only narrow the scope;
- forced target and tester modes fail closed when the forced target is outside
  the scope;
- debug and usage log snapshots distinguish route decisions from execution
  attempts.

## Migration

1. Add `RouteExecutionScope` and scope-aware selector methods while keeping
   existing global selection methods for request entry.
2. Route proxy retries through `selectNextTargetWithinScope`.
3. Rename operator-facing downgrade reasons to fallback scopes and failure
   classes.
4. Convert debug and log detail views to show route decision and execution
   attempts separately.
5. Move `site_api_endpoints` behavior into transport replicas under endpoint
   profiles, with compatibility shims for existing data.
6. Replace `executeEndpointFlow(endpointCandidates)` with an attempt-based
   runner once API variants and transport replicas are fully represented.

## Consequences

- Graph edges become a hard per-request routing boundary.
- Retry behavior becomes explainable and deterministic even when graph policies
  are dynamic.
- Protocol fallback remains graph-native without polluting the canvas with
  protocol endpoint nodes.
- The execution data plane gains a single place to reason about fallback scope.
- Some existing orchestration interfaces must carry scope ids and source refs,
  increasing short-term migration work.
