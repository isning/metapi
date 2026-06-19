# ADR-0005: Reference Pricing System

Status: Proposed
Date: 2026-06-20

## Context

Metapi currently sees pricing from several places:

- upstream pricing catalogs returned by New API / One API / compatible sites;
- account-level `unitCost`, used as a routing cost hint;
- proxy logs and self-log recovery, which can produce measured billing
  metadata;
- route graph public entries, which define the downstream model names users
  actually call;
- system fallback pricing for unknown models.

These sources answer different questions and should not be collapsed into one
field.

Operators need a stable reference price for each public entry:

- to show an expected entry price in the Model Intelligence Workspace;
- to compare upstream-reported prices against an official or user-selected
  reference;
- to compare actual billed usage against both the reference and upstream
  catalog;
- to route by meaningful cost without depending entirely on stale or incorrect
  upstream catalogs;
- to support advanced pricing such as cache hits, cache writes, context-window
  tiers, batch discounts, reasoning tokens, image/audio units, request fees, and
  future provider-specific billing dimensions.

The system must not assume that every model can be priced with only
`inputPerMillion` and `outputPerMillion`.

## Decision

Metapi will add a **Reference Pricing System**.

The system has four independent layers:

1. **Reference catalog**
   A versioned database of official or curated model pricing plans.

2. **Entry pricing reference**
   A route graph `entry` chooses which reference pricing plan represents the
   public model name exposed downstream.

3. **Observed pricing**
   Runtime observations from upstream catalogs and proxy billing logs.

4. **Pricing drift diagnostics**
   Scheduled comparison between reference pricing, upstream catalog pricing,
   and measured billing.

Reference pricing is not the same as upstream pricing. Upstream pricing is an
observed source and may be stale, incomplete, hidden behind platform-specific
rules, or intentionally different because of reseller markup. Measured billing
is runtime evidence, not a source of truth.

## Goals

- Model official and user-curated pricing plans without assuming only
  input/output token prices.
- Resolve the expected price for a public graph `entry` deterministically.
- Keep runtime billing, route cost scoring, model workspace pricing display, and
  drift diagnostics on the same pricing vocabulary.
- Make advanced pricing explicit: context tiers, cache reads, cache writes,
  reasoning tokens, batch discounts, service tiers, request fees, modalities,
  minimum charges, and future custom meters.
- Preserve current behavior when no reference pricing exists.

## Non-Goals

- The first implementation does not need to auto-sync every official provider
  price from the internet.
- The reference catalog is not an exchange-rate system. USD is the initial
  canonical currency.
- Measured billing does not automatically rewrite catalog entries.
- `account.unitCost` is not migrated into model pricing. It remains a routing
  fallback hint.

## Module Boundaries

The pricing domain should be implemented as a small set of deep modules:

```text
pricing-core
  validates pricing plans
  normalizes usage
  evaluates component costs

pricing-catalog
  stores catalog entries and aliases
  resolves active catalog versions

pricing-reference
  resolves entry/manual/scoped/default references
  never performs billing itself

pricing-runtime
  chooses the effective runtime pricing source
  integrates with proxy billing and route cost scoring

pricing-drift
  compares reference, upstream, and measured observations
  owns finding lifecycle and notification eligibility
```

Fastify route files are adapters. React pages are presentation. Neither should
own pricing evaluation or resolver rules.

## Terminology

- **Reference pricing**: the official or user-selected pricing plan that Metapi
  uses as the expected price for a public entry.
- **Upstream catalog pricing**: pricing returned by an upstream site's pricing
  endpoint.
- **Measured pricing**: pricing inferred from successful proxy logs and billing
  details.
- **Entry price**: the effective price attached to a public route graph `entry`.
- **Pricing component**: one billable part of a pricing plan, such as input
  tokens, output tokens, cache reads, image input, or request fees.
- **Pricing tier**: a conditional price branch, usually based on context size,
  service tier, batch mode, modality, region, or date.
- **Pricing observation**: a timestamped upstream-catalog or measured-billing
  sample. Observations are evidence for diagnostics; they are not catalog truth.
- **Plan fingerprint**: a stable hash of a canonicalized pricing plan body. It
  lets logs and drift findings explain which version was evaluated.

## Source Boundaries

The system keeps these price sources separate:

```text
reference catalog     expected official or curated price
entry reference       public-entry binding to a reference plan
upstream catalog      reported upstream price observation
measured billing      runtime billing observation from successful requests
effective runtime     source selected for estimation and route scoring
account unitCost      existing fallback hint, not model pricing
```

Only the reference catalog and explicit user overrides are authoritative
expected prices. Upstream catalogs can be incomplete or reseller-adjusted.
Measured billing can be delayed, sampled, or affected by discounts. Neither may
silently rewrite reference catalog entries.

When two surfaces show a price, they must name the source. A value displayed as
`Reference` must not come from measured billing. A value displayed as
`Measured` must carry sample count and freshness.

## Pricing Model

The reference catalog stores pricing plans as versioned component graphs, not as
a fixed pair of input/output fields.

