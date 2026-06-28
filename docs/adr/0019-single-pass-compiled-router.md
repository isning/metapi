# ADR-0019: Single-Pass Compiled Router

Status: Accepted
Date: 2026-06-29

## Context

ADR-0011 introduced `RouteFlatProgramBundle` so request routing could execute a
compiled decision bundle instead of walking the editable graph. ADR-0012 moved
selector policy toward a shared compiled runtime. ADR-0013 scoped retries to the
candidate set selected for a request.

That direction is correct, but the current flat bundle is still not the final
data-plane shape:

- `RouteFlatDecision` is a recursive decision tree. Dispatch candidates embed
  `next` decisions, so nested groups still allocate and serialize nested object
  graphs.
- `CompiledRouteGraph` still carries `programBundle` for catalog/debug
  compatibility, even though the proxy runtime prefers `flatProgramBundle`.
- Retry, quota, cooldown, health, and selector state are not modeled as one
  explicit decision input. Some state still lives behind service boundaries that
  can tempt hot-path reads.
- Concurrency semantics are implicit. Selector cursors, quota reservations, and
  cooldown snapshots require different consistency levels, but the runtime
  contract does not name those levels.

Recent memory-pressure work showed that persisted compiled routing metadata can
dominate startup heap and database payload size when route target counts grow.
The next routing runtime should compile route graphs into a compact data-plane
plan and execute that plan as a pure, synchronous decision.

## Decision

Metapi will replace the recursive flat decision runtime with a single-pass
compiled router bundle.

The editable route graph remains the authoring model. The compiled router is the
only request hot-path model. It is a serializable and hydratable data-plane
bundle with:

- matcher tables from requested model to plan id;
- route plans stored as flat arrays;
- terminal candidate tables;
- selector-level tables that describe nested selector state without recursive
  `candidate.next` objects;
- declaration-only predicate and transform opcodes;
- compact trace refs for explainability;
- no persisted `programBundle` in the hot compiled graph.

The runtime entry point becomes a pure function:

```ts
decideRoute(compiledRouter, {
  request,
  runtimeState,
  attemptResults,
  randomSeed,
  now,
}, scratch) -> {
  decision,
  statePatch,
  trace,
}
```

Rules:

- `decideRoute()` must not perform I/O.
- `decideRoute()` must not read DB, cache, wall clock, or `Math.random()`.
- All dynamic inputs must arrive through `runtimeState`, `attemptResults`,
  `randomSeed`, and `now`.
- The function may scan bounded arrays in the matched plan, but it must not
  traverse source graph nodes, recurse through decision objects, or follow a
  runtime `next` chain.
- Strong resources such as quota and paid balance are committed after the pure
  decision as an explicit reservation step.

## Compiled Bundle Shape

The exact field names can change during implementation, but the shape should
stay table-oriented:

```ts
type CompiledRouterBundle = {
  version: 2;
  hash: string;
  matcher: CompiledMatcher;
  plans: CompiledRoutePlan[];
  diagnostics: RouteGraphDiagnostic[];
};

type CompiledRoutePlan = {
  id: string;
  entryNodeId: string;
  routeId: number | null;
  publicModelName: string;
  selectorLevels: CompiledSelectorLevel[];
  candidates: CompiledTerminalCandidate[];
  predicates: CompiledPredicate[];
  transforms: CompiledTransform[];
  traceRefs: CompiledTraceRef[];
};

type CompiledSelectorLevel = {
  selectorId: string;
  parentSelectorId: string | null;
  strategy: CompiledSelectorStrategy;
  groups: Array<{
    groupId: string;
    terminalCandidateIndexes: number[];
    priority: number;
    weight: number;
    order: number;
  }>;
};

type CompiledTerminalCandidate = {
  candidateId: string;
  endpointId: string;
  routeId: number | null;
  targetIds: number[];
  model: string;
  enabled: boolean;
  selectorPath: Array<{
    selectorId: string;
    groupId: string;
  }>;
  predicateIndexes: number[];
  transformIndexes: number[];
  terminal: CompiledTerminal;
};
```

