# Issue: Route Flat Program Bundle V4

Date: 2026-06-23
ADR: [ADR-0011](../adr/0011-route-flat-program-bundle-v4.md)

## Goal

Move request routing from the V3 operation-chain bundle to a flatter V4 runtime
plan. The semantic route graph remains the editing model; V4 is the executable
data-plane representation.

## Scope

- Add `RouteProgramBundleV4` shared types and `flatProgramBundle` on
  `CompiledRouteGraph`.
- Compile V3 operation chains into V4 decision objects:
  - filter stages;
  - dispatch plans;
  - inline candidates;
  - supply terminals with inline targets;
  - synthetic terminals.
- Make `evaluateCompiledRouteGraph()` prefer V4.
- Fail closed when a compiled graph lacks usable V4; active graph loading owns
  recompiling old snapshots.
- Keep graph-native route matches inside tokenRouter's channel health layer
  instead of scoping them to one preselected channel.
- Recompile old active graph snapshots that do not contain usable V4.
- Use V4 for route-flow candidate probability and theoretical cost estimates.
- Keep the existing runtime selection return contract.

## Acceptance Criteria

- Compiled graphs include `flatProgramBundle.version === 4`.
- Runtime no longer needs `opsByProgramId` for V4 execution.
- Endpoint cooldown, recently failed avoidance, site runtime breakers, success
  rate weighting, and downstream/site weight multipliers still apply after V4
  graph matching.
- Existing route evaluator behavior remains stable for filters, weighted
  routing, priority routing, round-robin, CEL/direct routing, target selection,
  synthetic fallback, compatibility policy, and hop limits.
- Model route-flow explanations and pricing estimates walk V4 decisions.
- Architecture tests assert the V4 evaluator path.

## Follow-Up

- Delete remaining V3 helper code after persisted compiled graph migration is
  complete.
- Prehydrate V4 priority buckets, enabled candidate arrays, weighted totals, and
  matcher regex caches.
- Add micro-benchmarks for exact-match plus large candidate-set selection.
