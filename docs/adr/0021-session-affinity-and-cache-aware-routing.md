# ADR-0021: Session Affinity And Cache-Aware Routing

Status: Accepted
Date: 2026-08-12

## Context

The proxy needs to preserve upstream continuity for clients that provide a
stable conversation identity, while still allowing short or anonymous requests
to choose the cheapest healthy route. A content prefix can be useful as a cache
hint, but it is not a reliable session identity: two independent conversations
can start with identical text.

`executionTargetId` is the atomic credential/model target. It already separates
accounts, tokens, and upstream models. The same target can expose several
downstream endpoint types, such as OpenAI Responses and Chat Completions, with
different continuation and cache semantics.

## Decision

Affinity is split into two evidence classes:

```ts
type AffinityEvidence =
  | { kind: 'strict_session'; sessionKey: string }
  | { kind: 'content_hint'; prefixHash: string }
  | { kind: 'none' };
```

Strict session evidence comes from a client session/conversation identifier or
an explicit `X-Metapi-Affinity-Key`. It may create a sticky binding and consume
the guarded session lease pool.

Content evidence is an HMAC-SHA256 of a bounded, normalized stable prompt
prefix. The HMAC key is process-local and the prompt text is never stored. The
evidence is never exposed as `sessionId`, never creates a strict sticky binding,
and never enters the session lease pool. It is used only as cache-aware cost
evidence. Stable-prefix extraction covers OpenAI Chat/Responses,
Anthropic Messages, and Gemini `systemInstruction`/`contents` text. Binary,
image, tool-result, and later-turn content is excluded.

The strict upstream affinity identity is:

```text
executionTargetId + endpointType
```

`endpointType` is a normalized protocol/cache semantic, for example:

```text
openai.responses
openai.responses.compact
openai.chat_completions
anthropic.messages
anthropic.messages.count_tokens
gemini.generate_content
```

The current in-memory sticky key includes this endpoint type. The route graph
and database target identity do not need to be rebuilt for this distinction.

## Cache-Aware Cost Model

Content hints do not force a target. When cache observations are available, the
router compares candidates using:

```text
expectedCost =
  hitProbability * (cacheReadCost + hitCacheWriteCost)
  + (1 - hitProbability) * (coldInputCost + missCacheWriteCost)
  + outputCost
```

The first request uses conservative cold-cost assumptions. Real upstream
`cacheReadTokens` and `cacheCreationTokens` update a bounded, one-hour in-memory
observation history. A single hit is smoothed against one virtual miss, so
content similarity cannot become strict affinity. Explicit zero-valued cache
fields count as miss evidence; ordinary token usage without cache fields does
not. Unknown cache pricing or unsupported usage reporting falls back to the
ordinary cold quote rather than assuming a free cache operation.

Recognized evidence includes OpenAI cached-token details, Anthropic cache read
and cache creation tokens, and Gemini `cachedContentTokenCount`. A cache field
must contain an explicit numeric value; `null` placeholders do not count as a
cache miss.

Cache observations are scoped by:

```text
executionTargetId + endpointType + prefixHash
```

This assumes endpoint pool members under one execution target are equivalent
cache namespaces. If that invariant is false, they must become separate
execution targets before cache-aware routing is enabled.

The request endpoint type is recorded separately from the actual successful
upstream endpoint type. A short-lived alias links them after protocol fallback,
while observations remain stored under the actual upstream type.

## Provider Capabilities

The initial implementation is evidence-driven: a provider or custom adapter
participates only when the response contains recognized cache usage fields and
the pricing resolution contains the corresponding cache read/write rate. An
explicit provider capability registry can later disable misleading provider
reports without changing the observation identity.

## Operations And UI

Cache-aware routing is automatic and has no separate per-route toggle. Operators
configure cache read/write prices through the existing upstream cost pricing
editor and configure strict-session concurrency and queue limits in Settings.
Model Route Flow exposes cache pricing and request-scoped routing cost, while
Proxy Logs exposes actual cache token billing and strict sticky hits. The opaque
content HMAC is intentionally not shown or made editable in the UI.

## Consequences

- Long, explicitly identified sessions retain continuity.
- Short requests remain free to choose lower-cost healthy targets.
- Identical anonymous conversations may share a cache hint, but cannot share
  strict continuation state or leases.
- Endpoint type differences cannot cross-contaminate sticky state.
- Process restart intentionally clears cache hints and observations. A future
  persistent observation store requires a stable server-side HMAC key and can
  be added without changing the strict affinity contract.
