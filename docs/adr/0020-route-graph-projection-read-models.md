# ADR-0020: Route Graph Projection Read Models

Status: Proposed
Date: 2026-06-29

## Context

ADR-0015 made route groups persistent domain objects. ADR-0017 separated graph
supply endpoints from executable endpoint profiles. ADR-0019 defined the
single-pass compiled router so request routing can execute a compact data-plane
plan instead of walking source graph structure.

Those decisions move routing in the right direction, but the active route graph
is still too often treated as one document-shaped interface:

```text
active version
  -> sourceGraphJson
  -> compiledGraphJson
```

That shape is acceptable for small debugging graphs. It is not acceptable as a
general production read path. With hundreds of route groups it already creates
memory and CPU pressure. With ten thousand route groups, the source graph and
compiled graph can become hundreds of megabytes or even gigabytes once targets,
metadata, trace refs, and debugging structures are included.

The problematic pattern is not one specific endpoint. The problem is the
interface itself: callers can ask for "the active graph" and then each caller
decides locally how much of it to load, parse, hydrate, serialize, filter, or
cache. That makes performance unpredictable and spreads graph-size knowledge
across routes, pages, and runtime modules.

Metapi needs a route graph storage and read interface that remains predictable
when there are at least 10,000 route groups.

## Decision

Metapi will stop treating the full route graph as a normal read interface.

The active graph becomes an immutable version manifest plus bounded projection
read models. Full source graph and full compiled graph remain available only as
debug/export artifacts, not as the interface used by ordinary admin pages,
model marketplace, model details, playground routing, route-flow, or request
routing.

The primary route graph read interfaces are:

- active version manifest;
- paged route group and route product summaries;
- paged supply endpoint catalog;
- route/product scoped subgraph reads;
- compiled match index and compiled plan lookup;
- background streaming export for full graph JSON.

The source graph remains the authoring model. The compiled router remains the
request data-plane model. Neither full model is allowed to leak into ordinary
read paths.

## Version Manifest

The active version manifest is the smallest stable route graph interface:

```ts
type RouteGraphActiveManifest = {
  version: {
    id: number;
    version: number;
    status: 'active';
    createdAt: string | null;
    activatedAt: string | null;
  };
  counts: {
    routeGroups: number;
    routeProducts: number;
    supplyEndpoints: number;
    sourceNodes: number;
    sourceEdges: number;
    sourceMacros: number;
    compiledPlans: number;
  };
  hashes: {
    sourceGraph: string;
    compiledRouter: string | null;
    projections: string;
  };
  capabilities: {
    fullGraphExport: boolean;
    sourceSubgraph: boolean;
    compiledPlanLookup: boolean;
  };
};
```

Rules:

- `GET /api/route-graph/active` returns this manifest by default.
- The manifest response must not include `sourceGraph`, `compiledGraph`,
  `programBundle`, `flatProgramBundle`, or `compiledRouterBundle`.
- The manifest response target is less than 10 KB even at 10,000 route groups.
- Every ordinary UI page should be able to decide what to load next from the
  manifest without fetching a full graph.

## Projection Tables

Publishing or rebuilding a route graph version produces immutable projection
rows. The exact schema may evolve, but the storage shape is table-oriented:

```text
route_graph_versions
route_graph_nodes
route_graph_edges
route_graph_macros
route_graph_route_products
route_graph_supply_endpoints
route_graph_route_group_summaries
compiled_router_match_index
compiled_router_plans
compiled_router_plan_endpoints
```

### `route_graph_versions`

Stores the manifest-level metadata:

- id;
- version number;
- status;
- created/activated timestamps;
- source hash;
- compiled router hash;
- projection hash;
- counts;
- debug/export artifact refs.

### `route_graph_nodes`, `route_graph_edges`, `route_graph_macros`

Store source graph authoring objects by version and id:

```text
version_id + node_id
version_id + edge_id
version_id + macro_id
```

Rows include searchable scalar columns for common filters:

- type;
- route id;
- endpoint kind;
- exposure;
- visibility;
- owner kind;
- enabled;
- source kind;
- display label;
- public model name;

The raw JSON blob is stored as payload for edit/debug views, but ordinary
filters and list views must not parse every blob.

### `route_graph_route_products`

Stores public/internal route products and route-group-facing summaries:

