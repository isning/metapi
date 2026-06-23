# ADR-0004: Model Intelligence Workspace

Status: Proposed
Date: 2026-06-20

## Context

Metapi's model page currently presents models primarily as a list with inline
expanded details. The expanded area mixes several domains:

- model identity and marketplace metadata;
- endpoint capability and pricing information;
- account/token coverage;
- compiled route flow;
- runtime health signals.

That layout works for simple inspection, but it does not reflect the
graph-native routing architecture from ADR-0002. A public model name is not just
an inventory row. It is the entry point into a compiled route graph:

```text
public model name
  -> entry
  -> filters
  -> dispatcher / selector
  -> route_endpoint candidates
  -> selected upstream target
```

Operators need to answer graph-native questions from the model page:

- Which compiled graph path does this model use?
- Which dispatcher, selector, macro, or endpoint node influenced the route?
- Which candidate endpoints are healthy, degraded, disabled, or unavailable?
- Which downstream API surfaces and upstream compatibility policies are
  effective for this model?
- Which runtime metrics explain routing behavior and failures?

The UI also needs to remain beautiful and operationally useful. The target is a
technical operations console: high information density, strong alignment,
semantic state color, graph/table linkage, dark-mode correctness, and shadcn
primitive composition rather than decorative custom styling.

## Decision

Metapi will evolve the model marketplace into a **Model Intelligence
Workspace**.

The model details experience will be a routeable workspace, not a transient
sheet-first interaction. Sheets remain useful for mobile drill-downs and
secondary inspectors, but the desktop primary experience is:

```text
Model Index -> Model Workspace -> Context Inspector
```

The workspace is graph-native. It presents a selected public model as a compiled
route entry plus its runtime evidence and API compatibility contract.

## Layout

Desktop uses a three-pane workspace:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Top Toolbar                                                         │
│ Models  Search...  Filters  Refresh                         Actions │
├──────────────────┬───────────────────────────────────┬──────────────┤
│ Model Index      │ Model Workspace                   │ Inspector    │
│                  │                                   │              │
│ filters          │ Model Header                      │ selected     │
│ model list       │ Tabs                              │ node / edge  │
│                  │ Tab Content                       │ diagnostics  │
└──────────────────┴───────────────────────────────────┴──────────────┘
```

The desktop layout should use shadcn-native primitives:

- `Resizable` for pane sizing;
- `ScrollArea` for pane overflow;
- `Tabs` for workspace sections;
- `Card`, `Table`, `Badge`, `Tooltip`, `ButtonGroup`, `Collapsible`,
  `Skeleton`, and `Empty` for ordinary UI composition.

The page itself is the workspace surface. It should not be wrapped in a large
decorative card. Cards are reserved for repeated records, metric tiles, and
bounded content sections.

Mobile uses navigation instead of a cramped three-pane layout:

```text
/models        -> model index
/models/:model -> model workspace
```

Node and edge inspectors open in `Sheet` on mobile.

## URL State

Workspace state must be deep-linkable:

```text
/models
/models/:model
/models/:model?tab=routing
/models/:model?tab=routing&node=route_endpoint:123
/models/:model?tab=performance&range=24h
```

The URL is the source of truth for:

- selected model;
- selected tab;
- selected graph node, edge, or diagnostic;
- metric range.

This preserves refresh, browser back, sharing, and browser-test stability.

## Workspace Sections

### Model Index

The model index is a compact, scan-optimized list. Each row shows:

- brand icon;
- model name;
- provider/brand;
- endpoint capability badges;
- health state;
- success rate and average latency when available.

The selected model row is emphasized with muted background and a primary rail or
similar low-noise state indicator. Degraded and unavailable states use semantic
badges/dots, not full-row color fills.

### Model Header

The workspace header identifies the selected model:

```text
[brand icon] gpt-5.5                         [Copy] [Refresh] [More]
OpenAI · public · token-based · compiled 42s ago
[chat] [responses] [tools] [thinking:native] [route:graph-native]

