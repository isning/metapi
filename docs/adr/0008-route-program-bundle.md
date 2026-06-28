# ADR-0008: Route Program Bundle

Status: Accepted
Date: 2026-06-21

## Context

Metapi's route graph editor now models routes with semantic objects:

- `entry` is external downstream ingress.
- `route_endpoint endpointKind=supply` is a concrete upstream candidate.
- `route_endpoint endpointKind=route_product` is a reusable routing product.
- macros describe higher-level route construction and can lower to primitive
  graph nodes for debug.

The current compiled artifact, `CompiledRouteGraph`, is still primarily a graph
snapshot plus indexes:

- `nodesById`
- `edgesBySource`
- `edgesByFromPort`
- `entries`
- `routeEndpoints`
- `terminals`

The runtime evaluator reconstructs a graph-like source from the compiled
snapshot and then interprets graph edges. That is useful for compatibility, but
it is not the right long-term execution representation:

- every request pays for graph interpretation work that can be done at compile
  time;
- runtime selection must understand UI/debug graph details;
- target, pool, token, site, and account concepts can leak into route graph
  execution as graph-level objects;
- diagnostics and UI source mapping are harder because the executable shape is
  not explicit;
- compiled debug expansion and executable dispatch compete for the same data
  model.

ADR-0006 and ADR-0007 define the semantic graph model. This ADR defines the
compiled executable model that should sit under it.

## Decision

Metapi will introduce `RouteProgramBundle` as the executable compiled route
format. It is a route dispatch IR, not another editable graph.

The source and compiled layers become:

1. **Semantic Graph**: user-authored graph and macros, represented by
   `RouteGraphSource`.
2. **Lowered Debug Graph**: generated primitive nodes and edges used for UI
   preview, tests, and diagnostics.
3. **Route Program Bundle**: executable matcher table, route programs, endpoint
   catalog, and source maps.
4. **Runtime Hydrated Plan**: in-memory optimized indexes/state-machine helpers
   built from the program bundle.

`CompiledRouteGraph` keeps graph index fields for UI/debug consumers while
carrying `programBundle`. Those graph indexes are not the execution contract.
The request runtime executes `RouteProgramBundle`; it must not reconstruct or
interpret the editable graph snapshot per request.

## Route Program Bundle

`RouteProgramBundle` has these top-level sections:

```ts
type RouteProgramBundle = {
  version: 1;
  hash: string;
  matcher: RouteMatcherTable;
  programs: RouteProgram[];
  endpointCatalog: RouteProgramEndpointCatalog;
  debug: RouteProgramDebugInfo;
  diagnostics: RouteProgramDiagnostic[];
};
```

The bundle is request-oriented. It answers:

- which program matches a requested downstream model;
- which executable operations are needed;
- which semantic route endpoints and generated primitives are involved;
- how diagnostics map back to semantic graph objects.

It does not try to preserve the editable graph layout.

## Matcher Table

The matcher table is the first runtime index:

```ts
type RouteMatcherTable = {
  exact: Record<string, RouteMatcherTarget>;
  normalizedExact: Record<string, RouteMatcherTarget>;
  patterns: RouteMatcherPattern[];
};
```

Rules:

- exact public model names use the original case key in `exact`;
- normalized exact names use a lower-case canonical key in
  `normalizedExact`;
- wildcard and regex patterns are precompiled or validated during hydration;
- duplicate public model validation remains strict before the bundle is used;
- matcher entries point to program ids, not graph node ids.

## Programs And Operations

A program is a linearized executable plan with source mapping:

```ts
type RouteProgram = {
  id: string;
  entryNodeId: string;
  publicModelName: string;
  enabled: boolean;
  rootEndpointId?: string | null;
  startOpId?: string | null;
  ops: RouteProgramOp[];
  sourceRef: RouteProgramSourceRef;
};
```

Initial operation vocabulary:

```ts
type RouteProgramOp =
  | { op: 'filter'; phase: 'pre_selection' | 'post_build'; nodeId: string; operations: RouteFilter[]; nextOpId?: string | null }
  | { op: 'dispatch'; mode: 'route' | 'flow' | 'target'; nodeId: string; policy: DispatcherPolicy; candidates: RouteProgramCandidate[] }
  | { op: 'call_product'; endpointId: string; nextOpId?: string | null }
  | { op: 'select_supply'; endpointId: string; targets: CompiledEndpointTarget[]; targetSelectionPolicy?: Record<string, unknown> }
  | { op: 'synthetic'; nodeId: string; statusCode: number; message: string };
```

`target`, `pool`, `token`, `site`, and `account` stay inside
`CompiledEndpointTarget` metadata. They must not become top-level compiled graph
concepts.

Route products are allowed to inline their resolved executable path for
performance, but source maps must keep pointing to the owning `route_endpoint`
and macro.

## Endpoint Catalog View

The program bundle owns a catalog view used by runtime and UI:

```ts
type RouteProgramEndpointCatalog = {
  byId: Record<string, RouteProgramEndpoint>;
  productToProgram: Record<string, string>;
  supplyTargets: Record<string, CompiledEndpointTarget[]>;
};
```

Rules:

- supply endpoints are concrete candidates and never expose public models;
- route product endpoints are stable reusable products;
- public route products may map to a public program;
- internal route products may map to reusable programs without matcher entries;
- unresolved products remain catalog entries with diagnostics instead of being
  deleted.

## Source References

Every program, matcher entry, endpoint, candidate, and diagnostic should carry a
source reference:

```ts
type RouteProgramSourceRef = {
  nodeId?: string;
  edgeId?: string;
  macroId?: string;
  endpointId?: string;
  routeId?: number | null;
  generatedNodeIds?: string[];
  generatedEdgeIds?: string[];
};
```

This keeps the runtime IR compact while still allowing:

- inspector focus from program/candidate to semantic objects;
- debug graph expansion from a macro or route product;
- actionable import/compile diagnostics.

## Validation Layers

Diagnostics use explicit layers:

- `semantic.*`: invalid source graph or macro contract.
- `lowering.*`: macro lowering and generated primitive graph errors.
- `program.*`: executable bundle errors.

Examples:

- `program.matcher_duplicate`
- `program.entry_without_program`
- `program.endpoint_unresolved`
- `program.cycle`
- `program.unsupported_shape`

Runtime must not silently guess around `program.*` errors.

The compiler merges `program.*` diagnostics into the top-level compile result.
The runtime refuses bundles with executable program errors, missing start ops, or
invalid regex patterns. Persisted active graphs that lack an executable bundle
are recompiled from their semantic source before use.

## Migration Plan

This change is implemented in stages:

1. Add `programBundle` alongside the existing compiled graph index fields.
2. Build matcher, endpoint catalog, and source maps from the lowered primitive
   graph.
3. Generate executable operations for the graph shapes currently supported by
   runtime.
4. Add a hydrated evaluator and test it against the existing graph evaluator.
5. Switch request dispatch to the hydrated evaluator.
6. Recompile persisted active graphs that lack an executable bundle.
7. Remove graph interpretation from request runtime.

Persisted compiled JSON may carry both graph indexes and `programBundle`.
That is not the execution contract; graph indexes exist for debug and UI
consumers, while runtime uses program source maps and endpoint catalog views.

## Consequences

Positive:

- request dispatch can avoid graph reconstruction;
- macro/default graph views can stay semantic while debug views stay generated;
- endpoint reuse and manual route references have a native executable target;
- diagnostics become easier to map to UI;
- future policy compilation can be optimized like an AST/state machine.

Tradeoffs:

- the compiler becomes more explicit and needs parity tests against the current
  evaluator during migration;
- UI debug views must read source maps instead of assuming compiled graph nodes
  are the authoritative runtime shape;
- migration needs one deliberate removal step for request-time graph
  interpretation after the program evaluator is stable.