- route/product id;
- route id;
- public model name;
- display label/icon;
- exposure;
- enabled;
- route mode;
- target count;
- enabled target count;
- site names summary;
- pricing summary refs;
- route group refs;
- active version id.

Model marketplace and route pages read this projection, not full graph JSON.

### `route_graph_supply_endpoints`

Stores concrete supply endpoint catalog rows:

- supply endpoint id;
- route id;
- endpoint identity fingerprint;
- model name;
- site id/name;
- account/credential refs;
- token/route-unit refs;
- enabled;
- priority/weight;
- target count;
- health and cooldown summary refs;
- endpoint profile summary refs.

The model playground, route-flow evidence, and route endpoint picker read this
projection. They do not hydrate compiled graph endpoint catalogs.

### `compiled_router_match_index`

Stores model matching data for the runtime:

```text
version_id + match_kind + match_key -> plan_id
```

The match index is optimized for lookup, not debugging. Exact model matches and
normalized exact matches must not require scanning all plans. Pattern matches
may be stored in priority order and bounded by compile-time limits.

### `compiled_router_plans`

Stores one executable compact plan per public route product or entry:

- plan id;
- version id;
- entry node id;
- route/product id;
- public model name;
- enabled;
- compact plan blob;
- plan hash;
- byte size;
- dependency refs;
- diagnostics.

The runtime loads only the matched plan, with a bounded LRU cache. It must not
load the full compiled router bundle for ordinary request routing.

## Read Interfaces

The route graph external seam is split into bounded interfaces.

### Manifest

```text
GET /api/route-graph/active
GET /api/route-graph/active/manifest
```

Both return the active manifest. The first endpoint keeps compatibility with
older clients but must remain lightweight.

### Paged Catalogs

```text
GET /api/routes/summary?page=&pageSize=&q=&kind=&enabled=&visibility=
GET /api/route-endpoints?page=&pageSize=&q=&routeId=&siteId=&endpointKind=
GET /api/models/marketplace?page=&pageSize=&q=&brand=&coverage=
```

Rules:

- every list endpoint has an explicit page size cap;
- the default page size is tuned for UI rendering, not export;
- response size must be bounded;
- no list endpoint may call an interface that returns full source or compiled
  graph objects.

### Subgraph Reads

```text
GET /api/route-graph/subgraph?centerNodeId=&depth=
GET /api/route-graph/routes/:routeId/subgraph
GET /api/route-graph/macros/:macroId/subgraph
```

Rules:

- subgraph reads are bounded by node and edge limits;
- callers receive `truncated: true` and cursors when limits are reached;
- graph editor views request more data intentionally;
- subgraph reads use projection tables and id indexes, not a full graph scan.

## Admin UX Contract

Projection pagination is a data access mechanism, not the visual model for the
graph editor. The route graph editor must feel like a progressive graph
explorer:

- opening the editor loads a manifest plus the current working neighborhood,
  not the full graph;
- the canvas shows a bounded, meaningful neighborhood around the selected
  route product, macro, endpoint, or search result;
- route groups, products, and endpoints are found through searchable indexes
  with incremental loading and real total counts;
- expanding a macro or route product loads the next subgraph slice in place
  instead of navigating to a rigid page number;
- selected entities stay pinned in local UI state even when they are outside
  the current search result page;
- endpoint pickers use backend search and "load more" affordances, not a
  first-page local filter;
- the JSON view is a sectioned explorer for manifest, selected entity,
  diagnostics, and small subgraph JSON. Full graph JSON is an explicit
  export/import workflow, not the default editor surface.

The user should not have to understand projection page numbers to edit a graph.
Pagination state stays behind search, focus, expand, and load-more actions.

Graph-editor tests should assert observable outcomes:

- opening the graph editor does not request full active or draft graph JSON;
- search can find a route group, route product, or endpoint beyond the first
  page and displays the real total;
- expanding a macro fetches and renders its neighborhood without replacing the
  whole canvas;
- selected endpoints keep readable labels when the catalog page changes;
- the JSON editor does not stringify the full graph by default;
- route editor, model marketplace, model details, and playground paths keep
  working at 10,000 route groups with bounded payload size.

### Compiled Plan Lookup

```text
GET /api/route-graph/compiled-plans/:planId
GET /api/routes/decision?model=
```

Rules:

- decision preview uses the same match index and plan lookup as runtime;
- route-flow loads the matched plan and the referenced endpoint summaries;
- compiled plan debug output is bounded and may omit large target metadata by
  default.

### Full Export

```text
POST /api/route-graph/export
GET /api/tasks/:taskId
GET /api/route-graph/export/:artifactId
```

Rules:

- full graph export is a background task;
- export streams from projection rows;
- export must not build the entire graph in memory;
- export artifacts are size-limited and retained by policy;
- full export is for backup/debug, not interactive page rendering.

## Write And Publish Flow

Route graph writes build a new immutable version, then atomically flip the
active pointer.

```text
route/target/group change
  -> mark affected route graph partitions dirty
  -> build source projections
  -> build compiled match index and plans
  -> validate projection invariants
  -> publish version
  -> atomically update active pointer
  -> schedule old-version cleanup
```

Rules:

- readers pin one `active_version_id` at request start;
- readers never observe partially built projections;
- writers do not mutate active version rows in place;
- old versions remain readable until in-flight requests finish or a retention
  window expires;
- failed projection builds do not change the active pointer.

## Incremental Rebuilds

Full rebuild remains available as a maintenance operation, but ordinary writes
should rebuild only affected partitions.

Examples:

- changing one route target rebuilds that route's supply endpoint projection,
  route product summary, affected compiled plan, and route-flow evidence refs;
- changing a route group's candidate bucket rebuilds that group product and its
  compiled plan;
- changing endpoint profile capability rebuilds affected supply endpoint
  projections and plans that reference them;
- changing global matching rules may require a match-index rebuild.

Dirty partitions are identified by stable ids:

```text
route id
route group id
supply endpoint id
compiled plan id
model/catalog source id
endpoint profile id
```

The implementation may initially use coarser invalidation, but the interface
must not require full graph materialization.

## Write-Path Optimization

The current compatibility implementation still has a dangerous write path:

```text
route table rows
  -> buildRouteGraphSourceFromRouteTable()
  -> full RouteGraphSource object
  -> compileRouteGraphSource()
  -> full CompiledRouteGraph object
  -> JSON.stringify(sourceGraph)
  -> JSON.stringify(compiledGraph)
  -> active route_graph_versions row
```

This path is not acceptable for production-scale rebuilds. A 10,000 route-group
fixture produced an 85 MB source graph JSON artifact before compile, and publish
reached multi-GB RSS while using one full CPU. The root cause is not one
inefficient loop. The root cause is that the write path creates several full
copies of the route graph in memory:

- route-table rows and joined target/account/site/token rows;
- semantic source graph nodes, edges, and macros;
- compiled graph indexes and plans;
- serialized source JSON;
- serialized compiled JSON;
- hydrated active caches.

Metapi will therefore make route-table publishing a projection delta operation,
not a full graph publish operation.

### New Publishing Interface

Route-table writes call a bounded publisher:

```ts
type RouteGraphProjectionPublisher = {
  publishRouteTableDelta(input: {
    reason: string;
    dirtyRouteIds?: number[];
    dirtyTargetIds?: number[];
    dirtyGroupIds?: number[];
    dirtySupplyEndpointIds?: number[];
    allowDiagnostics?: boolean;
  }): Promise<RouteGraphProjectionPublishResult>;

  rebuildRouteTableProjections(input: {
    reason: string;
    pageSize?: number;
    allowDiagnostics?: boolean;
  }): Promise<RouteGraphProjectionPublishResult>;
};
```

Rules:

- `publishRouteTableDelta()` is the normal path for route, target, group,
  account-token, endpoint-profile, and visibility changes.
- It loads only dirty routes plus their dependency closure.
- It emits route product projections, supply endpoint projections, match-index
  rows, and compact compiled plans directly.
- It must not call `buildRouteGraphSourceFromRouteTable()`.
- It must not call `compileRouteGraphSource()` for route-table generated
  content.
- It must not serialize full source or compiled graph JSON.
- `rebuildRouteTableProjections()` is a maintenance/background operation. It
  processes rows in pages and flushes projections after each page. It must not
  hold all routes, all targets, all source nodes, or all compiled plans in one
  JavaScript object.

The existing full graph compiler remains available only for manual graph drafts,
bounded debug fixtures, compatibility tests, and export jobs.

### Copy-On-Write Projection Rows