```ts
type PricingCatalogEntry = {
  id: string;
  version: string;
  provider: string;
  modelKey: string;
  displayName: string;
  aliases: PricingAlias[];
  status: 'active' | 'deprecated' | 'preview' | 'unknown';
  currency: 'USD';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  source: PricingSource;
  plan: PricingPlan;
  planFingerprint: string;
  metadata: Record<string, unknown>;
};

type PricingAlias = {
  alias: string;
  normalizedAlias: string;
  confidence: 'exact' | 'provider_alias' | 'normalized' | 'manual';
  source: 'built_in' | 'provider_catalog' | 'user';
};

type PricingSource = {
  type: 'official' | 'provider_catalog' | 'user' | 'system_default';
  url?: string;
  checkedAt?: string;
  notes?: string;
};

type PricingPlan = {
  schemaVersion: 1;
  planKind: 'rate_card' | 'contract_overlay' | 'composed';
  unitPrecision: 'per_1m' | 'per_1k' | 'per_unit' | 'mixed';
  billingMode: 'token' | 'request' | 'time' | 'asset' | 'mixed';
  aggregation: PricingAggregation;
  rounding: PricingRounding;
  components: PricingComponent[];
  tiers: PricingTier[];
  allowances?: PricingAllowance[];
  commitments?: PricingCommitment[];
  overlays?: PricingOverlay[];
  postProcessors?: PricingPostProcessor[];
  transforms?: PricingTransform[];
};

type PricingComponent = {
  id: string;
  label: string;
  role: 'charge' | 'discount' | 'credit' | 'minimum' | 'maximum';
  kind:
    | 'input_tokens'
    | 'output_tokens'
    | 'reasoning_tokens'
    | 'cache_read_tokens'
    | 'cache_write_tokens'
    | 'request'
    | 'tool_call'
    | 'image_input'
    | 'image_output'
    | 'audio_input'
    | 'audio_output'
    | 'video_input'
    | 'embedding_tokens'
    | 'storage'
    | 'custom';
  meter: PricingMeter;
  price: PricingPrice;
  quantityPricing?: QuantityPricing;
  appliesWhen?: PricingCondition;
  tierRef?: string;
  comparisonKey?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
};

type PricingAggregation = {
  mode: 'sum_components';
  period?: 'request' | 'day' | 'month' | 'billing_cycle';
  minimumChargeUsd?: number;
  maximumChargeUsd?: number;
};

type PricingRounding = {
  mode: 'none' | 'component' | 'total';
  precision: number;
};
```

`role` is required because some pricing rules subtract cost, cap cost, or
enforce a minimum. Providers increasingly publish discounts and special tiers;
representing them as negative input prices would make drift detection brittle.

### Advanced Pricing Shapes

Advanced pricing is represented with structured fields first. CEL remains an
escape hatch, not the default modeling tool.

```ts
type QuantityPricing =
  | { mode: 'flat' }
  | { mode: 'volume_tier'; tiers: QuantityPriceTier[] }
  | { mode: 'graduated_tier'; tiers: QuantityPriceTier[] }
  | { mode: 'stairstep'; steps: QuantityStepPrice[] };

type QuantityPriceTier = {
  id: string;
  from: number;
  to?: number;
  price: PricingPrice;
};

type QuantityStepPrice = {
  id: string;
  from: number;
  to?: number;
  flatPrice: PricingPrice;
};

type PricingAllowance = {
  id: string;
  label: string;
  meter: PricingMeter;
  quantity: number;
  period: 'request' | 'day' | 'month' | 'billing_cycle';
  appliesWhen?: PricingCondition;
  consumeOrder?: number;
};

type PricingCommitment = {
  id: string;
  label: string;
  period: 'month' | 'billing_cycle';
  minimumSpendUsd?: number;
  includedComponents?: string[];
  overagePolicy?: 'charge_components' | 'cap_at_minimum' | 'diagnostic_only';
};

type PricingOverlay = {
  id: string;
  label: string;
  source: 'user_contract' | 'reseller_markup' | 'promotion' | 'internal_policy';
  operation:
    | { kind: 'replace_component_price'; componentId: string; price: PricingPrice }
    | { kind: 'multiply_component'; componentId: string; factor: number }
    | { kind: 'multiply_total'; factor: number }
    | { kind: 'add_component'; component: PricingComponent }
    | { kind: 'disable_component'; componentId: string };
  appliesWhen?: PricingCondition;
  priority?: number;
};

type PricingPostProcessor = {
  id: string;
  label: string;
  kind: 'markup' | 'discount' | 'tax' | 'currency_conversion' | 'rounding_adjustment';
  appliesWhen?: PricingCondition;
  amount?: number;
  factor?: number;
  metadata?: Record<string, unknown>;
};
```

Supported advanced shapes:

- **Flat component pricing**: normal input/output/cache/request fees.
- **Volume tier pricing**: all usage in a billing period uses the tier selected
  by total quantity.
- **Graduated tier pricing**: each quantity band is priced separately and then
  summed.
- **Stairstep pricing**: a fixed charge applies once quantity falls into a
  range.
- **Free allowances**: free tokens, requests, images, or custom units per
  request/day/month/billing cycle.
- **Minimum commitments**: monthly or billing-cycle minimum spend with optional
  overage behavior.
- **Component discounts/credits**: represented by `role`, with conditions and
  priority.
- **Caps/floors**: represented by maximum/minimum roles or plan aggregation.
- **Composite dimensions**: tiers can combine context size, batch mode, service
  tier, region, modality, and custom predicates.
- **Contract overlays**: private discounts, reseller markups, promotional
  overrides, and internal policies modify a base rate card without mutating it.
- **Post processors**: markup, tax, currency conversion placeholders, and final
  rounding adjustments are recorded separately from model usage charges.

The first runtime implementation may evaluate request-scoped advanced pricing
exactly and billing-period advanced pricing approximately unless a billing-cycle
usage accumulator exists. Approximate evaluations must be labeled as estimates
and must not be used for final billed-cost recovery without the required
period-level quantities.

### Rate Cards, Overlays, And Post Processing

Official model pricing should be modeled as a `rate_card`. User contracts and
reseller policies should be modeled as overlays or post processors layered on a
base plan:

```text
base rate card
  -> contract overlays
  -> component evaluation
  -> discounts/credits/minimums/maximums
  -> commitments
  -> post processors
  -> final rounded total
```

This keeps diagnostics explainable:

- a drift against official pricing compares observed data to the base rate card;
- a drift against an expected reseller price compares observed data to the
  composed plan;
- UI can show "official price", "contract adjustment", and "effective price"
  separately;
- historical logs can reproduce the exact composed plan by fingerprint.

Currency conversion is intentionally a post-processor placeholder in v1. The
canonical stored amount remains USD. A future exchange-rate module can own live
rates without changing the model pricing schema.

Tax should not be mixed with model usage cost unless an upstream bills tax in
the same reported amount. When tax exists, it is a post processor and the UI
must label it separately.

### Period Usage State

Billing-period constructs require period state. The pricing domain uses a
neutral accumulator contract instead of reading logs directly:

```ts
type PricingPeriodState = {
  scope: 'entry_node' | 'model_endpoint' | 'target' | 'account' | 'site';
  targetId: string;
  period: 'day' | 'month' | 'billing_cycle';
  periodStart: string;
  periodEnd: string;
  usage: CanonicalUsage;
  committedSpendUsd?: number;
  consumedAllowances?: Record<string, number>;
  observedCostUsd?: number;
};
```

The evaluator may receive `PricingPeriodState`. Without it, request-level cost
estimation must emit diagnostics for period allowances, commitments, and volume
tiers whose tier selection depends on period totals.

### Meters

Meters describe how to count a component.

```ts
type PricingMeter = {
  unit:
    | 'token'
    | 'request'
    | 'second'
    | 'minute'
    | 'image'
    | 'megabyte'
    | 'gigabyte_month'
    | 'custom';
  quantityPath?: string;
  scale?: number;
  missingQuantity?: 'zero' | 'diagnostic' | 'error';
};
```

Examples:

- input tokens: `quantityPath = usage.inputTokens`, `scale = 1_000_000`;
- output tokens: `usage.outputTokens / 1_000_000`;
- cache reads: `usage.cacheReadTokens / 1_000_000`;
- image input: `usage.imageInputUnits`;
- audio input: `usage.audioInputSeconds / 60`.

`missingQuantity` defaults to `diagnostic`. This avoids silent under-billing for
new modalities while keeping old logs evaluable.

### Prices

```ts
type PricingPrice = {
  currency: 'USD';
  amount: number;
  unitLabel: string;
  expression?: PricingPriceExpression;
};

type PricingPriceExpression =
  | { kind: 'fixed' }
  | { kind: 'linear'; multiplier: number }
  | { kind: 'formula'; cel: string };
```

Examples:

- `$5 / 1M input tokens`;
- `$0.01 / request`;
- `$0.04 / image`;
- `$0.006 / audio minute`.

Most plans use `fixed`. `formula` is reserved for user-authored or future
provider-specific plans and uses the same restricted CEL environment as
conditions.

### Tiers

Tiers model context-window, batch, service-tier, and modality pricing.

```ts
type PricingTier = {
  id: string;
  label: string;
  dimensions: PricingTierDimension[];
};

type PricingTierDimension =
  | { kind: 'context_tokens'; min?: number; max?: number }
  | { kind: 'input_tokens'; min?: number; max?: number }
  | { kind: 'output_tokens'; min?: number; max?: number }
  | { kind: 'service_tier'; value: string }
  | { kind: 'batch'; value: boolean }
  | { kind: 'modality'; value: string }
  | { kind: 'region'; value: string }
  | { kind: 'custom'; key: string; op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in'; value: unknown };
```

Examples:

- `<= 128k context`;
- `> 128k context`;
- `batch = true`;
- `service_tier = priority`;
- `modality = image`.

### Conditions

Most conditions should be structured data. CEL is allowed only as an advanced
escape hatch for catalog maintainers and user overrides.

```ts
type PricingCondition = {
  all?: PricingCondition[];
  any?: PricingCondition[];
  not?: PricingCondition;
  predicate?: PricingTierDimension;
  cel?: string;
};
```

CEL receives only a small immutable environment:

```ts
{
  model,
  provider,
  usage,
  request,
  response,
  entry,
  endpoint,
  metadata
}
```

CEL must not perform I/O, import modules, read secrets, or mutate state.

## Evaluation Algorithm

The evaluator is deterministic and side-effect free:

```text
input: PricingPlan + CanonicalUsage + context
  -> validate plan identity and version
  -> apply transforms to usage/context
  -> select matching tiers
  -> apply matching allowances to component quantities
  -> evaluate charge components in priority order
  -> apply quantity pricing mode per component
  -> evaluate discount/credit components
  -> apply minimum/maximum components
  -> apply commitments when period-level usage is available
  -> apply plan aggregation and rounding
  -> return PricingEvaluation + diagnostics
```

Components are evaluated independently first. Aggregation happens after all
components have produced normalized costs. This is necessary for plans where
context tier selection affects multiple components but request fees remain
untiered.

Quantity pricing semantics:

- `flat`: `quantity / scale * amount`.
- `volume_tier`: choose one tier based on total component quantity, then price
  the full quantity at that tier.
- `graduated_tier`: split quantity across matching bands and sum each band.
- `stairstep`: choose the matching step and charge its flat price once.

Allowance semantics:

- allowances subtract billable quantity before component cost evaluation;
- allowances never make quantity negative;
- when multiple allowances match, lower `consumeOrder` is consumed first;
- request-period allowances can be evaluated during proxy billing;
- day/month/billing-cycle allowances require period usage state and otherwise
  produce an estimate diagnostic.

Commitment semantics:

- commitments apply after component totals and discounts;
- `minimumSpendUsd` lifts the period total to the committed minimum;
- `includedComponents` limits the commitment to selected components;
- when period-level usage is unavailable, the evaluator emits a commitment
  diagnostic and returns a request-level estimate.

The evaluator must be pure enough to run in:

- proxy billing;
- route decision simulation;
- drift checks;
- model workspace preview;
- tests with static fixtures.

### Transforms

Transforms support provider-specific normalization without hardcoding all
providers into the pricing evaluator.

```ts
type PricingTransform = {
  id: string;
  kind:
    | 'copy_usage_field'
    | 'sum_usage_fields'
    | 'subtract_usage_fields'
    | 'cap_quantity'
    | 'multiply_quantity'
    | 'custom';
  inputPaths: string[];
  outputPath: string;
  value?: unknown;
  cel?: string;
};
```

Examples:

- derive billable input tokens by subtracting cache read tokens;
- map provider `cached_tokens` into `cache_read_tokens`;
- combine `reasoning_tokens` into output billing for providers that bill them
  as output.

## Representative Plan Shapes

Catalog seed data and tests should use JSON-compatible fixtures.

### Token Model With Cache Pricing

```json
{
  "schemaVersion": 1,
  "unitPrecision": "per_1m",
  "billingMode": "token",
  "aggregation": { "mode": "sum_components" },
  "rounding": { "mode": "total", "precision": 6 },
  "components": [
    {
      "id": "input",
      "role": "charge",
      "kind": "input_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 5, "unitLabel": "1M input tokens" }
    },
    {
      "id": "output",
      "role": "charge",
      "kind": "output_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.outputTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 15, "unitLabel": "1M output tokens" }
    },
    {
      "id": "cache-read",
      "role": "charge",
      "kind": "cache_read_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.cacheReadTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 0.5, "unitLabel": "1M cache read tokens" }
    },
    {
      "id": "cache-write",
      "role": "charge",
      "kind": "cache_write_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.cacheWriteTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 6.25, "unitLabel": "1M cache write tokens" }
    }
  ],
  "tiers": []
}
```

### Context Tiered Model

```json
{
  "schemaVersion": 1,
  "unitPrecision": "per_1m",
  "billingMode": "token",
  "aggregation": { "mode": "sum_components" },
  "rounding": { "mode": "total", "precision": 6 },
  "tiers": [
    { "id": "standard-context", "label": "<= 128k", "dimensions": [{ "kind": "context_tokens", "max": 128000 }] },
    { "id": "long-context", "label": "> 128k", "dimensions": [{ "kind": "context_tokens", "min": 128001 }] }
  ],
  "components": [
    {
      "id": "input-standard",
      "role": "charge",
      "kind": "input_tokens",
      "tierRef": "standard-context",
      "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 3, "unitLabel": "1M input tokens" }
    },
    {
      "id": "input-long",
      "role": "charge",
      "kind": "input_tokens",
      "tierRef": "long-context",
      "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000 },
      "price": { "currency": "USD", "amount": 6, "unitLabel": "1M input tokens" }
    }
  ],
  "transforms": []
}
```

### Mixed Token And Request Fee Model

```json
{
  "schemaVersion": 1,
  "unitPrecision": "mixed",
  "billingMode": "mixed",
  "aggregation": { "mode": "sum_components" },
  "rounding": { "mode": "total", "precision": 6 },
  "components": [
    {
      "id": "request-fee",
      "role": "charge",
      "kind": "request",
      "meter": { "unit": "request", "quantityPath": "usage.requestCount", "scale": 1 },
      "price": { "currency": "USD", "amount": 0.001, "unitLabel": "request" }
    }
  ],
  "tiers": []
}
```

## Canonical Usage Input

All cost calculation must pass through canonical usage normalization.

```ts
type CanonicalUsage = {
  schemaVersion: 1;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  requestCount: number;
  imageInputUnits: number;
  imageOutputUnits: number;
  audioInputSeconds: number;
  audioOutputSeconds: number;
  videoInputSeconds: number;
  storageMegabyteMonths: number;
  custom: Record<string, number>;
};
```

`CanonicalUsage` is append-only. Existing fields must not be renamed, removed,
or repurposed because historical logs and drift findings depend on stable usage
hashes. New dimensions are added as either:

- a top-level field when the dimension is common enough for first-class UI and
  evaluator support; or
- `custom[key]` when it is provider-specific or experimental.

Unknown provider usage fields must be preserved in raw observation metadata when
available. They may be copied into `custom` by a pricing transform, but the
normalizer must not invent billable quantities from untrusted text.

The evaluator returns a full breakdown, not just a total:

```ts
type PricingEvaluation = {
  catalogEntryId: string | null;
  source: 'reference' | 'user_override' | 'upstream_catalog' | 'measured' | 'default';
  usageHash: string;
  planFingerprint: string;
  composedFrom?: Array<{
    catalogEntryId?: string;
    version?: string;
    fingerprint: string;
    role: 'base_rate_card' | 'overlay' | 'post_processor';
  }>;
  totalCostUsd: number;
  subtotalCostUsd: number;
  adjustmentCostUsd: number;
  estimateLevel: 'exact' | 'request_estimate' | 'period_estimate' | 'incomplete';
  components: Array<{
    componentId: string;
    kind: PricingComponent['kind'];
    quantity: number;
    scale: number;
    unitPriceUsd: number;
    costUsd: number;
    role: PricingComponent['role'];
    tierId?: string;
    quantityPricingMode?: QuantityPricing['mode'];
    allowanceApplied?: number;
    overlayIds?: string[];
  }>;
  postProcessors?: Array<{
    id: string;
    kind: PricingPostProcessor['kind'];
    amountUsd: number;
  }>;
  equivalentMultipliers: {
    input?: number | null;
    output?: number | null;
    cacheRead?: number | null;
    cacheWrite?: number | null;
  };
  diagnostics: PricingEvaluationDiagnostic[];
};
```