Health Degraded · Success 93.9% · Avg latency 20.7s · 8 endpoints
```

The header must stay compact. It is not a marketing hero.

### Tabs

The workspace has five stable tabs:

1. `Overview`
2. `Routing`
3. `Performance`
4. `API`
5. `Diagnostics`

Tab state is stored in the URL. Tabs may show small status badges when their
section contains warnings, errors, or unavailable data.

### Overview

Overview answers whether the model is usable at a glance. It includes:

- metric grid;
- route summary;
- capability summary;
- pricing summary;
- recent diagnostics preview;
- data freshness.

Missing runtime traffic is an `Empty` state, not a silent zero.

### Routing

Routing is the graph-native core of the workspace. It displays compiled route
flow with multiple view modes:

- `Effective Path`: public entry to selected endpoint path;
- `Candidates`: selected path plus candidate endpoints;
- `Compiled`: primitive graph compiler output;
- `Diagnostics`: graph view filtered/highlighted by diagnostics.

Graph nodes must distinguish type and state:

- node type color identifies entry/filter/dispatcher/macro/route_endpoint;
- status badge/dot identifies healthy/degraded/disabled/error;
- selected node uses primary ring;
- disabled nodes remain readable;
- diagnostic nodes receive an icon marker.

Edges follow ADR-0002 semantics:

- request edge: normal directional line;
- bidirect edge: visually distinct bidirectional marker/line;
- fallback edge: dashed or fallback-labeled;
- error edge: destructive semantic tone;
- selected path: highlighted;
- inactive candidates: muted.

Clicking a node or edge opens the Inspector. Hovering rows in Performance should
highlight the corresponding graph node when mapping is available.

### Performance

Performance presents runtime evidence aligned with graph nodes:

- metric grid for requests, success rate, average latency, TTFT, TPS, and cost;
- time-series charts for latency, success, and volume;
- node performance table keyed by graph node IDs;
- health history strip per route/endpoint/node where available.

Performance rows should link back to graph nodes. The UI must not infer this by
model-name string matching when stable graph node IDs are available.

### API

API explains the downstream contract for the model:

- exposed endpoint surfaces;
- tool-call support;
- thinking/reasoning carrier policy;
- payload mutation policy;
- endpoint rewrite policy;
- examples for supported surfaces.

Policies are shown with `Collapsible` sections. Each policy should show the
effective value and, when available, its inheritance/source chain:

```text
global default -> site default -> API key override -> route endpoint override
```

### Diagnostics

Diagnostics explains route and runtime problems:

- graph compile diagnostics;
- missing endpoints;
- disabled nodes;
- route conflicts;
- compatibility policy mismatch;
- data freshness problems;
- raw compiled JSON for advanced inspection.

Each diagnostic should support "Go to node" when it references a graph node.

## Inspector

The right inspector is contextual. It is not the model details primary surface.

Inspector target types:

- graph node;
- graph edge;
- diagnostic;
- API policy;
- performance row.

Inspector tabs:

- `Summary`;
- `Metrics`;
- `Config`;
- `JSON`.

The inspector should avoid duplicated fields. A selected graph node should show
identity, status, upstream/downstream edges, metrics, configuration source, and
raw JSON only once in the correct tab.

## View Model

The final data contract is a graph-native model details view:

```ts
type ModelDetailsView = {
  model: {
    name: string;
    brand?: string;
    visibility: 'public' | 'internal';
    pricingMode?: 'token' | 'request' | 'mixed' | 'unknown';
    endpointTypes: string[];
    tags: string[];
  };

  overview: {
    status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
    routeCount: number;
    endpointCount: number;
    accountCount: number;
    tokenCount: number;
    avgLatencyMs: number | null;
    successRate: number | null;
    requestCount: number;
    diagnosticsCount: number;
  };

  routing: CompiledModelRouteFlow;

  performance: {
    range: '1h' | '24h' | '7d';
    totals: ModelRuntimeMetrics;
    byNode: ModelNodeRuntimeMetrics[];
    trend: ModelMetricPoint[];
    availability: HealthBucket[];
  };

  api: {
    surfaces: ModelSurfaceCapability[];
    thinkingPolicy?: ThinkingCompatibilityPolicy;
    toolCallPolicy?: ToolCallCompatibilityPolicy;
    payloadPolicies: PayloadMutationPolicy[];
  };

  diagnostics: ModelDiagnostic[];
  compiledAt: string;
  metricsUpdatedAt: string | null;
};
```

Initial implementation may assemble a partial view from existing model list data
and `/api/models/route-flow?model=...`. The long-term endpoint is:

```text
GET /api/models/:model/details?range=24h
```

The frontend should converge on consuming `ModelDetailsView` rather than
reimplementing routing, compatibility, or health inference.

## Shared Components

The workspace should introduce reusable components, not page-local one-offs:

```text
src/web/components/workspace/
  EntityWorkspaceLayout.tsx
  EntityHeader.tsx
  EntityIndex.tsx
  InspectorPanel.tsx

src/web/components/metrics/
  MetricTile.tsx
  MetricGrid.tsx
  HealthStrip.tsx

src/web/components/details/
  SectionHeading.tsx
  CapabilityMatrix.tsx
  JsonBlock.tsx
  DiagnosticItem.tsx
```

Model-specific components live under:

```text
src/web/pages/models/
  ModelDetailsWorkspace.tsx
  ModelIndexPanel.tsx
  ModelOverviewTab.tsx
  ModelRoutingTab.tsx
  ModelPerformanceTab.tsx
  ModelApiTab.tsx
  ModelDiagnosticsTab.tsx
  modelDetailsView.ts
```

## Visual Quality Rules

The model workspace follows ADR-0003:

- use shadcn primitives for controls, tabs, sheets, tables, cards, badges,
  empty states, skeletons, scroll areas, and resizable panes;
- use Tailwind layout classes for spacing and layout;
- avoid raw colors, ad hoc shadows, ad hoc border radii, and page-local
  component styling;
- preserve graph/node custom visuals only where XYFlow/domain rendering needs
  them.

Additional model workspace rules:

- high-density but stable row heights;
- no decorative hero;
- no large decorative gradients;
- semantic status color only;
- mono/tabular numbers for metrics;
- graph, table, and inspector selection must visually synchronize;
- empty, loading, and error states must be designed, not left as plain text;
- dark mode and light mode must both be verified.

## Consequences

The model page becomes a first-class graph-native observability and diagnosis
surface. This increases UI scope, but it removes pressure to cram route graph,
API compatibility, and performance evidence into a single inline details block.

The frontend gains reusable workspace and metrics components that can later be
used for route, site, token, and endpoint details.

The backend will need a consolidated model details view to fully support the
design. The first UI slice can ship with partial data from existing endpoints,
but it must keep the view-model boundary explicit so the backend can replace
frontend-derived data without another UI rewrite.
