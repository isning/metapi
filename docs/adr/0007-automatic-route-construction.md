# ADR-0007: Automatic Route Construction With Unified Route Endpoints

Status: Proposed
Date: 2026-06-21

## Context

Automatic model discovery can find the same upstream model through multiple
accounts, API keys, sites, base URLs, upstream compatibility profiles, or
pricing policies. That is normal and desirable: each discovered target is a
candidate supply endpoint.

The route graph must not model each discovered target as an independent public
route. Doing so creates duplicate downstream model declarations:

```text
entry:legacy:439  -> GLM-5.1
entry:legacy:3393 -> GLM-5.1
macro:route:439:model-group:entry  -> GLM-5.1
macro:route:3393:model-group:entry -> GLM-5.1
```

The duplicate validation is correct to reject this. The modeling is wrong.
There should be one public route product per canonical downstream model, with
multiple supply endpoints behind it.

Manual route groups add another requirement: automatically generated route
groups must be stable graph products that users can reference. A manual route
must not have to reference whichever concrete upstream candidate happened to
exist at the time the route was edited.

## Decision

Metapi will use one graph endpoint node type, `route_endpoint`, for both
upstream supplies and reusable route products. The semantic role is expressed by
fields, not by adding more endpoint node types.

```text
route_endpoint endpointKind=supply
  concrete discovered upstream model target; never public

route_endpoint endpointKind=route_product
  reusable routing product; can be public or internal

macro kind=route_builder
  semantic builder that consumes route_endpoint[] and emits a route product
```

The public model declaration belongs only to `entry` nodes generated from a
public route product. Supply endpoints never declare downstream public models.

This ADR refines ADR-0006. `route_endpoint` remains the reusable graph product
abstraction, but it is also the unified endpoint catalog item for concrete
supplies. Code and UI should not introduce a separate
`upstream_route_endpoint` node type.

## Unified Endpoint Contract

`route_endpoint` has one stable identity, one semantic kind, and separate
lifecycle state:

```ts
type RouteEndpointNode = BaseRouteGraphNode & {
  type: 'route_endpoint';
  routeEndpointId: string;
  endpointKind: 'supply' | 'route_product';
  sourceKind:
    | 'upstream_model'
    | 'automatic_model_group'
    | 'manual_group'
    | 'synthetic'
    | 'inline';
  exposure: 'none' | 'public' | 'internal';
  enabled: boolean;
  resolutionStatus: 'resolved' | 'unresolved' | 'degraded';
  match?: RouteGraphMatchSpec;
  resolvesTo?: {
    kind: 'route_endpoint' | 'route_builder' | 'synthetic' | 'external';
    id: string;
  };
  metadata?: Record<string, unknown>;
};
```

`endpointKind` defines behavior:

- `supply`: concrete upstream candidate. It never creates an `entry`, never
  participates in public duplicate validation, and is hidden from normal manual
  pickers unless the user enters advanced mode.
- `route_product`: reusable route output. It is the normal object selected by
  manual routes. It may have public or internal exposure.

`sourceKind` describes provenance:

- `upstream_model`: discovered account/token/base URL/model target;
- `automatic_model_group`: generated model group for a canonical model;
- `manual_group`: user-authored selector/group;
- `synthetic`: fallback/error product;
- `inline`: explicitly declared endpoint embedded in a macro.

The state dimensions intentionally stay separate:

- `exposure` answers: can this endpoint create downstream ingress?
- `enabled` answers: should runtime route traffic through it?
- `resolutionStatus` answers: does the endpoint currently resolve to an
  executable path?
- graph display visibility answers: should the UI draw it by default?

These states must not be collapsed into one enum. A product can be
`exposure = public`, `enabled = true`, and `resolutionStatus = unresolved` when
it remains a public route product but currently has no executable candidates.

## Supply Endpoints

A supply endpoint represents one concrete callable target:

```text
site/account/token/base-url/platform/upstream-model/compatibility/cost-policy
```

Example ids:

```text
route-endpoint:supply:route-endpoint-target:123
route-endpoint:supply:fingerprint:8f54d2b0
```

Metadata records the dimensions used for display, filtering, pricing, and
dispatch:

```json
{
  "canonicalModel": "glm-5.1",
  "upstreamModel": "GLM-5.1",
  "siteId": 1,
  "accountId": 2,
  "tokenId": 3,
  "baseUrlHash": "8f54d2b0",
  "platform": "openai-compatible",
  "compatibilityPolicyRef": "policy:qwen-thinking",
  "pricingPolicyRef": "price:glm-5.1",
  "sourceRouteId": 439,
  "sourceTargetId": 123,
  "fingerprint": "..."
}
```

Identity rules:

- prefer a stable database id when the endpoint is backed by a persisted row,
  such as `route-endpoint-target:{routeEndpointTargetId}`;