`usageHash` makes drift findings auditable: the system can explain which
representative usage shape produced a total-cost delta.

## Pricing Observations

Observed pricing is stored as observations. It is intentionally separate from
catalog entries.

```ts
type PricingObservation = {
  id: string;
  source: 'upstream_catalog' | 'measured_billing';
  scope: 'site' | 'account' | 'entry_node' | 'model_endpoint' | 'target';
  targetId: string;
  publicModelName?: string;
  upstreamModelName?: string;
  catalogEntryId?: string | null;
  observedAt: string;
  freshnessTtlSeconds?: number;
  sampleCount?: number;
  usageShape?: CanonicalUsage;
  plan?: PricingPlan;
  planFingerprint?: string;
  evaluation?: PricingEvaluation;
  raw?: Record<string, unknown>;
  diagnostics: PricingObservationDiagnostic[];
};
```

There are two observation classes:

- `upstream_catalog` observations come from provider/site catalog APIs. They
  usually include a plan or a simplified plan converted into the same plan
  schema.
- `measured_billing` observations come from successful proxy logs. They usually
  include an evaluation over a concrete or aggregated usage shape.

The drift service may compare observations with reference plans, but catalog
updaters must require an explicit user/import action before changing reference
catalog entries.

## Storage

The first implementation may store complex plan JSON as a validated JSON blob,
but the schema should preserve queryable identity fields.

Required tables:

```text
pricing_catalog_entries
  id
  version
  provider
  model_key
  display_name
  status
  currency
  effective_from
  effective_to
  source_type
  source_url
  source_checked_at
  plan_fingerprint
  plan_json
  metadata_json
  created_at
  updated_at

pricing_catalog_aliases
  id
  catalog_entry_id
  alias
  normalized_alias
  confidence
  source

pricing_observations
  id
  source                  -- upstream_catalog | measured_billing
  scope
  target_id
  public_model_name
  upstream_model_name
  catalog_entry_id
  observed_at
  freshness_ttl_seconds
  sample_count
  usage_hash
  usage_shape_json
  plan_fingerprint
  plan_json
  evaluation_json
  raw_json
  diagnostics_json

pricing_period_states
  id
  scope
  target_id
  period
  period_start
  period_end
  usage_json
  committed_spend_usd
  consumed_allowances_json
  observed_cost_usd
  updated_at

pricing_reference_bindings
  id
  scope                  -- global | site | account | entry_node | macro
  target_id
  mode                   -- auto | manual | default | override
  public_model_name
  catalog_entry_id
  override_plan_json
  fallback_profile
  created_at
  updated_at

pricing_drift_findings
  id
  scope
  target_id
  public_model_name
  catalog_entry_id
  observed_source        -- upstream_catalog | measured_billing
  component_kind
  comparison_key
  usage_hash
  finding_key
  severity               -- info | warning | error
  expected_value
  observed_value
  relative_delta
  sample_count
  first_seen_at
  last_seen_at
  status                 -- open | acknowledged | resolved
  details_json
```

Long-term optimization may normalize `PricingComponent` into its own table, but
the first version should prefer validated JSON to avoid locking the schema to
today's component list.

`pricing_catalog_entries` is versioned by `(provider, model_key,
effective_from, version)`. Updating a built-in or user catalog plan creates a
new version instead of mutating historical meaning. Historical billing details,
observations, and drift findings record `catalog_entry_id`, `version`, and
`plan_fingerprint` when available.

`pricing_observations` can be retained with normal log retention. Reference
catalog entries and bindings are configuration and should not be expired by log
retention.

`pricing_period_states` is derived runtime state. It can be rebuilt from logs
when the retention window still contains the necessary usage and billing
details, but billing-cycle correctness improves when it is persisted
incrementally.

## Catalog Governance

The reference catalog supports three entry classes:

```text
built-in official     shipped with Metapi, source points to provider docs
user catalog          manually created or imported by operators
system default        fallback profiles for unknown or free models
```

Built-in official entries should be curated and reviewed. The first
implementation may seed a small representative catalog instead of attempting a
complete internet-synced provider database.

Catalog import rules:

- imports validate every plan before writing;
- imports run as a dry-run first and show creates, new versions, alias changes,
  and conflicts;
- an import that changes a price creates a new catalog version with effective
  dates;
- an import that only adds aliases does not rewrite historical plan versions;
- ambiguous aliases require manual confirmation;
- deleted upstream/provider prices should mark an entry deprecated or add
  `effective_to`, not remove historical rows.

This keeps official prices explainable while still allowing operator-maintained
pricing for resellers, private deployments, and provider variants.

## Manual Pricing Input

Manual pricing is a first-class structured workflow, not only raw JSON editing.
It is supported at three levels:

1. **User catalog entry**
   A reusable catalog entry manually created by an operator. It can be selected
   by many entries, aliases, sites, accounts, or macros.

2. **Manual binding**
   An entry, macro, site, account, or global scope explicitly selects an
   existing catalog entry.

3. **Entry override plan**
   A one-off plan stored on an entry reference for exceptional cases. This is
   still validated as a full `PricingPlan`, but it is not reusable unless the
   user saves it into the catalog.

The UI should prefer user catalog entries over one-off override plans. Override
plans are useful for temporary experiments, private contracts, or models that
should not appear in the shared catalog.

The guided manual editor supports common shapes:

```text
token pricing
  input per 1M
  output per 1M
  reasoning per 1M
  cache read per 1M
  cache write per 1M

request pricing
  request fee
  tool-call fee

context tier pricing
  tier label
  context token min/max
  per-tier input/output/cache prices

modality pricing
  image input/output unit
  audio input/output second or minute
  video input second

custom meter
  meter key
  unit label
  quantity path
  scale
  price

advanced pricing
  flat / volume tier / graduated tier / stairstep
  free allowance
  minimum commitment
  contract overlay
  reseller markup
  post-processing adjustment
  cap / floor
  discount / credit
```

