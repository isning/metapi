# ADR-0015: Persisted Route Groups

Status: Proposed
Date: 2026-06-24

## Context

ADR-0007 defines automatic model groups as route products, but the first
implementation still let automatic discovery write only legacy runtime rows and
then rebuild graph macros from those rows. That made the graph macro look like a
route group while the route page had no matching persisted object.

This breaks the domain model:

- route groups are the user-visible routing object;
- source routes and supply endpoints are internal candidates and may be reused
  by multiple groups;
- public requestable model entries should come from route graph macro external
  entries or user-authored graph nodes;
- automatic route groups must not exist only as graph sync artifacts.

## Decision

Metapi will persist route groups as first-class data. Graph macros are rendered
products of persisted route groups, not the place where route groups are born.

The automatic route group key is the upstream original model name:

```text
kind = automatic
groupKey = upstream:{upstreamModelName}
```

Manual route groups keep user-defined names and identities. Automatic and manual
route groups use the same persistence shape, differing by `kind` and source
mode.

## Schema Shape

The route group persistence model is:

- `route_groups`: the persisted routing product, including automatic/manual
  kind, display state, public/internal exposure, route strategy, sync state, and
  user override JSON.
- `route_supply_endpoints`: concrete upstream supplies discovered from
  site/account/token/route-unit/upstream-model availability.
- `route_group_buckets`: priority buckets owned by a route group.
- `route_group_candidates`: references from a group bucket to either a supply
  endpoint or another route group.
- `route_supply_endpoint_state`: runtime state mirror for the supply endpoint
  identity.

`route_group_candidates` references supplies by identity. A supply endpoint is
not owned by one route group and may appear in multiple groups.

## Compatibility Bridge

During migration, `token_routes` and `route_endpoint_targets` remain the runtime
projection used by the existing graph compiler and token router.

For each automatic route group, the sync layer creates or updates one legacy
bridge route:

```text
route_groups.legacy_route_id -> token_routes.id
route_supply_endpoints.legacy_target_id -> route_endpoint_targets.id
```

This bridge is compatibility infrastructure, not the domain source of truth.
New UI and API work should prefer route group projections. Runtime execution can
move from the bridge tables to route groups in a later slice.

## Invariants

- An automatic upstream model has one persisted automatic route group.
- Rebuilds update existing automatic route groups instead of synthesizing only a
  graph macro.
- User overrides on route group exposure, enablement, strategy, labels, and
  candidate edits survive automatic rebuild.
- Missing current supply marks a group unresolved; it does not delete the route
  group identity.
- Source/supply endpoint identity is reusable and never implies unique route
  group ownership.
- The route graph renderer may emit macro external entries, but those macros are
  projections of persisted route groups.

## Consequences

The route page can list automatic route groups by reading persisted route
groups instead of reverse-engineering graph macros. Model marketplace and route
execution still work during migration because the bridge keeps existing graph
and runtime code fed.

The next deepening step is to make the graph builder consume
`route_groups + buckets + candidates` directly and delete automatic route group
inference from legacy exact routes.