Projection tables use validity intervals so publish does not copy unchanged
rows:

```text
valid_from_version <= pinned_version
and (valid_to_version is null or valid_to_version >= pinned_version)
```

For each dirty projection key, publishing:

1. creates a new `route_graph_versions` row in `building` status;
2. computes the dirty dependency closure;
3. expires previous rows for dirty keys by setting `valid_to_version`;
4. inserts replacement projection rows with `valid_from_version` equal to the
   new version id;
5. validates the manifest counts and dependency hashes;
6. atomically flips `route_graph_active_version` to the new version;
7. marks old rows eligible for cleanup after the retention window.

Unchanged rows are shared across versions through their validity interval. This
keeps single-route publishes proportional to the changed dependency closure
instead of total route graph size.

Indexes must support the common query shapes:

```text
(route_id, valid_from_version, valid_to_version)
(endpoint_id, valid_from_version, valid_to_version)
(match_kind, match_key, valid_from_version, valid_to_version)
(plan_id, valid_from_version, valid_to_version)
(valid_to_version)
```

SQLite, MySQL, and Postgres implementations may use dialect-specific partial or
covering indexes, but the logical contract is the same.

### Dirty Dependency Closure

The dirty closure is explicit and bounded:

- changing a route target dirties the source route, parent explicit groups that
  reference the route, and any plans whose route product depends on those
  groups;
- changing a route match, visibility, enabled state, or route backend dirties
  that route, its match-index entry, and parent groups;
- changing a route-group bucket or candidate dirties that group and parent
  groups;
- changing account, token, site, endpoint profile, or credential binding state
  dirties the supply endpoints that reference it and every route product whose
  plan depends on those supply endpoints;
- changing global matching semantics dirties the match index and may require a
  background full projection rebuild.

Graph construction already forbids cycles. The dirty closure still enforces a
maximum depth and maximum touched row count. When a change exceeds the
synchronous budget, the API stores the route-table mutation, queues a background
projection rebuild task, and returns task state instead of compiling a giant
graph inline.

### Direct Plan Compilation

Route-table generated content compiles from projection inputs, not from source
graph nodes:

```text
route product row
route group sources/candidates
supply endpoint rows
route strategy and selector config
runtime capability state
  -> compact compiled plan
  -> match-index rows
```

The compiler emits one compact plan per route product. It does not create
`programBundle`, recursive `RouteFlatDecision`, debug endpoint catalogs, or
primitive source nodes for the hot persisted artifact.

Manual graph drafts may still compile through the semantic graph compiler. When
manual graph products reference route-table products or supply endpoints, the
compiler stores dependency refs and plan refs rather than embedding every target
payload.

### Full Graph Export

Full source and compiled graph JSON become export artifacts, not publish
artifacts.

Rules:

- normal route-table publish stores manifest/projection/plan rows only;
- `sourceGraphJson` and `compiledGraphJson` are nullable or compact metadata for
  new versions after the migration;
- full export streams from projection rows and writes to a retained artifact;
- export has a byte budget, truncation metadata, and background task progress;
- `GET /api/route-graph/active?include=full` is retained only as a
  compatibility/debug path and must reject or redirect to export when the active
  graph exceeds the configured size cap.

### Write Path Budgets

At 10,000 route groups:

- single route target create/update/delete: synchronous projection publish p95
  under 50 ms CPU when the dirty closure is below the configured row cap;
- single route visibility/enabled change: p95 under 50 ms CPU;
- default admin reads immediately after publish: no full graph hydration and
  less than 32 MiB retained heap delta;
- full route-table projection rebuild: background task, bounded by page size,
  no more than 128 MiB retained heap delta after GC;
- rebuild progress updates at least once per processed page;
- forced full graph export: background task only, with explicit size reporting.

If a synchronous write cannot meet the budget, the correct behavior is to
persist the domain mutation, mark projections stale, enqueue a rebuild task, and
return stale/progress metadata. Blocking the HTTP request while compiling a full
active graph is not allowed.

### Compatibility Cutover

The cutover removes full graph publication from ordinary route-table writes in
stages:

1. Add projection-version tables and validity-interval cleanup.
2. Add `RouteGraphProjectionPublisher` and budget tests.
3. Teach route/target/group write paths to call `publishRouteTableDelta()`.
4. Keep the old `reconcileActiveGraphWithRouteTable()` behind a debug flag for
   compatibility tests only.