This representation preserves nested selector semantics without embedding a
nested runtime tree. A final supply target is represented once, and every
selector that can choose it is represented by ids in `selectorPath`.

## Single-Pass Decision Semantics

Runtime decision is a fixed pipeline over the matched plan:

1. Match `request.model` to a plan id.
2. Build terminal candidate eligibility from static flags, predicates,
   `runtimeState`, and `attemptResults`.
3. Aggregate terminal eligibility into selector group eligibility.
4. Select groups from root selectors to leaf selectors using selector state and
   deterministic randomness derived from `randomSeed`.
5. Select the terminal candidate whose `selectorPath` matches all selected
   groups.
6. Apply compiled transforms and return the route decision.
7. Return state mutation intents in `statePatch`; do not commit them inside the
   pure decision.

This is a single routing decision. It still contains conditional checks, but it
does not interpret graph structure at runtime.

Nested selectors remain supported. Round-robin and other stateful selectors read
their state from `runtimeState.selectors[selectorId]` and return their updates in
`statePatch.selectors`. Random selectors derive per-selector random values from:

```text
hash(randomSeed, planId, selectorId, attemptIndex)
```

Selector result stability must not depend on incidental array traversal order.

## Retry And Attempt Results

Upstream failure does not require graph traversal. Retries call `decideRoute()`
again with updated `attemptResults`.

```ts
type AttemptResult = {
  candidateId: string;
  targetId: number | null;
  endpointId: string;
  failureScope: 'api_variant' | 'transport_replica' | 'route_candidate' | 'terminal';
  failureClass: string;
};
```

`attemptResults` can exclude, penalize, or annotate candidates depending on
failure scope. A retry must remain inside the request's compiled candidate
domain unless a new outer request scope is intentionally created.

## State Consistency Levels

Routing state has three consistency classes.

### Snapshot State

Examples:

- endpoint health;
- cooldown visibility;
- availability;
- pricing summaries;
- static route config;
- failure overlay.

Guarantee:

- one `decideRoute()` call sees one immutable snapshot;
- concurrent requests may see stale snapshots;
- updates are published by replacing the snapshot, not mutating it in place.

Snapshot state is optimized for read throughput.

### Optimistic State

Examples:

- round-robin cursors;
- stable-first selector state;
- lightweight selector counters.

Guarantee:

- read from the runtime snapshot;
- write with compare-and-swap or versioned update;
- CAS failure must not block the request path;
- callers may accept the lost update or retry once.

By default, only selectors on the selected path emit patches. Fairness is
eventual, not linearizable.

### Strong State

Examples:

- quota consumption;
- paid balance reservation;
- downstream key hard budget;
- security and disable gates;
- hard rate-limit reservations.

Guarantee:

- checked and committed by a linearizable DB/Redis/transaction operation after
  `decideRoute()` returns a reservation intent;
- commit failure is converted into refreshed runtime state or an `AttemptResult`
  and the caller may run `decideRoute()` again;
- strong state must not be updated by selector optimistic patches.

The hot route decision stays pure. Strong consistency is paid only for resources
that require it.

## Performance Rules

The compiled router is a data-plane artifact. Implementations must preserve
these constraints:

- no async work inside `decideRoute()`;
- no global locks in the decision path;
- no source graph traversal in the decision path;
- no recursive `RouteFlatDecision` or operation-chain traversal in the decision
  path;
- no arbitrary JavaScript predicates or transforms in the hot bundle;
- candidate and selector arrays are bounded by compile-time limits;
- trace construction is compact by default and expands only for debug/explain
  paths;
- implementation may use scratch buffers, indexes, bitsets, typed arrays, or
  string tables without changing the source graph model.

The expected hot-path complexity is:

```text
O(model match) + O(candidates in matched plan) + O(selector levels in matched plan)
```

It must not scale with total graph size.

## Memory Model And Budgets

The compiled router must be designed around bounded retained memory and bounded
temporary memory. Binary encoding is not the first performance lever; removing
duplication and avoiding runtime object graphs is.

### Persisted Bundle

The persisted compiled bundle must not duplicate source graph structures.

Rules:

