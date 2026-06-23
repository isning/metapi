# Issue: Request-Scoped Route Execution

Date: 2026-06-23
ADR: [ADR-0013](../adr/0013-request-scoped-route-execution.md)

## Goal

Make graph-native routing a closed per-request execution domain. Once a request
matches a route graph candidate set, retries must stay inside that candidate set
instead of re-running global model matching. API variant fallback and transport
replica fallback must remain below the selected target and must be explained as
execution attempts, not graph fallback.

## User Stories

- As an operator, when I connect several supply candidates in the graph, retries
  must not send traffic to supplies outside those connected candidates.
- As an operator, when a request falls back from Responses to Chat or Messages,
  I want to see that this happened inside the selected supply target, not as a
  graph route change.
- As an operator, when I inspect historical logs, route decisions and execution
  attempts must remain explainable after routes or endpoint profiles change.

## Vertical Slices

### 1. Freeze RouteExecutionScope At Request Entry

Type: AFK
Blocked by: None - can start immediately

Build a request-local scope produced by route graph runtime and threaded through
the first target selection. The scope must include graph version, matched entry,
candidate ids, allowed target ids, selected candidate, post-build filters, and
trace source refs.

Acceptance criteria:

- [ ] A proxy request creates one immutable route execution scope before target
      execution starts.
- [ ] The scope captures the graph candidate set and target ids used by
      selection.
- [ ] Existing first-attempt routing behavior is preserved.
- [ ] Tests prove the scope snapshot does not change when route data is
      refreshed during the request.

### 2. Retry Targets Only Within The Frozen Scope

Type: AFK
Blocked by: Slice 1

Replace retry-time global model matching with scope-aware target failover. The
retry selector should only consider candidates and target ids in the frozen
scope, plus normal dynamic eligibility filters such as cooldown, downstream
policy, token availability, and site/runtime health.

Acceptance criteria:

- [ ] `selectNextTargetWithinScope` or equivalent exists and is used by proxy
      retries.
- [ ] Proxy retries no longer call global `findRoute(requestedModel)` after a
      scope exists.
- [ ] Regression test: graph candidates A/B, graph-external compatible target C;
      if A fails, retry may choose B but must never choose C.
- [ ] Forced-target mode fails closed when the forced target is outside the
      request scope.

### 3. Classify Fallback Scope And Failure Class

Type: AFK
Blocked by: Slice 1

Introduce explicit fallback metadata for execution attempts. Replace
operator-facing `cross_protocol_downgrade` wording with `api_variant` fallback
and record the failure class that caused it.

Acceptance criteria:

- [ ] Debug attempts expose `fallbackScope` and `failureClass`.
- [ ] Protocol mismatch errors such as `messages is required` and
      `input is required` classify as `api_variant`.
- [ ] Transport/network failures classify separately from protocol mismatch.
- [ ] UI strings and trace labels no longer present API variant fallback as a
      graph downgrade.

### 4. Split Route Decision And Execution Attempt Snapshots

Type: AFK
Blocked by: Slices 1 and 3

Extend log/debug snapshots so route decisions and execution attempts are
separate immutable records. The route section should show the graph candidate
set and selected supply target. The execution section should show target, API
variant attempts, transport replicas, fallback scopes, and final result.

Acceptance criteria:

- [ ] New proxy logs snapshot route scope ids, candidate ids, selected target,
      API variant ids, and transport attempt ids without token secrets.
- [ ] Historical log detail prefers snapshot data and does not drift when route
      tables change.
- [ ] The usage log detail UI visualizes route decision and execution attempts
      as two distinct flows.
- [ ] Existing old logs still display with a clearly labeled best-effort
      fallback.

### 5. Fold Site API Endpoint Pool Into Transport Replicas

Type: AFK
Blocked by: Slice 3

Move the long-term base URL failover model under API endpoint profiles as
transport replicas. Keep compatibility shims for existing `site_api_endpoints`
rows during migration, but prevent new runtime code from treating them as an
independent fallback layer.

Acceptance criteria:

- [ ] API endpoint profiles can expose one or more transport replicas.
- [ ] Existing `site_api_endpoints` data is read through the replica abstraction.
- [ ] Transport fallback cannot change API variant, target, or route candidate.
- [ ] Runtime trace records the selected replica and replica fallback reason.
- [ ] Schema changes update Drizzle schema, SQLite migrations, and generated
      cross-dialect schema artifacts together.

### 6. Execute Attempt-Based Plans Instead Of Endpoint String Lists

Type: AFK
Blocked by: Slices 2, 3, and 5

Replace the long-term `executeEndpointFlow(endpointCandidates)` contract with an
attempt-based execution runner. Each attempt should carry API variant identity,
credential endpoint binding, path/template, transform adapter, transport
replicas, and fallback policy.

Acceptance criteria:

- [ ] Proxy orchestration executes `ApiAttempt[]` rather than bare endpoint
      strings for chat/responses/messages fallback.
- [ ] Learned endpoint mismatch reorders attempts inside the selected target
      only.
- [ ] Fixed-operation endpoints such as embeddings, images, videos, and
      completions do not join the chat/responses/messages fallback group.
- [ ] Existing endpoint fallback behavior remains covered by regression tests.
- [ ] `npm run repo:drift-check` passes after the orchestration seam changes.

## Acceptance Criteria

- [ ] Graph candidate sets are hard request boundaries for target retry.
- [ ] API variant fallback cannot move traffic to another route candidate.
- [ ] Transport fallback cannot move traffic to another API variant.
- [ ] Operator-facing logs clearly distinguish route decision from execution
      fallback.
- [ ] No token secret is stored in route or execution snapshots.

## Notes

This work intentionally does not make `/chat`, `/responses`, or `/messages`
first-class route graph nodes. Those remain API variant details beneath the
selected supply target, as specified by ADR-0010.