- otherwise derive a deterministic fingerprint from stable upstream dimensions;
- display labels may change without changing endpoint identity;
- mutable details belong in metadata and in the fingerprint source, not in a
  hand-concatenated id;
- supply endpoint ids must remain stable enough for advanced manual references.

Supply endpoints have:

```text
endpointKind = supply
exposure = none
resolutionStatus = resolved | degraded | unresolved
sourceKind = upstream_model
```

Supply endpoint `enabled` reflects the concrete upstream target's operator
state. Health, cooldown, quota, and credential errors are metadata and
diagnostics. They may make a supply endpoint degraded or temporarily
non-selectable at runtime, but they should not delete the endpoint identity.

## Route Product Endpoints

A route product endpoint represents a reusable route output. It is the stable
object that manual routes should reference.

Automatic product id:

```text
route-endpoint:product:auto-model:{canonicalModelKey}
```

Manual product id:

```text
route-endpoint:product:manual:{stableRouteIdOrSlug}
```

Rules:

- route products remain stable across automatic rebuilds;
- a route product exposure is public or internal;
- disabled is represented by `enabled = false`, not by exposure;
- unresolved is represented by `resolutionStatus = unresolved`, not by
  exposure;
- a public route product generates exactly one external `entry`;
- a route product does not itself participate in public duplicate validation;
- a product with no current candidates is preserved as `unresolved`, not
  deleted, so manual references do not break;
- manual route builders select route products by default.

## Route Builder Macros

Route builders are semantic macros that consume endpoint references and emit a
route product endpoint.

```ts
type RouteBuilderMacro = RouteGraphMacro & {
  kind: 'route_builder';
  productEndpointId: string;
  exposure: 'public' | 'internal';
  enabled: boolean;
  ingress?: {
    publicModelName: string;
    match: RouteGraphMatchSpec;
  };
  input:
    | { kind: 'endpoint_query'; query: EndpointQuerySpec }
    | { kind: 'route_endpoints'; endpointIds: string[] }
    | { kind: 'inline_endpoints'; endpointIds: string[] };
  policy: RouteDispatchPolicy;
};
```

Automatic model groups and manual groups are both route builders:

```text
automatic model group
  input = endpoint_query(endpointKind=supply, canonicalModel=glm-5.1)
  product = route-endpoint:product:auto-model:glm-5.1

manual group
  input = route_endpoints([
    route-endpoint:product:auto-model:glm-5.1,
    route-endpoint:product:auto-model:glm-5.2
  ])
  product = route-endpoint:product:manual:fast-glm
```

This keeps graph node types unified while preserving semantic intent.

## Automatic Builder

The automatic builder runs in these phases:

1. Discover and normalize upstream model targets.
2. Create or update supply `route_endpoint` nodes.
3. Group supply endpoints by canonical downstream model key.
4. Create one route builder macro per canonical key.
5. Create one route product endpoint per route builder macro.
6. Preserve user-controlled exposure, labels, icons, and dispatch policy.
7. Compile and validate that public model names are globally unique.

The builder must not create more than one enabled public route product for the
same canonical model key.

Candidate grouping:

```text
canonical model key
  -> priority group / pattern bucket
    -> route_endpoint endpointKind=supply []
```

The builder may preserve priority groups from existing route/target ordering.
That ordering belongs in macro policy or candidate metadata, not in duplicate
public route rows.

## Manual Route Integration

Manual route builders consume route products by default:

```text
manual-route
  candidates:
    route-endpoint:product:auto-model:glm-5.1
    route-endpoint:product:auto-model:glm-5.2
```

Advanced mode may allow selecting concrete supply endpoints:

```text
manual-route
  candidates:
    route-endpoint:supply:route-endpoint-target:123
```

The default picker must prefer route products because they survive automatic
rebuilds and keep user intent stable.

If a manual public route wants to reuse the same public name as an automatic
group, the user must first make the automatic group internal or disabled.
Public duplicate validation remains strict.

Manual routes may reference a route product created by an automatic builder or
another manual builder. The reference target is always the product endpoint id,
not the builder macro id and not a transient generated primitive id.

Nested route products are valid, but the compiler must detect cycles in product
resolution:

```text
manual A -> route product B -> route product A  // invalid
```

The runtime resolver should treat a route product as a stable indirection. It
may inline the resolved path for performance after validation, but diagnostics
and UI references must continue to point at the product endpoint and owning
builder.

## Exposure And Visibility

Exposure belongs to route products and answers only whether the product creates
downstream ingress:

- `public`: generate external ingress and appear in public route group lists;
- `internal`: generate no external ingress, but keep product endpoint reusable;
- `none`: used only for supply endpoints.

Operational state is separate:

- `enabled = false`: keep the endpoint and macro, but do not route traffic
  through it;
- `resolutionStatus = unresolved`: keep the endpoint because references exist,
  but surface a diagnostic because there are no executable candidates;
- `resolutionStatus = degraded`: route may still work, but health, quota,
  policy, or partial candidate loss requires user attention.

Exposure is user-controlled state and must be preserved across automatic
rebuilds. Rebuilds may update candidates and metadata, but must not silently
flip public/internal.

Graph display visibility is separate from route exposure. Hiding generated
details in the graph must not affect runtime exposure.

## Canonicalization

Canonical model keys are used for grouping, uniqueness, and stable ids.

Rules:

- trim surrounding whitespace;
- compare case-insensitively;
- preserve original display name separately;
- do not collapse provider aliases unless an explicit alias registry says they
  are equivalent;
- never use localized labels as canonical ids.

Examples:

```text
"MiniMax-M2.7" -> canonical key "minimax-m2.7"
"minimax-m2.7" -> canonical key "minimax-m2.7"
"GLM-5.1"      -> canonical key "glm-5.1"
```

The display label can remain `GLM-5.1` while the stable id uses `glm-5.1`.

## Runtime Semantics

Runtime dispatch for a public automatic group is:

```text
entry(public model)
  -> route builder dispatcher
  -> route_endpoint endpointKind=supply
  -> concrete account/token/target
```

Runtime dispatch for a manual route referencing an automatic product is:

```text
manual entry
  -> manual route builder dispatcher
  -> route_endpoint endpointKind=route_product
  -> automatic route builder dispatcher
  -> route_endpoint endpointKind=supply
  -> concrete account/token/target
```

The compiled graph may inline these paths for execution. The semantic graph
must keep the stable route product endpoint boundary.

Product resolution is recursive but acyclic:

```text
route_product
  -> owning route_builder macro
  -> route_endpoint[] candidates
  -> supply endpoint | route_product | synthetic endpoint
```

Selection policy is evaluated at the builder that owns the product. A route
product reference should not inherit the caller's selection policy unless the
caller explicitly unwraps candidates in advanced mode.

## UI/UX Requirements

The UI should present route products as the primary user-facing objects and
supply endpoints as drill-down details.

### Route Group View

The route group view shows one row per route product, not one row per supply.

Primary tabs are ownership-oriented:

- `Public`: route products with `exposure = public`;
- `Internal`: route products with `exposure = internal`;
- `Manual`: user-authored route builder products;

`Public` and `Internal` include both automatic and manual products. `Manual` is
an authoring filter or secondary tab, not a third exposure state. Disabled and
unresolved products remain in their exposure tab and are additionally surfaced
by an `Issues` filter.

Recommended controls:

- segmented exposure filter: `Public`, `Internal`, `All`;
- ownership filter: `Generated`, `Manual`;
- issue filter: `Needs attention`;
- search over public model, display label, upstream model, site, and account.

Rows show:

- display model name or route group name;
- generated/manual badge;
- exposure state;
- candidate count;
- health and cost summary;
- selected dispatch policy;
- last discovery/update timestamp;
- issue count when unresolved or partially degraded.

Rows should not show raw endpoint ids by default. Endpoint ids belong in details
or copy actions.

### Route Product Inspector

The inspector for a route product should answer:

- what public model, if any, does this product expose?
- what endpoint id should manual routes reference?
- what builder owns this product?
- how many supply endpoints are available?
- what policy chooses among them?
- are there unresolved references or duplicate exposure conflicts?

Primary actions:

- set exposure: public/internal;
- enable or disable the product;
- edit dispatch policy;
- open graph focus;
- copy stable endpoint id;
- view generated supply candidates.

### Supply Candidate Details

Supply endpoints are shown as a compact table or expandable section inside the
route product inspector:

- upstream model;
- site/account/token label;
- platform/base URL;
- health/cooldown;
- measured cost and reference cost;
- compatibility policy;
- priority/weight;
- last verified time.

Supply candidates should be searchable and filterable when a product has many
candidates, but they should not dominate the default route group view.

### Endpoint Picker

Manual route builders use a two-level picker:

1. `Route Products` tab, default.
2. `Supply Endpoints` tab, advanced.

The default tab groups by route product and shows stable references:

```text
GLM-5.1       Generated route product    8 candidates
GLM-5.2       Generated route product    3 candidates
Fast GLM      Manual route product       2 candidates
```

The advanced tab shows concrete supply endpoints with a clear warning that
these references are less resilient to discovery changes.

### Graph View

Default graph view:

- show route builder macros and route product endpoints;
- collapse supply endpoints into candidate counts;
- do not show thousands of generated supply endpoints by default;
- do not show a macro and its expanded generated primitives as competing
  authoritative public routes.