- persist the semantic source graph once, and persist the executable router
  bundle separately;
- do not persist `programBundle` after v2 readers are migrated;
- do not persist recursive `RouteFlatDecision` trees;
- do not persist debug-only endpoint catalogs inside the hot router bundle;
- store repeated strings through string tables or ids when route counts make
  repeated labels, endpoint ids, model names, or selector ids material;
- store hashes as fixed-size digests, never as stable JSON payloads;
- cap serialized compiled-router size in tests.

The persisted bundle should be small enough that reading the active graph does
not dominate server startup memory. Large explain/debug projections should be
derived from source graph, DB rows, or on-demand tools instead of retained in the
hot bundle.

### Hydrated Runtime

Hydration converts the persisted bundle into immutable runtime indexes. It must
not keep multiple equivalent object graphs alive.

Rules:

- hydrate the active compiled router once and share it across requests;
- use read-copy-update replacement for route refresh: build the new hydrated
  router, swap the active pointer, then allow the old pointer to be garbage
  collected after in-flight requests finish;
- avoid retaining source graph, old compiled graph JSON, and hydrated indexes in
  the same long-lived object;
- keep debug/explain indexes lazy or separate from the hot hydrated router;
- compiled regex, CEL plans, selector plans, and string tables are hydration
  outputs and must be reused across requests.

Startup and route refresh tests must measure both retained heap after GC and
peak serialized bundle size. A refresh must not require holding many historical
compiled graph versions in memory.

### Per-Request Scratch

`decideRoute()` may use temporary memory, but it should be bounded by the matched
plan, not by total graph size.

Rules:

- pass an explicit scratch object or allocate small local arrays for candidate
  indexes, masks, and selector results;
- do not allocate per-candidate rich objects on the hot path;
- prefer indexes, bitsets, typed arrays, or reused buffers for eligibility and
  selector state;
- default trace output should contain ids and compact reason codes, not expanded
  source objects;
- full trace expansion is a debug/explain path outside the normal proxy hot
  path.

Per-request retained memory after response completion should be limited to logs,
usage records, and state patches that are intentionally persisted.

### Runtime State Snapshots

Runtime state snapshots must be compact and purpose-built.

Rules:

- snapshot state should store endpoint and target ids, generation numbers, small
  status enums, scores, timestamps, and counters;
- snapshots must not embed account rows, tokens, secrets, full site configs, or
  compiled route source objects;
- strong-resource state should expose reservation handles and availability
  summaries, not full transaction payloads;
- snapshot replacement should be coarse-grained enough to avoid per-request
  cloning.

The decision input is a view over current state, not a copy of all state.

### Logs And Debug Data

Debug data must not recreate the compiled graph in another form.

Rules:

- usage logs store stable ids, labels, selected candidate, failure classes, and
  compact trace refs;
- full graph expansion for UI explain views is reconstructed on demand;
- debug traces must have size caps and truncation markers;
- route-flow and pricing views must not require the hot bundle to retain
  endpoint catalogs that are otherwise derivable.

## Compiler Rules

The compiler owns all expensive structural work:

- macro lowering;
- route group expansion;
- source route alias resolution;
- selector path construction;
- predicate and transform normalization;
- cycle detection;
- terminal candidate table construction;
- trace ref compaction.

The compiler must fail closed with diagnostics when a source graph cannot be
compiled into the single-pass model. In particular:

- graph cycles are invalid;
- unbounded dynamic candidate generation is invalid;
- predicates or transforms that require runtime I/O are invalid;
- imperative transforms that hide their read/write set are invalid unless they
  are isolated outside the hot routing plan;
- candidate expansion that exceeds configured plan caps is invalid.

## Implementation Plan

Implementation should land as reviewable slices. Each slice must leave the
current runtime working and add tests for the new contract before switching more
traffic to it.

### 1. Shared Contracts

Add v2 contracts beside the existing route graph contracts.

Expected ownership:

- `src/shared/routeGraph.js` / `routeGraph.d.ts`: serializable v2 bundle types,
  compiler entry point, normalization, validation, and stable hashing.