Every guided row produces ordinary `PricingComponent` objects. The user can
switch to advanced JSON only after the structured plan validates.

Manual input validation rules:

- currency is initially USD only;
- amounts must be finite non-negative numbers;
- discounts and credits use `role`, not negative amounts;
- scales must be positive;
- quantity tier ranges must be ordered, non-overlapping, and exhaustive when the
  selected mode requires it;
- graduated tiers must start at zero or emit a diagnostic explaining the
  uncovered quantity range;
- volume tiers and stairsteps must have deterministic behavior for boundary
  quantities;
- allowances must declare their period and consume order;
- commitments must declare period and overage behavior;
- overlays must declare source and operation;
- post processors must be shown separately from usage components;
- tier ranges must not overlap for the same dimension unless the components are
  guarded by additional conditions;
- cache, reasoning, and modality components can be omitted, but omitted
  components are shown as incomplete coverage when observations contain those
  quantities;
- a user catalog entry must have provider, model key, display name, source note,
  and at least one alias;
- entry override plans must have an `overrideLabel` so diagnostics can explain
  the source.

Manual entry creation should offer presets:

```text
free model
simple input/output token model
OpenAI-compatible token model with cache
reasoning model
request-fee model
long-context tiered model
graduated usage tier model
monthly allowance model
minimum commitment model
contract discount overlay
reseller markup overlay
custom blank plan
```

Presets are UI accelerators. They still save normal validated pricing plans.

## Entry Pricing Reference

Route graph `entry` config gains a pricing reference block:

```ts
type EntryNodeConfig = {
  match: {
    model: string;
    visibility: 'public' | 'internal';
  };
  pricingReference?: EntryPricingReference;
};

type EntryPricingReference = {
  mode: 'auto' | 'manual' | 'default' | 'override';
  catalogEntryId?: string;
  overridePlan?: PricingPlan;
  overrideLabel?: string;
  fallbackProfile?: 'system_default' | 'free' | 'unknown';
};
```

Default behavior is `mode: 'auto'`.

Resolver order:

1. entry-level `override`;
2. entry-level `manual` catalog selection;
3. macro-level binding, when the entry is macro-derived;
4. account/site/global binding;
5. automatic match by exact alias;
6. automatic match by normalized alias;
7. system default fallback profile.

Automatic matching uses normalized model aliases:

```text
normalize(model)
  -> lowercase
  -> trim whitespace
  -> collapse repeated separators
  -> remove known provider namespace prefixes only when the provider is known
  -> keep family/version suffixes such as -mini, -reasoner, -thinking
```

The normalizer must be conservative. It may match cosmetic separators, but it
must not collapse distinct model variants. Examples:

```text
gpt_4o        -> gpt-4o
openai/gpt-4o -> gpt-4o when provider=openai
gpt-4o-mini   -> gpt-4o-mini, not gpt-4o
deepseek-reasoner -> deepseek-reasoner, not deepseek-chat
```

If multiple catalog entries match with equal confidence, the resolver returns no
automatic catalog entry and emits an ambiguous-match diagnostic. The UI should
ask for manual selection instead of guessing.

Macro-derived entries can inherit a macro-level binding. Entry-level manual or
override configuration still wins. The compiled graph must carry enough macro
origin metadata for `pricing-reference` to explain the inheritance chain.

The resolver returns:

```ts
type ResolvedEntryPricingReference = {
  mode: EntryPricingReference['mode'];
  source:
    | 'entry_override'
    | 'entry_manual'
    | 'macro_binding'
    | 'site_binding'
    | 'global_binding'
    | 'auto_exact'
    | 'auto_alias'
    | 'auto_normalized'
    | 'default';
  publicModelName: string;
  catalogEntryId: string | null;
  catalogEntry: PricingCatalogEntry | null;
  confidence: 'exact' | 'alias' | 'normalized' | 'default' | 'manual' | 'override';
  diagnostics: PricingReferenceDiagnostic[];
};
```

The route graph compiler should include this resolved pricing reference in the
compiled entry metadata. The Model Intelligence Workspace should use it for the
`Reference` price card.

## Pricing Source Priority

Runtime cost estimation needs explicit priority:

```text
1. entry pricing override
2. entry manual reference catalog entry
3. user scope binding (macro/site/account/global)
4. official reference catalog auto match
5. upstream catalog pricing
6. account unitCost
7. system fallback default
```

Measured billing is not in this priority list because it is evidence. It may
feed diagnostics and suggestions, but it must not silently overwrite reference
pricing or routing costs.

`pricing-runtime` owns this priority. Route adapters and protocol format
handlers ask for an effective runtime price; they do not reproduce priority
logic.

Runtime integration rules:

- proxy billing evaluates the selected effective plan against canonical usage
  and records source, catalog entry ID, plan version, plan fingerprint, and
  usage hash in billing details;
- route cost scoring uses the effective runtime source, but marks the score as
  `fallback` when it came from upstream catalog, `account.unitCost`, or system
  default;
- `account.unitCost` remains a numeric channel/account hint only. It does not
  become a `PricingCatalogEntry` and should not be shown as `Reference`;
- self-log recovery and measured billing may produce `PricingObservation`
  records, but they must not change the source priority for future requests;
- when the selected plan has missing required usage quantities, runtime billing
  records diagnostics and falls back only if the plan explicitly says
  `missingQuantity: 'error'`.

The current pricing service can be adapted behind `pricing-runtime` during
migration, but new code should call the pricing domain modules rather than
adding more direct calls to existing pricing helpers.

## Drift Detection

Metapi will add a scheduled `pricing-drift-check` job.

