# Issue: Route Flat Program Bundle

Date: 2026-06-23
ADR: [ADR-0011](../adr/0011-route-flat-program-bundle.md)

## Goal

Move request routing from the operation-chain bundle to a flatter runtime plan.
The semantic route graph remains the editing model; the flat bundle is the
executable data-plane representation.

## Scope

- Add `RouteFlatProgramBundle` shared types and `flatProgramBundle` on
  `CompiledRouteGraph`.
- Compile operation chains into flat decision objects:
  - filter stages;
  - dispatch plans;
  - inline candidates;
  - supply terminals with inline targets;
  - synthetic terminals.
- Make `evaluateCompiledRouteGraph()` prefer `flatProgramBundle`.
- Fail closed when a compiled graph lacks a usable flat bundle; active graph
  loading owns recompiling old snapshots.
- Keep graph-native route matches inside the route target health and cooldown
  layer instead of scoping them to one preselected target.
- Recompile old active graph snapshots that do not contain a usable flat bundle.
- Use the flat bundle for route-flow candidate probability and theoretical cost estimates.
- Keep the existing runtime selection return contract.

## Acceptance Criteria

- Compiled graphs include `flatProgramBundle.version === 1`.
- Runtime no longer needs `opsByProgramId` for flat execution.
- Endpoint cooldown, recently failed avoidance, site runtime breakers, success
  rate weighting, and downstream/site weight multipliers still apply after flat
  graph matching.
- Existing route evaluator behavior remains stable for filters, weighted
  routing, priority routing, round-robin, CEL/direct routing, target selection,
  synthetic fallback, compatibility policy, and hop limits.
- Model route-flow explanations and pricing estimates walk flat decisions.
- Architecture tests assert the flat evaluator path.

## Follow-Up

- Delete remaining operation-chain helper code after persisted compiled graph migration is
  complete.
- Prehydrate flat priority buckets, enabled candidate arrays, weighted totals,
  and matcher regex caches.
- Add micro-benchmarks for exact-match plus large candidate-set selection.
