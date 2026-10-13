# Architecture guardrails

The non-negotiable invariants, each a **citable rule**. Agents cite `guardrails.md#G<n>` in findings. On conflict with any code, the rule wins — fix the code.

### G1 — Client is never trusted
Intents carry **indices / typed args / ids only — NEVER amounts, prices, balances, or state**. The server `enumerate()`s the legal option set and computes every number. A stray `amount`/`price`/`balance` field on an intent is a money-printer regression.
*Comply:* intent payloads are `{type, args:{...ids/indices}}`. The server never reads a value the client could have set.

### G2 — The LLM never writes state
The model **proposes within sim-authored bounds** (an index into an enumerated set, or a draft over a vetted DSL); the deterministic TCB validates and owns truth. It never mints currency, fires an unvalidated event, grants an arbitrary reward, or is assembled into an Actor. Its output is UNTRUSTED and re-enters the same intent pipeline.
*Comply:* cognition returns a proposal; the room re-validates (`can()` → re-`enumerate()` → execute). Cognition holds zero grant on `ledger.*`.

### G3 — Engine ↛ game module
Genre-neutral engine packages must **never** import a game module (e.g. `@celestia/game-cozy`). Reuse = a new module + its own deployment, never an engine fork.
*Comply:* dependency direction is `apps/services → composition → {core, adapters, game-*} → ports → leaf-contracts`. An arch-test (dependency-cruiser) goes red on violation.

### G4 — Event-sourced truth
Mutations are append-only events in `log.event` (seq + prev_hash chain; `UPDATE`/`DELETE` revoked). State is a projection via a pure `apply(state, event, oracleLookup)` reducer. Replay reads logged oracle outputs (`log.oracle_call.chosen_idx`) and **never re-infers**.
*Comply:* no mutable state rows as truth; reducers are pure (integer money, seeded PRNG, no wall-clock).

### G5 — One EconomyService chokepoint
All value moves through the single `EconomyService`. Integer money only (`NUMERIC(38,0)` at rest / `bigint` in process / decimal-string on wire). It is the **only** emitter of `economy.posted@N`; idempotency key → same receipt on replay.
*Comply:* no code computes or writes a balance except via `EconomyService`.

### G6 — `can()` deny-by-default
Every mutating intent passes `can(actor, action, resource, ctx)` **before** `enumerate`/`execute`, re-run on NPC/System-2 apply. `resolveResource` reads scope/owner from **authoritative room/DB state**, never the client envelope. Default → deny.
*Comply:* no mutation path skips `can()`; unknown action/slug → deny.

### G7 — Ports/adapters
Only the composition root (server) / `Jupiter` (client) names a concrete adapter class. Callers depend on the port (interface), never a concrete. Swapping an adapter changes one wiring line, not call sites.
*Comply:* `grep` for a concrete adapter name outside the composition root → a leak.

### G8 — No secrets in code
No tokens, keys, or credentials in source — ever. Config via env (`@celestia/config` zod loader).

### G9 — Determinism
Fixed-timestep sim; seeded RNG from `event.seed`; no `Date.now()`/wall-clock inside reducers or sim logic. Replay must be byte-identical.

### G10 — Naming / structure
`services/` (not `apps/`); `realtime` (not `game-server`); role-named services (`realtime`/`meta`/`cognition`), no redundant `-server` suffix.

### G11 — Client never sets its own privilege
Identity, role, and entitlement are **server-assigned state** — never values the client supplies. An auth/login request carries a *credential to be verified*, never a requested role, tier, or permission. Every account lands at the baseline tier (`terra`) on login; elevation happens **only** through an authorized, audited admin action by an already-privileged principal — or a server-local bootstrap that requires shell/DB access to the box — **never** self-service. **Gating *whether* a session is issued is not granting *what* it may do:** a shared/shareable secret (e.g. `BASIC_AUTH_SECRET`) may gate access to a login method, but no secret, anywhere, ever grants a role — the instant a credential that elevates can be forwarded to someone else, privilege has leaked. `can()` derives the actor's authority from authoritative state (`account.role`), not from the request envelope or a client-asserted claim; the `role` in a JWT is a server-minted mirror of that state, never an input. (Sharpens G1 + G6 for the identity/role axis, and spans the auth boundary they don't.)
*Comply:* no auth/login/intent payload is ever read to set role/privilege/tier; a `role`/`tier`/`isAdmin`-style field on a request body is ignored and is a finding. Role changes go through the audited admin path only; grep for role being written from anything client-derived → a leak.