The job compares:

```text
reference pricing
vs upstream catalog pricing
vs measured billing pricing
```

It evaluates each comparable component:

- input tokens;
- output tokens;
- reasoning tokens;
- cache reads;
- cache writes;
- request fees;
- modality-specific units;
- tier-specific prices.

The job must compare normalized component prices and representative total cost.
Total-cost comparison is necessary because two plans can have equal input/output
prices but differ on cache writes, context tiers, or request fees.

Recommended thresholds:

```text
relative delta >= 5%   -> warning
relative delta >= 20%  -> error
sample count < 10      -> info or suppressed measured-billing warning
no successful requests -> skip measured-billing comparison
missing reference      -> warning on public entries, info on internal entries
missing upstream price -> info unless route selection depends on upstream cost
```

Drift findings should be debounced. A user should not get repeated notifications
for the same model/component/source unless severity changes or the finding was
resolved and reappears.

### Drift Algorithm

For each public entry:

1. resolve the reference plan;
2. collect fresh upstream catalog observations for reachable model endpoints;
3. collect recent measured billing observations with enough samples;
4. build representative usage shapes;
5. evaluate reference and observed plans against each usage shape;
6. compare component-level normalized prices where component comparison keys
   match;
7. compare total cost per usage shape;
8. upsert findings by stable finding key.

Component comparison uses this key:

```text
comparisonKey ?? `${kind}:${tierRef ?? "untiered"}:${meter.unit}:${meter.scale}`
```

Plans with different component layouts can still be compared by representative
total cost. Component-level findings should be emitted only when the components
are comparable.

Representative usage shapes come from:

- recent successful request aggregates for the entry;
- standard static fixtures for no-traffic models;
- tier boundary probes, such as `127k`, `128k`, and `129k` context tokens for
  context-tiered plans;
- cache-heavy, reasoning-heavy, and request-fee-heavy fixtures when the plan has
  those components;
- quantity band boundary probes for volume, graduated, and stairstep pricing;
- allowance exhaustion probes, such as below allowance, exactly at allowance,
  and above allowance;
- commitment probes when period-level usage is available.

For advanced pricing, component-price comparison is not always meaningful.
Graduated tiers, allowances, and commitments can have equal component prices but
different total cost at boundaries. Drift detection must therefore include
total-cost comparison across representative shapes for every advanced plan.

Drift checks must choose the correct expectation:

- **official drift** compares observed upstream catalog pricing to the base
  official rate card;
- **contract drift** compares measured billing to the composed plan selected by
  the entry/site/account binding;
- **reseller markup drift** compares upstream or measured billing to the
  composed plan that includes markup overlays;
- **tax/fee drift** is reported separately when the observed amount appears to
  include post processors that the reference plan does not.

The finding details should record both base and composed fingerprints when
overlays are involved.

Finding lifecycle:

```text
open
  -> acknowledged   user accepted the active finding but it still exists
  -> resolved       latest check no longer reproduces the drift
resolved
  -> open           same finding key reappears after resolution
```

The stable finding key is:

```text
scope + targetId + publicModelName + catalogEntryId
+ observedSource + comparisonKey + usageHash
```

Severity changes update the existing finding and may create a new notification.
Repeated checks with the same severity only update `last_seen_at`, sample
counts, and details.

### Drift Thresholds

Default thresholds are intentionally conservative:

```text
component relative delta >= 5%     -> warning
component relative delta >= 20%    -> error
total-cost relative delta >= 5%    -> warning
total-cost relative delta >= 20%   -> error
absolute delta < $0.000001         -> suppress
sample count < 10                  -> info or suppress measured drift
sample count >= 100                -> eligible for warning/error
missing reference on public entry  -> warning
missing reference on internal entry -> info
```

Thresholds should be configurable later, but the first version should keep
server-side defaults so drift behavior is predictable.

## CEL Safety

CEL is an escape hatch for pricing conditions, formula prices, and transforms.
It must run in a restricted environment:

- no I/O, network, filesystem, time, randomness, mutation, or module imports;
- no access to secrets, API keys, tokens, raw headers, or request body content
  beyond normalized safe pricing context;
- expression length, AST depth, operation count, and evaluation time limits;
- deterministic numeric output for formula prices;
- boolean output for conditions;
- numeric output or structured copy result for transforms;
- validation at save time and execution limits at evaluation time.

Unsafe or invalid CEL makes the plan invalid unless the field is optional and a
safe default exists. Runtime evaluation must not execute unvalidated CEL stored
in raw provider metadata.

## UI

### Route Graph Entry Inspector

The entry inspector shows:

- selected reference pricing mode;
- resolved catalog entry;
- match confidence;
- input/output/cache summary;
- context tier summary;
- `Change reference` action;
- `Use system default` action;
- `Override plan` advanced action.

Automatic matching must be transparent. If `gpt-4o-fast` matched `gpt-4o` by
normalized alias, the UI must say so.

`Change reference` opens a structured picker:

```text
Auto match
Use catalog entry
Create manual catalog price
Use system default
Advanced one-off override
```

`Create manual catalog price` opens the guided manual editor and saves a user
catalog entry before binding the entry to it. `Advanced one-off override` saves
only on the entry and should show a warning that the plan is not reusable until
it is saved to the catalog.

### Model Intelligence Workspace

The Pricing section should show four cards:

1. `Reference`
2. `Upstream catalog`
3. `Measured billing`
4. `Effective runtime`

Each card shows:

- component summary;
- equivalent input/output multipliers when applicable;
- source and freshness;
- warnings if the component set is incomplete.

Advanced details show the full component breakdown and tiers.

The cards answer different questions:

```text
Reference          What should this public entry cost?
Upstream catalog   What does the upstream currently report?
Measured billing   What did recent real traffic actually cost?
Effective runtime  What source will runtime estimation and scoring use now?
```