5. Move runtime lookup to match-index and plan rows.
6. Move full graph export to a background streaming task.
7. Add architecture tests forbidding route-table write paths from calling
   `buildRouteGraphSourceFromRouteTable()`, `compileRouteGraphSource()`, or
   `reconcileActiveGraphWithRouteTable()`.
8. Remove the compatibility full graph write path once migration tests prove
   old rows can be read or exported.

## Runtime Interface

Request routing uses the compiled match index and matched plan:

```ts
type RouteRuntimeStore = {
  getActiveVersionId(): number;
  matchPlan(input: {
    versionId: number;
    requestedModel: string;
  }): CompiledPlanRef | null;
  loadPlan(input: {
    versionId: number;
    planId: string;
  }): CompiledRouterPlan | null;
};
```

Decision execution remains the ADR-0019 pure function:

```ts
decideRoute(plan, {
  request,
  runtimeState,
  attemptResults,
  randomSeed,
  now,
}, scratch)
```

Rules:

- runtime must not call `ensureActiveRouteGraphVersion()` on the request hot
  path;
- runtime must not parse `sourceGraphJson`;
- runtime must not parse a full `compiledGraphJson`;
- runtime may keep a bounded LRU cache of compiled plans;
- cache eviction must not affect correctness;
- runtime memory must grow with active hot plans, not total route groups.

## Consistency Model

Read consistency is versioned snapshot consistency:

- one request reads one active version id;
- all projection reads in that request use the pinned version id;
- a concurrent publish may make a newer version active for later requests;
- old-version cleanup must not delete rows still needed by in-flight requests.

Runtime mutable state keeps the ADR-0019 consistency classes:

- snapshot state for health, cooldown, availability, pricing, and route config;
- optimistic state for selector cursors and lightweight counters;
- strong state for quota, paid balance, downstream key budget, and security
  gates.

Projection reads are snapshot state. They are optimized for throughput and
predictable memory.

## Size Guards

The following operations are forbidden in ordinary request and admin page
paths:

- returning full source graph by default;
- returning full compiled graph by default;
- `JSON.parse()` of full active graph JSON;
- `JSON.stringify()` of full active graph JSON;
- hydrating all compiled plans to answer one model request;
- scanning every graph node for marketplace or route summary data;
- storing recursive `RouteFlatDecision` bundles in active production
  projections.

Debug endpoints may perform expensive operations only when all are true:

- the caller explicitly requests a debug/export operation;
- the operation has a byte or row limit;
- the response can indicate truncation;
- large exports run as background tasks or streams.

## Performance Requirements

At 10,000 route groups, the target performance envelope is:

- active manifest: less than 10 KB response, p95 under 10 ms;
- paged route summary: p95 under 50 ms for default page size;
- paged route endpoint catalog: p95 under 50 ms for default page size;
- route decision for exact/group model names: p95 under 10 ms CPU, including
  cold model-candidate cache, at 10,000 route groups;
- route decision for wildcard/regex fallback: p95 under 50 ms CPU after the
  bounded route snapshot cache is warm;
- route-flow for one model: p95 under 50 ms;
- graph subgraph read: p95 under 50 ms for bounded depth/page size;
- ordinary admin page read memory delta: less than 32 MiB;
- runtime route graph cache: bounded by configuration and independent of total
  route group count;
- request routing must not create, reconcile, or compile an active graph when no
  active graph exists; it may only evaluate an already-active runtime graph or
  fall back to table projections;
- container RSS remains predictable under 512 MiB with the default production
  Node heap cap.

These numbers are regression-test targets. They may be tuned with evidence, but
the invariant remains: ordinary reads scale with page size, selected plan size,
or bounded subgraph size, not full graph size.

## Concurrency Targets

The runtime routing SLO is measured at the service seam before upstream network
I/O. It covers selecting the route, selecting the target, and constructing the
route execution scope.

For a deployment with 10,000 route groups and one supply target per group:

- one exact/group model cold route decision: less than 50 ms CPU;
- 128 concurrent requests for the same cold model: less than 50 ms total routing
  CPU, with model-candidate and route-match loads coalesced into one in-flight
  load each;
- 12,800 distinct cold exact/group route decisions, executed 2,048-wide: at least
  1,500 routing decisions per CPU second;
