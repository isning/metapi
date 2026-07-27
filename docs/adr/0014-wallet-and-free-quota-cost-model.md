# ADR-0014: Wallet And Free Quota Cost Model

Status: Proposed
Date: 2026-06-24

## Context

ADR-0005 separates reference pricing, upstream cost pricing, upstream catalog
observations, and measured billing. That split is still correct, but upstream
AI resale sites add another layer that ADR-0005 intentionally did not model:
the operator may acquire upstream wallet balance through different economic
paths.

Examples:

- a site publishes model prices in CNY while Metapi reports cost in USD;
- a site sells wallet balance at 80% of face value;
- a "free" site still exposes model prices and balance burn, but the operator
gets balance through daily check-in, effectively a 0-discount acquisition path;
- two free sites may burn the same upstream balance per request while one gives
100 balance/day and the other gives 10 balance/day;
- one public entry can route across paid and free supplies.

If Metapi collapses all of this into `totalCostUsd`, free sites look like zero
cost and mixed entries become misleading. If Metapi treats daily check-in as a
manual time-cost problem, the model becomes too complex and operator-specific.

Operators need two distinct answers:

- **wallet cost**: how much real money is expected to leave the operator's
  wallet after recharge discount and currency conversion;
- **free quota cost**: how much scarce daily earned balance is consumed.

Those answers must be available to model workspace pricing, route-flow
theoretical entry pricing, proxy-log actual cost snapshots, and route cost
scoring without duplicating pricing logic.

## Decision

Metapi will model wallet economics as a layer above upstream pricing and below
route scoring.

The pricing quote interface will keep these dimensions separate:

```text
reference pricing      official or built-in baseline for multipliers
upstream pricing       provider or manual rate card in the upstream billing unit
wallet acquisition     how upstream wallet balance is acquired
effective wallet cost  upstream burn converted to the operator base currency
free quota cost        upstream burn measured as daily earned balance days
```

The system will not convert free quota cost into money by default. It will
display and route on it as a separate dimension.

The primary free quota metric is:

```text
freeQuotaDaysCost = balanceBurn / dailyEarnedBalance
```

For mixed entries, Metapi will aggregate dimensions independently:

```text
entry.walletCostBaseCurrency = sum(probability_i * walletCost_i)
entry.freeQuotaDaysCost      = sum(probability_i * freeQuotaDaysCost_i)
```

The UI must not present mixed free/paid entries as a single total dollar cost.
It must show wallet cost and free quota cost side by side.

## Terminology

- **Billing unit**: the unit the upstream site burns for a request. It may be
  USD, CNY, credit, quota, balance, or a platform-specific unit.
- **Wallet currency**: the currency or balance unit held at the upstream site.
  For many sites this is not the same as the operator's reporting currency.
- **Face value**: the upstream wallet value before recharge discount.
- **Recharge discount**: the cash acquisition multiplier for wallet balance.
  `1` means full price, `0.8` means 80% of face value, `0` means no cash was
  paid for the acquired balance.
- **Daily earned balance**: expected wallet balance acquired per day from
  check-in or other recurring free mechanisms.
- **Wallet cost**: the effective real-money cost after face-value conversion,
  recharge discount, and foreign exchange.
- **Free quota cost**: daily earned balance consumed by the request, expressed
  in days of earned quota.
- **Cost vector**: a multi-dimensional cost value containing wallet cost,
  balance burn, and free quota cost.

## Design Principles

The design follows these rules:

- Wallet cost and free quota cost are first-class dimensions. Neither is a
  derived display string.
- `0` and `unknown` are different states. Unknown acquisition data must never
  become zero cost.
- Free quota is not money. It may influence route scoring, but it is not
  silently converted into the reporting currency.
- The quote seam owns all wallet economics. Route scoring, model workspace,
  proxy logs, and settings pages consume quote results instead of
  reimplementing formulas.
- Historical proxy logs store snapshots. They do not re-read mutable wallet
  acquisition profiles when rendering old requests.
- Scope inheritance is explicit and shallow: token overrides account, account
  overrides site, and disabled profiles stop at their scope only when configured
  as an override.

## Data Model

Metapi will introduce a wallet acquisition profile. The initial schema should
stay intentionally small:

```ts
type WalletAcquisitionProfile = {
  id: number;
  scope: 'site' | 'account' | 'token';
  siteId: number;
  accountId: number | null;
  tokenId: number | null;
  inheritance: 'inherit' | 'override' | 'disabled';
  walletCurrency: string;
  baseCurrency: string;
  faceValuePrice: number | null;
  faceValueCurrency: string | null;
  rechargeDiscount: number;
  dailyEarnedBalance: number | null;
  dailyEarnedBalanceSource: 'manual' | 'observed_checkin' | 'mixed' | 'none';
  observedWindowDays: number | null;
  confidence: 'exact' | 'estimated' | 'incomplete';
  enabled: boolean;
  notes: string | null;
};
```