When enough traffic exists, the workspace shows measured entry price and
equivalent multiplier. When a reference plan exists, it also shows theoretical
entry price and equivalent multiplier for the same representative usage shape.

Equivalent multiplier is a display metric, not a billing primitive. It is
calculated against a stable baseline profile:

```text
input equivalent  = component price / baseline input price
output equivalent = component price / baseline output price
total equivalent  = total evaluated cost / baseline evaluated cost
```

The UI must always show which usage shape and baseline produced the multiplier.
If a plan contains request fees, image/audio units, or tiered context pricing,
the UI should prefer total-equivalent multiplier over a misleading single
input/output multiplier.

Drift presentation:

- small badge on the relevant pricing card;
- Diagnostics tab row with source, observed value, expected value, delta,
  sample count, and freshness;
- link from diagnostic to the graph entry or model endpoint;
- acknowledgement action for noisy but understood reseller markup;
- explicit "missing reference price" empty state for public entries.

### Settings

A new Pricing Catalog settings surface should support:

- browsing built-in catalog entries;
- adding user catalog entries;
- manually entering simple and advanced pricing plans;
- creating aliases;
- selecting a fallback profile;
- seeing drift findings;
- acknowledging or resolving findings.

The catalog editor should bias toward structured editing:

- provider, model key, aliases, source, status, and effective dates are ordinary
  form fields;
- common component types use guided rows;
- manual presets create editable structured plans;
- guided rows preview per-component cost for a sample usage shape;
- advanced JSON editing is available but validates before save;
- one-off entry overrides can be promoted into user catalog entries;
- CEL fields are hidden behind an advanced disclosure and validate inline;
- import shows a dry-run summary before writing catalog entries.

## API

Initial APIs:

```text
GET    /api/pricing/catalog
POST   /api/pricing/catalog
GET    /api/pricing/catalog/:id
PATCH  /api/pricing/catalog/:id

GET    /api/pricing/resolve?model=...&scope=...
POST   /api/pricing/evaluate

GET    /api/pricing/bindings
POST   /api/pricing/bindings
PATCH  /api/pricing/bindings/:id
DELETE /api/pricing/bindings/:id

GET    /api/pricing/drift-findings
POST   /api/pricing/drift-findings/:id/ack
POST   /api/pricing/drift-check/run
```

The route graph detail endpoint should embed resolved pricing references:

```ts
type ModelDetailsView = {
  pricing: {
    reference: ResolvedEntryPricingReference;
    upstreamCatalog: PricingEvaluation | null;
    measuredBilling: PricingEvaluation | null;
    effectiveRuntime: PricingEvaluation | null;
    driftFindings: PricingDriftFinding[];
  };
};
```

API responses should return both machine-readable plan/evaluation objects and
compact summaries for UI cards. The server, not the page, owns source priority,
match confidence, drift severity, and incomplete-data diagnostics.

Write APIs must validate catalog plans through `pricing-core`. Route files
should only parse HTTP input, call services, and serialize responses.

## Migration

No old data should be destroyed.

Migration sequence:

1. Create catalog and binding tables.
2. Seed built-in system fallback profiles.
3. Add resolver with automatic alias matching.
4. Add entry node `pricingReference` config as optional.
5. Populate model details with reference pricing where available.
6. Add drift check without notifications.
7. Enable notifications after findings are deduplicated and UI can display
   them clearly.

Existing `account.unitCost` remains valid as a routing cost fallback. It should
not be reinterpreted as model pricing.

Versioning rules:

- `PricingPlan.schemaVersion` changes only when evaluator semantics change.
- Catalog entry `version` changes when a provider/user price changes.
- `effective_from` and `effective_to` describe provider billing validity, not
  database row creation time.
- Historical proxy billing details store the evaluated plan source, catalog
  entry ID, catalog version, plan fingerprint, and usage hash.
- Drift findings store enough details to be understood after catalog entries are
  updated.
- Built-in seed updates are additive. If an official price changes, seed a new
  catalog version instead of mutating the previous effective period.

Database migrations must follow repository rules: Drizzle schema, SQLite
migration history, and checked-in schema artifacts are updated together.

## Testing

Required coverage:

- catalog plan schema validation;
- CEL save-time validation and evaluation limits;
- component evaluation for token, request, cache, context tier, batch, and
  modality pricing;
- component roles, aggregation, rounding, minimum, maximum, discount, and credit
  behavior;
- canonical usage append-only compatibility and usage hash stability;
- entry resolver exact, alias, normalized, manual, override, and default modes;
- alias conflict diagnostics and macro-derived entry inheritance;
- route graph compiler preserves resolved entry pricing metadata;
- proxy billing can evaluate reference plans without breaking existing upstream
  catalog billing;
- route cost scoring uses the effective runtime source and preserves
  `account.unitCost` fallback semantics;
- drift detection for upstream catalog deltas;
- drift detection for measured billing deltas;
- insufficient sample suppression;
- finding key dedupe, acknowledgement, resolution, and re-open behavior;
- UI rendering for unknown, partial, advanced, and drifted pricing plans.

Architecture tests should enforce that:

- pricing evaluation does not import Fastify route modules;
- transformers do not import pricing runtime or route adapters;
- React pages do not implement pricing source priority or evaluation logic;
- route adapters delegate to pricing services.

## Consequences

This adds a durable pricing domain to Metapi. The benefit is that pricing
becomes explainable and comparable across routing, billing, and model
inspection. The cost is that the evaluator must be carefully versioned and
tested, because pricing rules evolve faster than simple schema columns.

The design intentionally keeps the first storage version JSON-backed for the
plan body while preserving queryable catalog identity and binding fields.