- hot exact/group route decision: less than 2 ms average routing CPU;
- no unbounded growth in per-model or per-route runtime caches under high
  cardinality traffic; caches must use bounded eviction.

The single-request CPU budget remains the primary guardrail. The concurrent
batch budgets prevent a burst of cache misses from serializing full graph or
route-table scans onto the event loop.

The executable performance gate is `npm run test:performance`. It seeds at least
12,800 route groups on an isolated SQLite runtime database, rebuilds route binding
projections, and measures the public token router selection seam before upstream
network I/O. The gate currently enforces:

- one cold exact/group decision under 50 ms CPU and 100 ms elapsed;
- 128 concurrent requests for the same cold model under 75 ms total CPU and at
  least 1,500 routing decisions per CPU second;
- 12,800 distinct cold models, executed 2,048-wide, at least 1,500 routing
  decisions per CPU second, with the total CPU budget derived from that QPS
  target;
- 1,000 hot same-model decisions under 1 ms average CPU and at least 1,000
  routing decisions per CPU second;
- 1,000 distinct sequential decisions under 2 ms average CPU;
- bounded runtime caches at 4,096 model-candidate entries and 4,096 route-match
  entries;
- retained routing heap growth under 64 MiB and final gate heap under 256 MiB
  while running Node with `--max-old-space-size=384`.

The reported QPS values are routing-decision throughput numbers, not full proxy
HTTP throughput, because upstream I/O and client streaming are intentionally
outside this runtime seam.

The distinct-concurrent gate also records token-router counter deltas. The
12,800 reported operations must correspond to 12,800 cold logical candidate
loads and 12,800 cold logical match loads. The expected candidate and match
batch count is `ceil(samples / width)`, so the gate fails if cache hits or
incorrect batching make the QPS number look better than the path actually is.

The gate must publish detailed reports on every CI run:

- Markdown: `test-results/performance/route-runtime-performance-report.md`;
- JSON: `test-results/performance/route-runtime-performance-report.json`;
- GitHub Actions step summary: append the Markdown report plus bounded
  throughput and matrix snapshot reports when available;
- GitHub Actions artifact: upload the complete `test-results/performance/`
  directory, even when the gate fails.

Sustained route-decision capacity planning uses `npm run
bench:performance:throughput`. This is not a default merge gate. It runs a
closed-loop benchmark against the token router selection seam with warmup,
duration-based measurement windows, repeated samples, automatic concurrency
sweeps, latency percentiles, process CPU utilization, event-loop utilization,
and event-loop delay. Defaults use 100,000 route groups and 100,000 model
cardinality, sweep up to 10,000 concurrency, and choose the lowest concurrency
that reaches at least 95% of peak median elapsed QPS. This report is route
decision QPS, not HTTP ingress RPS.

HTTP ingress capacity planning uses `npm run bench:performance:http`. This is
not a default merge gate. It starts a local Fastify server with the same route
runtime fixture, registers a benchmark-only route-decision endpoint, and drives
it with autocannon as an external load-generator process. Defaults use 10,000
route groups and 10,000 model cardinality, sweep up to 1,024 HTTP connections,
and report autocannon RPS, latency percentiles, server-process CPU RPS,
event-loop utilization, and event-loop delay. This covers TCP, HTTP parsing,
Fastify routing, JSON parsing and serialization, auth header handling, and token
router selection. It intentionally excludes upstream provider network I/O and
streaming relay; full proxy RPS needs a separate upstream-mock profile.

vCPU and worker-process capacity planning uses `npm run
bench:performance:matrix`. This runner is not a default merge gate. It runs the
same route-runtime gate across a matrix of CPU affinity profiles and independent
Node worker-process counts. Defaults are `ROUTE_PERF_MATRIX_VCPUS=1,2,4` and
`ROUTE_PERF_MATRIX_WORKERS=1,2,4`, with `taskset` used when available. Each
worker synchronizes at the distinct-concurrent measurement barrier, so the
matrix can report both aggregate CPU QPS and synchronized measured elapsed QPS
for vCPU/worker scaling. Worker gate budget failures are preserved in the
matrix report instead of aborting the whole matrix; the default merge gate
remains `npm run test:performance`.
Reports are written to
`test-results/performance/throughput/route-runtime-throughput-benchmark-report.md`
and `.json`,
`test-results/performance/http-rps/route-http-rps-benchmark-report.md` and
`.json`, and
`test-results/performance/matrix/route-runtime-performance-matrix-report.md`
and `.json`.
CI also runs bounded throughput, HTTP RPS, and matrix snapshots so the
performance step summary shows representative concurrency, HTTP ingress, and
vCPU/worker scaling without turning the full capacity benchmarks into merge
gates.