Field rules:

- `walletCurrency` is the upstream balance unit being burned. It can be an ISO
  currency (`USD`, `CNY`) or a platform unit (`credit`, `quota`, `balance`).
- `faceValuePrice` answers: "what cash amount buys one wallet unit before
  discount?"
- `faceValueCurrency` is the cash currency of `faceValuePrice`.
- `rechargeDiscount` is a multiplier, not a percentage string.
- `dailyEarnedBalance` is an expected daily inflow, not current wallet balance.
- `inheritance = 'inherit'` means missing fields can be read from the next
  broader scope.
- `inheritance = 'override'` means this row owns the profile for its scope.
- `inheritance = 'disabled'` means no wallet acquisition profile applies at
  this scope, even if a broader profile exists.

The first implementation may support only manual `dailyEarnedBalance`. A later
implementation can derive it from check-in and balance refresh observations:

```text
dailyEarnedBalance = EWMA(positive balance deltas after check-in) * successRate
```

Foreign exchange is a separate seam:

```ts
type FxRateSnapshot = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: 'manual' | 'provider' | 'system_default';
  capturedAt: string;
};
```

The initial FX implementation can be manual only. The interface still uses
snapshots so an automatic provider can be added later without changing proxy log
semantics.

Proxy logs and measured costs must store the snapshot id or effective rate used
at request time. Historical cost must not drift when the operator changes an FX
rate or recharge discount later.

## Resolution Pipeline

The quote pipeline is deliberately linear:

```text
endpoint supply
  -> upstream price evaluation
  -> balance burn vector
  -> wallet acquisition profile resolution
  -> FX snapshot resolution
  -> effective cost quote
```

`endpointPricingService` owns the first two steps. It evaluates the upstream
rate card and produces balance burn in the upstream billing unit. It does not
know about recharge discounts or FX.

`walletAcquisitionService` resolves the profile for the selected supply:

```text
token profile
  -> account profile
  -> site profile
  -> no profile
```

Resolution is by the concrete selected upstream supply:

```ts
type WalletAcquisitionSubject = {
  siteId: number;
  accountId: number | null;
  tokenId: number | null;
  tokenGroup: string | null;
  walletCurrency: string | null;
};
```

`fxRateService` resolves one rate:

```text
faceValueCurrency -> baseCurrency
```

If `faceValueCurrency` equals `baseCurrency`, the rate is `1` and the snapshot
source is `system_default`.

`effectiveEndpointCostService` combines these inputs. It is the only module
allowed to calculate `wallet.amount` and `freeQuota.daysCost`.

## Quote Contract

`quoteEndpointPricing()` remains the single quote interface for endpoint supply
pricing. It will gain an effective cost branch rather than overloading
`endpoint.summary.totalCostUsd`.

```ts
type EffectiveCostQuote = {
  wallet: {
    amount: number | null;
    currency: string;
    sourceCurrency: string | null;
    sourceAmount: number | null;
    rechargeDiscount: number | null;
    fxRate: number | null;
    fxRateSnapshotId: string | null;
  };
  balance: {
    amount: number | null;
    currency: string | null;
    source: 'pricing_plan' | 'balance_delta' | 'upstream_billing' | 'unknown';
  };
  freeQuota: {
    daysCost: number | null;
    dailyEarnedBalance: number | null;
    source: 'manual' | 'observed_checkin' | 'mixed' | 'none';
  };
  acquisitionProfile: {
    id: number | null;
    scope: 'site' | 'account' | 'token' | null;
    inheritance: 'inherit' | 'override' | 'disabled' | null;
    confidence: 'exact' | 'estimated' | 'incomplete';
  };
  estimateLevel: 'exact' | 'estimated' | 'incomplete';
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
};
```

`PricingQuote` becomes:

```ts
type PricingQuote = {
  endpoint: PricingResolution | null;
  reference: PricingResolution | null;
  comparison: PricingQuoteComparison;
  effectiveCost: EffectiveCostQuote | null;
  diagnostics: PricingQuoteDiagnostic[];
};
```

Rules:

- `endpoint.summary` stays upstream price/burn evaluation.
- `comparison` stays relative to reference pricing.
- `effectiveCost.wallet` is the only branch converted into the operator base
  currency.
