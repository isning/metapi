# ADR-0009: Graph-Native Macro Candidate Edges

Status: Proposed
Date: 2026-06-22

## Context

ADR-0006 introduced `route_endpoint` as the graph object for reusable route
products. ADR-0007 unified concrete upstream supplies and reusable products
under `route_endpoint` with `endpointKind = supply | route_product`. ADR-0008
introduced the route program bundle as the executable runtime format.

This ADR refines those decisions. In particular, it supersedes ADR-0007's
earlier picker guidance that supply endpoints are hidden from normal manual
pickers. Manual macros may intentionally aggregate concrete supply endpoints,
route products, and synthetic fallbacks in the same selector, as long as the UI
distinguishes their semantics clearly.

The remaining modeling gap is macro candidate ownership. Current
`candidate_selector` macros can store candidate endpoint ids in
`macro.config.groups[].input.endpointIds`, and lowering can materialize those
ids into dispatcher candidates. That is enough for list-style editing, but it
does not make candidate relationships graph-native:

- generated previews may show cloned `route_endpoint` nodes instead of the
  actual upstream supply endpoint;
- a concrete supply endpoint is not visibly connected to the macro that selects
  it;
- generated node and edge ids can become the apparent editing target even though
  automatic graph data is read-only generated data;
- route group lists can drift toward being a parallel route model instead of a
  high-level editor over the semantic graph.

Metapi needs one native graph story:

```text
route_endpoint endpointKind=supply
  -> candidate_selector macro candidates input
  -> generated dispatcher route candidates
```

The route group list is a domain-specific view of this semantic graph. It
must not create or own a separate route system.

## Decision

`candidate_selector` macros will expose a graph-native route input port for
candidates:

```ts
{
  id: 'candidates.in';
  label: 'Candidates';
  direction: 'input';
  kind: 'route';
  accepts: ['route'];
  multiple: true;
  collection: { type: 'set'; min: 1 };
}
```

Automatic route construction connects concrete upstream supply endpoints to
that macro input:

```text
route_endpoint:supply:... route.out
  -> macro:auto-model:... candidates.in
```

Lowering rewrites those semantic macro candidate edges into the primitive
debug graph:

```text
route_endpoint:supply:... route.out
  -> macro:auto-model:...:dispatcher route.in
```

The dispatcher candidate is the `route_endpoint endpointKind=supply` node
itself. It is not a cloned `route_endpoint`. `route_endpoint` may still exist as
a low-level compatibility or target-selection implementation detail, but it is
not the user-facing candidate identity for upstream supply.

`route_endpoint endpointKind=route_product` remains the reusable product
identity for automatic and manual route groups. It may also be selected as a
candidate by another manual macro. In runtime terms:

- `route_endpoint:supply` compiles to `select_supply`;
- `route_endpoint:route_product` compiles to `call_product`;
- `synthetic_endpoint` compiles to `synthetic`.

## Candidate Selector Surface

The default `candidate_selector` macro surface has three conceptual ports:

```text
bidirect.in      incoming request/flow
candidates.in   route candidates, usually supply or product endpoints
route.out        selected route output
```

The visual label for `candidates.in` is "Candidates". The protocol port kind
remains `route`, so existing dispatcher candidate semantics stay coherent.

`candidate_selector` lowering must support:

1. explicit semantic graph edges targeting `macro.candidates.in`;
2. generated edge materialization from `macro.config.groups[].input.endpointIds`
   during migration and transitional editing.

The graph-native edge path is the source model going forward.

## Candidate Configuration And Overrides

Automatic graph nodes and edges are generated graph data. They are not directly
editable. Users must not delete, reconnect, drag-rewire, or mutate automatic
candidate edges on the canvas.

User edits are stored as semantic macro configuration:

```ts
type CandidateSelectorConfig = {
  policy: DispatchPolicy;
  groups: CandidateGroupConfig[];
  candidateOverrides?: {
    bySupplyEndpointId?: Record<string, CandidateOverride>;
    byEndpointId?: Record<string, CandidateOverride>;
  };
};

type CandidateOverride = {
  groupId?: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
  excluded?: boolean;
};
```

For automatic supply candidates, overrides are scoped by owning macro and keyed
by `supplyEndpointId`. Since the overrides live inside the macro config, the
macro id is implicit. The effective candidate is computed as:

```text
effectiveCandidate = generatedDefault + macro candidate override
```

Rules:

- automatic candidate edges are read-only generated output;
- priority bucket changes write `candidateOverrides`;
- weight changes write `candidateOverrides`;
- enable/disable and include/exclude write `candidateOverrides`;
- generated defaults can refresh during rebuild without overwriting user
  overrides;
- orphan overrides are preserved and shown as cleanup candidates if a supply
  endpoint temporarily disappears;
- users can reset generated candidate overrides explicitly from the macro or
  route group UI.

## List View Relationship

The route group list is not a second route model. It is a high-level view of
graph semantic objects:

```text
semantic graph
  -> candidate_selector macros
  -> route_product endpoints
  -> route group list view
```

List edits write graph semantic mutations:

- public/internal exposure -> macro or product exposure override;
- routing strategy -> `macro.config.policy`;
- priority buckets -> `macro.config.groups`;
- candidate enable/disable/weight/exclude ->
  `macro.config.candidateOverrides`;
- display name/icon -> macro or product presentation.

The list must not create bare legacy routes or bare graph nodes. A list-visible
route group must be represented by a `candidate_selector` macro and a stable
`route_endpoint endpointKind=route_product`.

## Manual Macros

Manual route groups use the same semantic shape:

```text
candidate_selector macro + route_product endpoint
```

Manual macros may select mixed candidate endpoint kinds:

- `route_endpoint endpointKind=route_product`;
- `route_endpoint endpointKind=supply`;
- `synthetic_endpoint`.

Manual macro UI must make these candidate kinds visually distinct. A product
endpoint is a stable route product; a supply endpoint is a concrete upstream
target. Both are valid, but they carry different stability and operational
meaning.

The UI must allow users to intentionally aggregate multiple different upstream
model names into one manual macro by selecting concrete supply endpoints.

## Shared Route Endpoint Picker

Endpoint selection is a shared domain component, not a
`candidate_selector`-specific widget.

The shared picker:

- searches a server-backed route endpoint catalog;
- supports product, supply, and synthetic endpoint kinds;
- shows grouped results for Products, Supply Endpoints, and Synthetic/Fallback;
- supports filters for kind, status, exposure, site, provider, model, health,
  and cost when available;
- supports single-select and multi-select modes;
- emits selected endpoint ids and selection metadata;
- detects overlap when a selected product contains a selected supply;
- does not mutate graph state itself.

The caller decides how selected endpoint ids become macro config or graph
semantic edges.

The picker uses catalog APIs as the primary data source. It must not scan the
entire graph on the client for large installations.

## Overlap Semantics

Manual macros may intentionally include both a route product and a concrete
supply endpoint that is already reachable through that product.

This is allowed, but it must be explicit:

- UI warns that the supply is already included by the selected product;
- diagnostics mark the overlap;
- probability and cost views aggregate by terminal supply endpoint so users can
  see the effective total;
- users may keep the explicit duplicate, remove it, or exclude the nested
  product candidate where supported.

The compiler treats direct supply candidates and product-expanded supply
candidates as separate candidate paths unless an explicit override excludes one
of them.

## Runtime And Compilation

The compiler must treat `route_endpoint endpointKind=supply` as an executable
candidate. It should compile directly to `select_supply` using the endpoint
catalog target metadata.

The compiler must treat `route_endpoint endpointKind=route_product` as a
reusable product. It compiles to `call_product`, using
`endpointCatalog.productToProgram` to find the target program.

The lowered debug graph may still show generated primitive entry and dispatcher
nodes for macro inspection, but candidate nodes should remain semantic endpoint
nodes whenever possible. Source maps must point back to:

- the candidate edge or generated candidate edge;
- the owning macro;
- the selected endpoint id;
- any candidate override that affected policy.

## UI Rules

Default graph view:

- shows macros as semantic nodes;
- does not show generated primitive candidate edges by default;
- treats automatic nodes and edges as read-only;
- lets users inspect and focus generated candidates.

Macro inspector and route group details:

- show generated preview using real endpoint candidates;
- provide candidate table editing for groups, weights, enabled state, and
  exclusion;
- expose reset controls for generated candidate overrides;
- link each candidate to the corresponding endpoint node in graph view.

Compiled/debug graph view:

- may show `supply.route.out -> dispatcher.route.in`;
- must not present generated edges as directly editable if ownership is
  automatic.

## Consequences

Benefits:

- candidate identity, cost, health, and diagnostics all attach to the same
  supply endpoint;
- generated graph previews link to actual graph endpoints, not clone nodes;
- list and graph editing share one semantic source of truth;
- automatic rebuilds can refresh generated graph data while preserving user
  overrides;
- manual macros can aggregate products, concrete supplies, and synthetic
  fallbacks with one picker.

Costs:

- macro port/lowering logic must support `candidates.in`;
- automatic construction must generate semantic supply-to-macro edges;
- candidate table editing must move from direct graph edge mutation to macro
  override mutation;
- route program compilation must compile supply endpoints directly;
- endpoint picker requires a richer catalog/search contract.

## Migration

Migration should:

1. Add `candidates.in` to candidate selector surface ports.
2. Convert authored `macro.config.groups[].input.endpointIds` to semantic
   `supply/product -> macro.candidates.in` edges when deterministic.
3. Preserve group policy by moving candidate instance properties into
   `candidateOverrides` or generated edge metadata.
4. Preserve automatic graph data as read-only generated data.
5. Recompile active route graphs to program bundle v3.
6. Fail import with actionable diagnostics if candidate ownership cannot be
   determined.

No runtime compatibility with editable automatic edges is required.
