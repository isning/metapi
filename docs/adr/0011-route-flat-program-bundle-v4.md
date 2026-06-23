# ADR-0011: Route Flat Program Bundle V4

Status: Accepted
Date: 2026-06-23

## Context

ADR-0008 introduced `RouteProgramBundleV3` so request routing could execute a
compiled program instead of interpreting the editable graph snapshot. V3 fixed
the source graph/runtime split, but it is still an operation chain:

- runtime hydrates `programsById` and `opsByProgramId`;
- hot path follows `startOpId`, `targetOpId`, and `nextOpId`;
- common routes compile to `dispatch -> select_supply`;
- route-flow and pricing code still need to understand operation details.

That is better than graph traversal, but it is not the final execution shape.
Metapi route execution should look more like a gateway data plane: validate and
compile rich config once, then execute a compact precomputed plan per request.

## Decision

Metapi will add `RouteProgramBundleV4` as the preferred runtime program format.
The editable source graph remains the authoring interface. V4 is the request
runtime plan.

`CompiledRouteGraph` carries both:

- `programBundle`: V3 operation bundle kept only for migration/debug tests while
  the migration is in progress.
- `flatProgramBundle`: V4 flat decision bundle used by runtime first.

V4 lowers operation chains into decision objects:

- matcher table selects a flat program;
- filters are pre-grouped as `RouteFlatFilterStage[]`;
- dispatchers contain inline flat candidates;
- candidates point directly to their next decision;
- supply terminals carry inline `CompiledEndpointTarget[]`;
- synthetic terminals are explicit terminal decisions.

The common path is:

```text
requested model -> matcher -> program -> dispatcher -> candidate -> supply targets
```

No runtime source graph traversal, node/edge lookup, or `opsByProgramId` lookup
is needed for V4 execution.

## Runtime Rules

- `evaluateCompiledRouteGraph()` must execute `flatProgramBundle`.
- If a compiled graph lacks usable V4, request runtime must fail closed instead
  of falling back to V3.
- Active graph loading must recompile persisted compiled graphs that do not
  contain a usable V4 bundle.
- Runtime selection must preserve V3 strategy semantics: weighted,
  priority-order, round-robin, stable-first, direct/CEL, target selection, and
  synthetic fallback.
- V4 selects semantic route decisions. Concrete target/endpoint dispatch still
  flows through the token router health layer so endpoint cooldown, recently
  failed avoidance, site runtime breakers, historical success-rate weighting,
  runtime load weighting, and downstream site multipliers remain effective.
- The runtime return contract stays stable so proxy orchestration does not need
  to know which bundle version executed.

## UI And Explainability

Debug views, model-route flow, and pricing estimates should prefer V4 because it
is closer to the executable route shape:

- dispatcher candidates are the visible route alternatives;
- supply targets are data behind candidates, not extra executable graph nodes;
- probability and theoretical cost calculations should walk V4 decisions;
- source refs remain available for focusing the semantic graph or generated
  primitives.

## Consequences

- V4 improves hot-path locality: request runtime reads a compact executable
  plan instead of chasing operation ids.
- The compiler owns more normalization work.
- Tests must cover V4 parity with existing route behavior before V3 helper code
  can be deleted.
- Future performance work can prehydrate V4 into arrays with parsed policies,
  precomputed priority buckets, and matcher regex caches without changing the
  source graph model.