- `effectiveCost.freeQuota.daysCost` is never silently converted into money.
- missing wallet acquisition data produces `estimateLevel: 'incomplete'`, not
  a zero cost.
- `effectiveCost.balance.amount = 0` is valid only when upstream burn is known
  to be zero. Missing upstream burn remains `null`.

## Calculation

Wallet cost:

```text
walletCost =
  balanceBurn
  * faceValuePrice
  * rechargeDiscount
  * fxRate(faceValueCurrency -> baseCurrency)
```

Free quota cost:

```text
freeQuotaDaysCost =
  dailyEarnedBalance > 0
    ? balanceBurn / dailyEarnedBalance
    : null
```

For a 0-discount acquisition profile:

```text
rechargeDiscount = 0
walletCost = 0
freeQuotaDaysCost = balanceBurn / dailyEarnedBalance
```

For a paid discounted profile:

```text
rechargeDiscount = 0.8
walletCost = 80% of face-value burn after FX
freeQuotaDaysCost = null unless daily earned balance also exists
```

Paid and free mechanisms may coexist. If both cash recharge and daily earned
balance exist, the quote reports both wallet cost and free quota cost. The UI
and route scoring decide how to weigh them.

## Aggregation Rules

Route entries and measured summaries aggregate cost vectors by dimension.

Wallet cost can aggregate when all wallet costs are expressed in the same base
currency:

```text
entryWalletCost = sum(candidateProbability * candidateWalletCost)
```

Free quota can aggregate because it is normalized to "days of earned quota":

```text
entryFreeQuotaDays = sum(candidateProbability * candidateFreeQuotaDays)
```

Balance burn can aggregate only per currency/unit. The API returns buckets:

```ts
type BalanceBurnBucket = {
  currency: string;
  amount: number;
  probabilityMass: number;
};
```

If more than one balance currency exists, compact UI shows `mixed`; hover cards
show the buckets.

The aggregate estimate level is:

```text
exact       if every included candidate is exact and probabilities are exact
estimated   if at least one candidate uses observed or fallback acquisition data
incomplete  if any included dimension is missing for a non-zero probability
```

Candidates with zero probability do not affect aggregate completeness.

## Missing Data Policy

The quote must explain these missing states separately:

- no upstream price matched, so balance burn is unknown;
- no wallet acquisition profile matched;
- profile exists but `faceValuePrice` is missing;
- profile exists but `rechargeDiscount` is missing;
- FX rate is missing;
- daily earned balance is missing or zero;
- mixed balance currencies prevent one balance-burn total.

UI badges should use the same vocabulary:

```text
missing upstream burn
missing acquisition
missing FX
missing daily quota
mixed balance
```

This makes incomplete values actionable instead of merely warning-colored.

## Route Scoring

Route scoring must consume a cost vector, not just `totalCostUsd`.

```ts
type RoutingCostVector = {
  walletCostBase: number | null;
  freeQuotaDaysCost: number | null;
  unknownWalletCost: boolean;
  unknownFreeQuotaCost: boolean;
  fallbackUnitCost: number | null;
};
```

The scoring scalar is an explicit policy:

```text
routingCostScore =
  walletWeight * normalizedWalletCost
  + freeQuotaWeight * freeQuotaDaysCost
  + unknownCostPenalty
```

Defaults should be conservative:

- `walletWeight = 1`
- `freeQuotaWeight = 1`
- unknown dimensions receive a fallback penalty rather than zero.

The policy belongs in runtime settings:

```ts
type RoutingCostPolicy = {
  walletWeight: number;
  freeQuotaWeight: number;
  unknownWalletPenalty: number;
  unknownFreeQuotaPenalty: number;
  baseCurrency: string;
};
```

`tokenRouter` should receive a resolved cost vector from a small adapter. It
must not call wallet acquisition or FX services directly inside the candidate
scoring loop.

Route explanations must show both dimensions:

```text
wallet=$0.00/1M, freeQuota=0.25 days/1M
```

This keeps route scoring explainable and prevents a free-but-scarce site from
always winning.

## Actual Cost Snapshots

Proxy logs will store cost snapshots using the same vector. The source priority
for actual balance burn is:

1. request-before/request-after balance delta;
2. upstream billing or quota metadata returned by the platform;
3. usage multiplied by the current endpoint pricing estimate.

The log snapshot stores the acquisition profile and FX values used at the time:

```ts
type ProxyCostSnapshot = {
  upstreamPricingFingerprint: string | null;
  walletCostAmount: number | null;
  walletCostCurrency: string;
  balanceBurnAmount: number | null;
  balanceCurrency: string | null;
  freeQuotaDaysCost: number | null;
  dailyEarnedBalanceSnapshot: number | null;
  rechargeDiscountSnapshot: number | null;
  fxRateSnapshotId: string | null;
  source: 'balance_delta' | 'upstream_billing' | 'pricing_estimate';
  estimateLevel: 'exact' | 'estimated' | 'incomplete';
};
```

