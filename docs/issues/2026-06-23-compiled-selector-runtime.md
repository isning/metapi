# Issue: Compiled Selector Runtime

Date: 2026-06-23
ADR: [ADR-0012](../adr/0012-compiled-selector-runtime.md)

## Goal

Move semantic graph selection and endpoint/channel selection onto one compiled
selector runtime so CEL, metadata policies, health weighting, cooldown avoidance,
runtime load, cost, balance, usage, and downstream multipliers are evaluated by a
single data-plane module.

## Scope

- Add a server-side `selectorEngine` module.
- Hydrate selector policies with cached CEL parse/plan results.
- Support:
  - `weighted`
  - `priority_order`
  - `round_robin`
  - `stable_first`
  - `direct`
  - CEL score/rank/select
  - precomputed dynamic contribution vectors
- Replace route graph runtime's local dispatcher helper with `selectorEngine`.
- Route tokenRouter's weighted and stable-first final numeric selection through
  `selectorEngine` while preserving existing health/cost/load semantics.
- Keep endpoint eligibility, token availability, cooldown state mutation, and
  route-unit member dispatch in tokenRouter.

## Acceptance Criteria

- Route graph CEL score/direct tests pass without per-request `run(expr)`.
- Route graph runtime has no local CEL parse/run dispatcher implementation.
- Token router still:
  - avoids recently failed channels;
  - respects site/model runtime breakers;
  - applies cost, balance, usage, global site weight, downstream site
    multipliers, historical health, runtime health, and runtime load;
  - preserves stable-first observation-pool behavior.
- Architecture tests assert that graph runtime delegates selection to
  `selectorEngine`.
- `npm run repo:drift-check` passes after shared runtime changes.

## Follow-Up

- Move tokenRouter eligibility and priority-bucket preparation behind hydrated
  selector adapters.
- Emit route-flow/model-test explanations directly from selector snapshots.
- Add micro-benchmarks for large candidate sets with CEL and dynamic health
  terms.