## Test Requirements

Every implementation slice that moves a route graph read path must include:

- integration coverage proving the endpoint works when full `compiledGraphJson`
  is absent or deliberately invalid;
- integration coverage for 10,000 route groups or an equivalent generated
  fixture at the projection seam;
- response-size assertions for manifest and paged endpoints;
- architecture tests preventing ordinary routes from importing or calling full
  active graph loaders;
- runtime tests proving route decision loads only a matched plan;
- migration tests proving legacy full graph rows are compacted or ignored
  without breaking active routing;
- memory-pressure tests with bounded heap growth.

Architecture tests should guard the interfaces, not private helper names. The
important rule is that ordinary read paths cannot depend on full source graph or
full compiled graph materialization.

Every implementation slice that moves a route graph write path must include:

- integration coverage for route, target, group, visibility, and enabled-state
  mutations proving projections update without full active graph hydration;
- integration coverage for at least 10,000 route groups at the projection seam;
- budgeted tests for dirty-closure size, synchronous write CPU, and retained
  heap after GC;
- architecture tests preventing route-table write paths from calling full graph
  source builders, full graph compilers, or full graph reconcilers;
- migration tests proving old full-graph versions can be exported or compacted
  while new projection versions do not store full hot artifacts;
- concurrency tests proving readers pin one active version while a concurrent
  publish flips the active pointer;
- cleanup tests proving validity-interval rows are retained while needed and
  deleted after the retention window.

The write-path performance tests should distinguish three classes:

- synchronous small delta, expected to stay within the HTTP CPU budget;
- medium delta, expected to publish in pages while retaining bounded memory;
- global rebuild/export, expected to run as a background task and never block
  ordinary requests.

## Migration Plan

### Phase 1: Make Full Graph Explicitly Debug-Only

- Keep `GET /api/route-graph/active` lightweight.
- Move full graph retrieval behind explicit debug/export endpoints.
- Add response-size and architecture tests.
- Compact persisted compiled graph rows to remove legacy bundles.

### Phase 2: Add Projection Tables

- Add manifest, route product, supply endpoint, match index, and plan tables.
- Generate projections during publish/rebuild.
- Keep existing JSON blobs as compatibility artifacts.
- Backfill projections from current active graph or route group tables.

### Phase 3: Move Read Pages To Projections

- Route summary reads route product projections.
- Route endpoint picker reads supply endpoint projections.
- Model marketplace reads route product and pricing projections.
- Route-flow reads one plan plus endpoint summaries.
- Graph editor loads subgraphs.

### Phase 4: Move Runtime To Plan Lookup

- Runtime pins active version id.
- Runtime matches requested model through the match index.
- Runtime loads one compact plan.
- Token router and proxy paths no longer load active full graph.

### Phase 5: Delete Legacy Hot Artifacts

- Remove `programBundle` and `flatProgramBundle` from persisted active compiled
  graph artifacts.
- Remove request-path fallbacks that hydrate full source/compiled graph.
- Keep full graph export as a streaming debug artifact only.

## Consequences

This introduces more persistence and projection code. That complexity is
intentional: it moves graph-size knowledge behind a deeper route graph storage
module and gives callers small predictable interfaces.

The benefit is locality. Performance rules, version consistency, projection
building, and legacy compaction live behind one route graph storage seam instead
of being rediscovered by every route and page.

The benefit is also leverage. Once the projections exist, model marketplace,
route page, route-flow, graph editor, and runtime all stop paying for full graph
materialization.

## Open Questions

- Should projection rows store JSON blobs in SQLite only, or should large debug
  artifacts move to file/object storage for all dialects?
- What is the exact retention policy for old immutable graph versions?
- Should pattern match indexes use database rows, an mmap-style artifact, or an
  in-process generated matcher table?
- Which admin roles may request full graph export in production?
- Should full graph export include compiled plans by default, or require a
  separate debug option?