Snapshot rules:

- exact balance deltas override pricing estimates for `balanceBurnAmount`;
- wallet acquisition values are copied from the active profile at request time;
- FX rates are copied from the snapshot used at request time;
- old logs with no snapshot render their old `estimatedCost` as legacy cost.

Measured entry pricing should aggregate these snapshots independently:

```text
measured.walletCostBase
measured.balanceBurn by currency
measured.freeQuotaDaysCost
```

## UI And UX

The admin UI should present this as wallet economics, not as a free-site
special case.

Design tone: dense operational UI. Avoid marketing-style cards. Use compact
rows, small badges, hover cards for formulas, and stable table columns.

### Cost Configuration

Add a compact section named **Wallet acquisition** to the upstream cost pricing
dialog. It sits after the rate-card fields and before reference pricing.

Fields:

- wallet currency;
- face-value price;
- face-value currency;
- recharge discount;
- daily earned balance;
- source badge: manual / observed / mixed / none.

Suggested layout:

```text
Rate card
  input/output/cache/request prices

Wallet acquisition
  wallet unit       [balance]
  face value        [1.00] [CNY]
  recharge discount [0.00]
  daily earned      [40] balance/day

Preview
  upstream burn     10 balance / 1M
  wallet cost       $0.00 / 1M
  free quota        0.25 days / 1M
```

Validation:

- `rechargeDiscount` must be between `0` and `1` for discount mode.
- `dailyEarnedBalance` must be positive when free quota is enabled.
- `faceValuePrice` and `faceValueCurrency` are required for non-zero wallet
  cost.
- FX rate is required when `faceValueCurrency != baseCurrency`.

Do not ask for opportunity cost in the primary form. If needed later, it can be
an advanced route-scoring policy, not a wallet profile field.

### Site And Account Management

Site and account rows should show only summary badges:

```text
Wallet CNY
discount 0x
quota +40/day
```

Opening the cost dialog remains the place to edit details. The table should not
grow inline acquisition fields.

When a site has no profile, show no badge rather than a warning. Warnings belong
in pricing preview surfaces where the missing data affects a calculation.

### Model Workspace

Pricing cards show three rows:

```text
Wallet cost       $0.42 / 1M
Balance burn      10 balance / 1M
Free quota        0.25 days / 1M
```

For mixed entries:

```text
Wallet cost       $0.50 / 1M
Balance burn      mixed
Free quota        0.50 days / 1M
```

Hover details explain the calculation:

```text
10 balance * 0 discount * CNY->USD = $0.00
10 balance / 40 balance/day = 0.25 days
```

Incomplete badges must list missing data:

- missing face-value price;
- missing FX rate;
- missing daily earned balance;
- mixed balance currencies.

The model workspace should not show a single `Total` row when effective cost is
multi-dimensional. Replace it with a compact cost vector:

```text
Upstream price     $0.70 input / $1.40 output
Wallet cost        $0.00 / preview
Free quota         0.25 days / preview
```

For measured pricing, use the same layout but change labels:

```text
Measured wallet    $0.03 / request
Measured balance   2.3 balance
Measured quota     0.06 days
```

This keeps theoretical and actual cost comparable without pretending both are
the same data source.

### Route Flow

Candidate rows show the cost vector beside probability:

```text
probability 50%
wallet $0.00/1M
quota 0.25 days/1M
```

The compiled route summary shows the aggregate vector, not only USD.

Candidate hover details should show the formula:

```text
wallet = burn * faceValue * discount * FX
quota = burn / dailyEarnedBalance
```

For mixed entries, the aggregate hover lists top contributors:

```text
site-a 50% * 0.50 days = 0.25 days
site-b 50% * 0.00 days = 0.00 days
```

Limit this list to the top five contributors and group the rest as `other`.

### Proxy Logs

Actual billing details show the snapshot source:

```text
Actual wallet cost: $0.00
Balance burn: 2.3 balance
Free quota: 0.06 days
Source: balance delta
```

When actual balance burn is unavailable, mark the cost as estimated.

Proxy log detail should display both the old legacy cost and the new snapshot
when both exist:

```text
Legacy estimate    $0.000123
Wallet snapshot    $0.000000
Quota snapshot     0.003 days
```

This avoids confusing old logs during migration.

### Settings

Runtime settings get one compact **Cost policy** section:

```text
base currency        [USD]
wallet weight        [1.00]
free quota weight    [1.00]
unknown cost penalty [1.00]
```

Presets:

```text
Cash saver      wallet=2, quota=0.5
Quota saver     wallet=0.5, quota=2
Balanced        wallet=1, quota=1
```

These are route-scoring controls, not pricing facts.

## Module Boundaries

New modules:

```text
walletAcquisitionService
  resolves profile by site/account/token
  estimates daily earned balance
  owns acquisition diagnostics

fxRateService
  resolves FX snapshots
  never performs pricing evaluation

effectiveEndpointCostService
  combines endpoint pricing, acquisition profile, and FX
  produces EffectiveCostQuote

costVectorFormatter
  shared web formatting helpers for wallet, balance, and quota dimensions
  contains no pricing rules
```

Existing modules:

- `endpointPricingService` continues to resolve upstream price/burn.
- `pricingQuoteService` becomes the orchestration seam for endpoint,
  reference, comparison, and effective cost.
- `routeEntryPricingService` aggregates effective cost vectors.
- `tokenRouter` consumes routing cost vectors through a narrow adapter instead
  of re-implementing wallet economics.
- Fastify route files and React pages remain adapters/presentation.

## API Surfaces

New admin endpoints:

```text
GET    /api/wallet-acquisition-profiles?siteId=&accountId=&tokenId=
PUT    /api/wallet-acquisition-profiles/:id
POST   /api/wallet-acquisition-profiles
DELETE /api/wallet-acquisition-profiles/:id

GET    /api/fx-rates?from=&to=
PUT    /api/fx-rates/:from/:to
```

Existing pricing preview endpoints should return `effectiveCost` once
available. Avoid a second preview API for wallet cost.

Route-flow and model workspace API responses should expose aggregate vectors:

```ts
type EntryPricingEffectiveCost = {
  walletCost: { amount: number | null; currency: string };
  balanceBurn: BalanceBurnBucket[];
  freeQuotaDaysCost: number | null;
  estimateLevel: 'exact' | 'estimated' | 'incomplete';
  diagnostics: PricingQuoteDiagnostic[];
};
```

## Test Strategy

Unit tests:

- wallet profile inheritance and disabled overrides;
- FX snapshot resolution;
- zero discount wallet cost;
- missing daily quota diagnostics;
- mixed balance bucket aggregation;
- paid/free mixed entry aggregation.

Integration tests:

- `quoteEndpointPricing()` returns endpoint, reference, comparison, and
  effective cost in one response;
- route-flow aggregates wallet and quota cost across candidates;
- proxy log snapshots do not change after profile edits;
- tokenRouter receives cost vectors through its adapter.

Web tests:

- cost dialog validates discount, FX, and daily earned balance fields;
- model workspace renders wallet/quota rows and mixed balance hover details;
- route-flow candidate rows show probability plus cost vector;
- proxy log detail renders legacy and snapshot cost side by side.

## Migration Plan

1. Add acquisition profile and FX snapshot schema.
2. Extend `PricingQuote` with `effectiveCost` while preserving current
   `endpoint` and `comparison` callers.
3. Add wallet/free quota rows to endpoint preview pricing and model workspace.
4. Extend route entry pricing aggregation with effective cost vectors.
5. Store proxy cost snapshots for new logs.
6. Switch tokenRouter cost scoring from scalar endpoint cost to
   `RoutingCostVector`.
7. Add observed daily earned balance from check-in/balance refresh data.

Each step should be independently shippable. Until step 6, routing behavior may
continue using existing endpoint/fallback scalar costs.

## Consequences

Positive:

- free sites no longer appear as universally zero-cost;
- paid discounts and 0-discount acquisition use the same model;
- mixed free/paid entries stay explainable;
- historical actual cost does not drift after profile or FX edits;
- route scoring can balance cash preservation and free quota preservation.

Negative:

- the pricing UI gains another concept;
- mixed balance currencies cannot always show one balance-burn number;
- route scoring needs a policy for unknown dimensions;
- old logs will not have wallet/free quota snapshots.

## Rejected Alternatives

### Convert Free Quota To USD By Default

Rejected because it hides operator preference. One operator may treat free
quota as nearly worthless; another may treat it as scarce. That is a route
policy decision, not a pricing fact.

### Model Human Time Cost In The Wallet Profile

Rejected for the initial design. The user's primary variation is daily earned
balance, not check-in labor. Time cost can be an advanced opportunity-cost
policy later.

### Keep Only `totalCostUsd`

Rejected because paid and free mixed entries cannot be represented without
misleading users. `$0.50 + 0.50 days quota` is not the same thing as `$0.50`.
