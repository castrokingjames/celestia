# Error handling & failure

## Server (authoritative)

- **Validate, then act.** An intent that fails `can()` / `enumerate()` is **rejected with a typed reason code** (closed union, from `net-contract`) — never silently dropped, never a bare `-1`. The client gets `intent_rejected(seq, type, reason)`.
- **Deny-by-default (G6).** Unknown action, unknown slug, missing resource, insufficient balance → a deterministic typed refusal. Insufficient-balance refusal is deterministic, not a throw-and-hope.
- **Fail closed on cognition.** Deadline / breaker / out-of-range index / stale `cid` / low confidence → **abstain → scripted fallback** (G2). The tick never stalls waiting on the model.
- **No partial writes.** A mutation is one event appended atomically (reserve → execute → fenced append → ack). On failure, nothing is written.

## Reason codes

Closed, versioned unions in `net-contract` — one spelling per reason, no `not_in_alpha`/`no_alpha` splits. New reason → add to the union, regenerate the client contract.

## Logging

Structured (pino, JSON), `trace_id`-correlated. Log the failure with its reason code; never log secrets, tokens, or raw balances.

## Client (untrusted, thin)

- The client **surfaces** server reasons; it never *judges* legality itself (G1). A client-side `max_len` is a UX guard only, not a firewall.
- Connection failures: use the WS connection state; on drop, consult the status gate to disambiguate "server down" vs "your network" (see `docs/INFRA.md §9`).
