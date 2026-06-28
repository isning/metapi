# ADR-0012: Compiled Selector Runtime

Status: Accepted
Date: 2026-06-23

## Context

ADR-0011 flattened route graph execution into `RouteFlatProgramBundle`, but the
flat bundle still leaves an important split in the request data plane:

- route graph runtime selects semantic candidates with a local dispatcher helper;
- `tokenRouter` later applies endpoint cooldown, site/model breakers, recent
  failure avoidance, runtime load, cost, balance, usage, downstream multipliers,
  and stable-first observation logic;
- CEL expressions are still parsed through `run()` on the request path.

This keeps static graph traversal out of the hot path, but the actual selector
logic remains duplicated and partly interpreted. The highest-cost routing work is
the dynamic candidate selector, not only the graph matcher.

## Decision

Metapi will introduce a compiled selector runtime as the shared execution module
for route and endpoint selection.

The static route graph bundle stays serializable. Dynamic health, load, balance,
cooldown, and breaker state are not written into the bundle. Instead, the bundle
and database rows hydrate into runtime selector plans that describe how dynamic
state is used.

The selector runtime owns:

- policy normalization for weighted, priority-order, round-robin, stable-first,
  direct, CEL score, and CEL rank/select policies;
- hydrate-time CEL parse/plan with expression-cache reuse;
- direct metadata accessors for simple score terms;
- enabled candidate masks and priority buckets;
- weighted contribution selection from precomputed static or dynamic scores;
- explainable candidate probabilities and selected candidate indexes.

`tokenRouter` remains the owner of endpoint eligibility, token resolution,
runtime health state mutation, and dispatch bookkeeping. It must delegate the
final numeric selection step to the selector runtime instead of maintaining a
parallel weighted engine.

`routeGraphRuntimeService` must use the selector runtime for semantic dispatch
and supply target dispatch. It must not own a separate CEL evaluator or strategy
implementation.

## Runtime Shape

The runtime plan is intentionally closer to a gateway data plane than to the
editable graph:

```text
match model
  -> hydrated flat program
  -> runtime selector plan
  -> dynamic state adapters
  -> selected candidate
```

Selector evaluation applies masks and scoring in this order:

1. enabled/static masks;
2. caller-supplied eligibility and avoidance masks;
3. strategy-specific grouping such as priority buckets or stable-first pools;
4. CEL direct/select/rank/score plans;
5. metadata, cost, load, health, and downstream score terms supplied by the
   caller;
6. weighted/random, direct, round-robin, or stable-first final choice.

## Consequences

- Route graph runtime and token router share one selector implementation.
- CEL expression parse/plan leaves the request hot path.
- Dynamic state remains mutable and scoped to its owner.
- Explain output can be produced from the same selector path used for dispatch.
- Future work can hydrate selectors into typed arrays and compact state refs
  without changing the editable graph or public APIs.