- `src/server/services/compiledRouterRuntimeService.ts`: hydrated runtime
  indexes and `decideRoute()`.
- `src/server/services/compiledRouterStateService.ts`: runtime snapshot,
  optimistic selector patch, and strong reservation handoff contracts.
- Existing `routeGraphRuntimeService.ts`: compatibility adapter while v1 and v2
  coexist.

Contracts to introduce:

```ts
type CompiledRouterBundleV2 = {
  version: 2;
  hash: string;
  matcher: CompiledMatcherV2;
  plans: CompiledRoutePlanV2[];
  stringTable?: string[];
  diagnostics: RouteGraphDiagnostic[];
};

type HydratedCompiledRouter = {
  bundleHash: string;
  matcher: HydratedMatcher;
  plans: HydratedRoutePlan[];
};

type RouteDecisionInput = {
  request: RouteDecisionRequest;
  runtimeState: RouteRuntimeSnapshot;
  attemptResults: AttemptResult[];
  randomSeed: string;
  now: number;
};

type RouteDecisionOutput = {
  decision: RouteDecision | null;
  statePatch: RouteStatePatch;
  trace: RouteDecisionTrace;
};
```

### 2. Compiler Pipeline

The v2 compiler should be a staged pipeline with explicit intermediate outputs:

1. Normalize semantic graph.
2. Lower macros and route groups using the existing graph-native lowering rules.
3. Collect public entries and build matcher targets.
4. For each entry, enumerate terminal candidates and selector paths.
5. Build selector levels in topological order.
6. Compile predicates and transforms into declaration-only opcodes.
7. Deduplicate strings and repeated trace refs.
8. Enforce caps for candidates, selector levels, string-table size, and
   serialized size.
9. Emit diagnostics and fail closed for unsupported shapes.

The compiler must not call runtime services. It may reuse shared normalization
helpers, but it should not depend on Fastify routes, token router runtime state,
DB access, or proxy orchestration.

Intermediate fixture tests should snapshot counts rather than full bundle JSON:

- entry count;
- plan count;
- terminal candidate count;
- selector level count;
- transform/predicate opcode count;
- serialized byte size.

### 3. Pure Runtime Evaluator

Implement `decideRoute()` as a synchronous evaluator over a hydrated v2 router.

Internal steps:

1. Match request model to `planIndex`.
2. Reset or allocate scratch masks for the matched plan.
3. Evaluate static enabled flags, attempt-result exclusions, runtime-state
   eligibility, predicates, and strong-resource availability summaries.
4. Aggregate terminal eligibility into selector group eligibility.
5. Select selector groups deterministically from root to leaves.
6. Resolve the terminal candidate.
7. Apply compiled transforms.
8. Emit compact trace refs and state patch intents.

The evaluator must be testable with no server setup. Unit tests should call it
with plain objects and deterministic seeds.

### 4. Runtime State Snapshot

Build runtime snapshots before calling `decideRoute()`.

Snapshot construction should live outside the pure evaluator and should have a
single responsibility: adapt current mutable services into compact read-only
state.

Initial state adapters:

- endpoint and target health;
- cooldown visibility;
- route/target disable overlays;
- selector state versions;
- downstream policy restrictions;
- quota/balance availability summaries.

Strong reservations remain a second step:

```text
snapshot -> decideRoute -> tryCommitStrongReservations -> upstream attempt
```

On strong commit failure, the caller updates `runtimeState` or appends an
`AttemptResult` and calls `decideRoute()` again. The evaluator must not own the
commit loop.

### 5. Proxy Integration

Integrate v2 behind the existing proxy contracts before deleting v1.

Steps:

1. Add `compiledRouterBundle` to `CompiledRouteGraph`.
2. Teach active graph loading to recompile graphs missing v2.
3. Change `evaluateCompiledRouteGraph()` to prefer v2 and keep v1 as a temporary
   fallback.
4. Adapt proxy orchestration to pass `attemptResults`, deterministic
   `randomSeed`, `now`, and runtime snapshots.
5. Return the same external selection shape that proxy orchestration already
   understands.
6. Keep request-scoped route boundaries from ADR-0013 intact.