Inspector preview:

- shows generated topology without changing the canvas;
- lists priority groups and supply endpoint summaries;
- allows focusing a route product or supply endpoint.

Canvas expand:

- available from macro context menu or inspector;
- expands only the selected macro;
- hides the macro while showing its read-only generated internals;
- anchors generated nodes around the macro's original position;
- provides a clear collapse action.

Global debug view:

- named `Show compiled graph`;
- hides semantic macros and shows compiled primitives;
- labeled as debug-only so users do not treat it as normal editing mode.

### Empty And Error States

When no supply endpoints exist for a product:

- keep the route product row;
- mark it unresolved;
- explain which discovery source or model key is missing;
- offer actions to disable the product, make it internal, or inspect discovery.

When duplicate public exposure exists:

- show one grouped diagnostic per public model;
- list conflicting products;
- offer direct actions to make one internal or disable it;
- do not expose raw primitive node ids as the primary message unless the user
  opens technical details.

## Migration

Existing automatic exact route generated data requires an explicit one-time
configuration migration. Runtime graph loading does not preserve forward
compatibility with old route-endpoint ids or route-id macro inputs.

```text
route-endpoint:legacy:{routeId}
  -> route-endpoint:product:auto-model:{canonicalModelKey}
     for normal semantic reuse
  -> route-endpoint:supply:route:{routeId}
     only when the old graph intentionally selected one concrete upstream

route:{routeId}:model-group
  -> auto-model:{canonicalModelKey}
     when the route was an automatic exact-model product

duplicate public entries for the same canonical model
  -> one route product public ingress
```

Manual macro inputs that reference old route endpoints must be rewritten before
the graph is accepted:

- if the old endpoint belongs to an automatic exact route, map it to
  `route-endpoint:product:auto-model:{canonicalModelKey}` by default;
- if the user explicitly selected a concrete endpoint in advanced mode,
  preserve the corresponding `route-endpoint:supply:*` reference;
- if the mapping is ambiguous, the migration fails with a clear diagnostic
  rather than guessing;
- after migration, saved/imported graphs using `route-endpoint:legacy:*` or
  `route_ids` are invalid.

The migration must preserve:

- public/internal exposure chosen by the user;
- enabled/disabled state chosen by the user;
- route labels and display icons when user-authored;
- priority/weight ordering where it represents user intent;
- manual route group references to automatic route products;
- unresolved product endpoints when references would otherwise break.

## Validation

Validation rules:

- public model names are unique across enabled public entries;
- supply endpoints do not participate in public duplicate validation;
- every route builder macro has one product route endpoint;
- every route product resolves to a builder, executable supply, synthetic
  response, or explicit unresolved state;
- manual route group references must resolve to route products or explicitly
  allowed supply endpoints;
- automatic rebuild must not create duplicate public products for the same
  canonical key;
- route product resolution must be acyclic;
- supply endpoints must use `exposure = none`;
- route products must not use `exposure = none`;
- disabled products must not generate active runtime entries;
- unresolved route products must surface diagnostics to the UI.

## Test Matrix

The implementation must cover these cases before this ADR is considered done:

- two discovered upstream supplies with model names differing only by case
  produce one automatic route product and multiple supply candidates;
- a single discovered upstream supply still goes through an automatic route
  product, not a special direct public route path;
- automatic rebuild adding a new supply preserves the product endpoint id and
  manual references;
- automatic rebuild removing all supplies keeps the product endpoint unresolved;
- public/internal exposure changes affect ingress only and preserve product id;
- disabled products do not route traffic and do not create active entries;
- manual route builder defaults to selecting route products;
- advanced manual selection can explicitly reference supply endpoints;
- route product nesting resolves correctly and rejects cycles;
- public duplicate diagnostics group conflicts by user-facing public model;
- large generated supply sets render as grouped route products in the graph and
  endpoint picker without drawing every supply endpoint by default.

## Consequences

Benefits:

- duplicate public model errors are eliminated at the source;
- automatic discovery can support many upstream candidates for one model;
- manual route groups get stable references to automatic route products;
- graph types stay unified around `route_endpoint`;
- UI can show route groups instead of thousands of primitive nodes;
- runtime can still inline compiled paths for performance.

Costs:

- automatic builder, migration, endpoint catalog, graph compiler, runtime
  resolver, and UI pickers all need coordinated changes;
- old route-id based references need deterministic migration;
- endpoint identity needs a stable fingerprint contract;
- tests must cover grouping, migration, exposure preservation, manual
  references, and large generated endpoint sets.

## Non-Goals

- This ADR does not replace dispatcher policy design.
- This ADR does not require removing manual concrete supply selection.
- This ADR does not define the full model pricing database.
- This ADR does not change protocol transformer boundaries.