No proxy route file should import v2 internals directly. Routes should continue
to call orchestration/services.

### 6. Reader Migration

Readers that currently depend on `programBundle` must move to v2, source graph,
or DB projections.

Migration targets:

- route-flow view: derive selected candidates and trace refs from v2 plans;
- pricing estimates: evaluate candidate and target tables without reading
  recursive decisions;
- endpoint catalog: derive management catalog from source graph plus DB target
  rows, or from a non-hot projection generated on demand;
- debug/explain: expand compact trace refs lazily.

After these readers move, `programBundle` can be removed from persisted active
graphs.

### 7. Architecture Guardrails

Add architecture tests before switching runtime defaults:

- request runtime must not import source graph traversal helpers;
- proxy hot path must not import compiler modules;
- v2 evaluator must not import DB, Fastify, route files, token router mutable
  services, or process-global random/time helpers;
- persisted v2 bundle tests must reject `programBundle`,
  `RouteFlatDecision.next`, and debug-only endpoint catalogs.

### 8. Rollout

Rollout should be staged:

1. Generate v2 alongside v1 and compare decisions in tests.
2. Shadow-evaluate v2 in selected integration tests and compare against v1
   outputs.
3. Prefer v2 in runtime while v1 fallback remains available for old persisted
   graphs.
4. Remove v1 fallback after active graph migration and reader migration are
   complete.
5. Delete operation-chain and recursive flat runtime code once architecture
   tests enforce the new boundary.

## Migration

1. Add `CompiledRouterBundle` v2 alongside the existing flat bundle.
2. Implement a v2 compiler from the semantic route graph.
3. Add a v2 evaluator and parity tests against the current flat evaluator.
4. Move route-flow, pricing, and endpoint-catalog readers off
   `programBundle.endpointCatalog`.
5. Prefer v2 in `evaluateCompiledRouteGraph()` and recompile old persisted
   active graphs when v2 is missing.
6. Remove persisted `programBundle` after all readers use v2 or source/DB
   projections.
7. Add architecture tests that prevent request runtime imports from depending on
   recursive `RouteFlatDecision` or operation-chain execution.
8. Keep JSON as the storage format until table compaction is proven. Binary or
   compressed storage can be considered later, but it is not the primary
   performance lever.

## Performance Test Requirements

Performance coverage must exercise the full route lifecycle, not only the final
decision function. Each test should use deterministic fixtures and explicit
budgets so regressions fail in CI instead of being discovered through production
OOMs or latency spikes.

### Compile-Time Performance

Compiler tests must cover:

- large exact-route catalogs;
- large automatic route rebuilds;
- nested route groups and selector paths;
- high target counts behind one route;
- many routes sharing endpoint identities;
- rejected graphs that exceed candidate expansion caps.

Assertions:

- compile time stays within the configured budget for each fixture class;
- compile heap growth after GC stays bounded;
- diagnostics for rejected oversized graphs are produced without materializing
  the full expanded candidate set;
- compiler output candidate count, selector count, and string-table size match
  expected bounds.

### Persisted Size And Serialization

Persisted bundle tests must measure:

- serialized semantic source graph size;
- serialized compiled router size;
- serialized active graph row size;
- old-format to v2 migration output size.

Assertions:

- compiled router size is below a fixed budget for representative large
  fixtures;
- compiled router size grows approximately linearly with terminal candidates,
  not with nested selector path duplication;
- hash fields are fixed-size digests;
- `programBundle`, recursive `RouteFlatDecision`, and debug-only endpoint
  catalogs are absent from the hot persisted bundle.

### Hydration And Startup

Hydration tests must cover cold startup, active graph load, and route refresh.

Assertions:

- active graph hydration has bounded retained heap after GC;
- startup does not retain raw compiled JSON, semantic source graph, and hydrated
  indexes as three long-lived copies;
- route refresh uses read-copy-update semantics and releases the old hydrated
  router after in-flight references drop;
- repeated refreshes do not accumulate historical compiled routers;
- regex, CEL, selector, and string-table plans are hydrated once and reused.

### Decision Hot Path

Decision benchmarks or budgeted tests must cover:

- exact matcher hit;
- normalized exact matcher hit;
- wildcard and regex matcher hit;
- large matched plan candidate filtering;
- nested selector evaluation through selector-level tables;
- round-robin, weighted, priority-order, stable-first, and direct strategies;
- candidate predicates and transforms;
- synthetic terminal selection.

Assertions:

- `decideRoute()` is synchronous and performs no async work;
- no DB/cache/time/random globals are read;
- latency is bounded for large matched plans;
- per-request allocations are bounded by the matched plan, not total graph size;
- retained heap after the request is limited to intentional logs, state patches,
  and usage records;
- random output is deterministic for the same `randomSeed`, `planId`,
  `selectorId`, and attempt index.

### Retry And Attempt Performance

Retry tests must cover repeated failures within the same request scope.

Assertions:

- adding `attemptResults` does not cause graph rematching or source traversal;
- retry decision time grows with failed candidates in the matched scope, not
  total graph size;
- excluded targets and endpoints are masked by indexes or compact state, not by
  cloning candidate objects;
- repeated retries do not append unbounded trace payloads.

### Runtime State And Concurrency

State performance tests must cover snapshot, optimistic, and strong state
handoff.

Assertions:

- snapshot construction and replacement avoid per-request deep cloning;
- selector optimistic patches can be applied with CAS or dropped on conflict
  without blocking the request path;
- strong reservation commit is measured separately from pure routing decision;
- commit failure plus redecision stays within an explicit retry budget;
- concurrent requests do not require a global routing lock.

### Proxy Integration

Integration tests must measure the request path around the pure decision:

- proxy request setup and runtime snapshot lookup;
- decision plus target resolution;
- strong-resource reservation when configured;
- upstream attempt failure and redecision;
- post-attempt health, cooldown, usage, and selector-state bookkeeping.

Assertions:

- requests with no strong-resource reservation do not touch DB on the route
  decision path;
- post-attempt bookkeeping can be async or batched without changing response
  success;
- route refresh during in-flight requests does not block decision execution.

### Explain, Route-Flow, And Debug

Explainability paths must have separate budgets from the proxy hot path.

Assertions:

- normal proxy traces store compact ids and reason codes;
- full route-flow and debug expansion are on-demand and size-capped;
- endpoint catalog, pricing, and route-flow views do not require retaining
  duplicate hot-bundle catalogs;
- large debug traces include truncation markers instead of unbounded payloads.

### CI Budgets And Regression Policy

Performance tests should be split into:

- fast budgeted tests that always run in CI;
- heavier benchmarks that run in scheduled CI or explicit performance jobs;
- local profiling scripts for investigating regressions.

Every performance fixture should publish:

- fixture dimensions, such as route count, candidate count, selector depth, and
  target count;
- latency budget;
- retained heap budget;
- serialized-size budget;
- allocation or object-count budget when measurable.

Budgets must be reviewed when fixture dimensions change. Raising a budget should
be treated as a product decision, not as routine test maintenance.

## Required Tests

- compiler parity for exact routes, route groups, automatic macros, synthetic
  terminals, filters, and endpoint targets;
- retry tests where `attemptResults` excludes the previously failed candidate;
- state tests for snapshot, optimistic, and strong consistency handoff;
- deterministic randomness tests for multi-selector plans;
- performance tests from the lifecycle matrix above, including compile time,
  serialized size, hydration retained heap, decision latency, retry cost,
  runtime-state handoff, proxy integration, and debug/explain expansion;
- integration tests for proxy routing, route-flow, pricing, and endpoint catalog
  views;
- architecture tests that forbid hot-path graph traversal and recursive flat
  decision execution.

## Consequences

- Request routing becomes a pure, synchronous, high-throughput decision over a
  matched compiled plan.
- The route graph remains expressive for authors, while unsupported runtime
  semantics become compiler diagnostics instead of hidden slow paths.
- Strong consistency remains available where required without making every
  request pay for locks or transactions.
- The compiler becomes more complex and must own more semantic validation.
- Debug output must be generated from compiled trace refs and state snapshots,
  not from runtime graph traversal.
