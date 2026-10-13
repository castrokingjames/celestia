<!-- Generated 2026-10-06 by a multi-agent design pass: 7 component seams -> security/consistency critique -> synthesis. -->

> **Editor's note (2026-10-06):** **Seam 1 (Identity & Auth)** below uses the *generic* "managed IdP + guest/email" framing from before we settled on **Discord-primary authentication** (web / desktop / mobile + a Telegram Mini App host, with alpha/beta gated to a specific Discord **guild role**). The dedicated **`AUTH.md`** is the authority for those specifics and supersedes Seam 1's auth-provider details; the rest of Seam 1 (token model, 60-second single-use realtime ticket, JWKS offline verification, durable ban fan-out) still stands.

---

# Celestia — End-to-End Architecture

**Status:** Authoritative (v1). Supersedes the seven seam drafts.
**Stance:** Ship a slice first, architect toward the dream. The LLM proposes, the sim disposes. Degrade *toward* determinism, never toward chaos.

---

## 1. Overview + Master Sequence

Celestia is a persistent, LLM-driven life/farming sim. A **Godot 4** client renders and sends *intents only*. **NestJS** is the account/auth/matchmaking/moderation authority over **PostgreSQL (+pgvector)**. Each village is one **Colyseus** room — a single-threaded, in-RAM authoritative simulation that validates every intent, runs a low-Hz deterministic tick, and *dispatches* (never blocks on) cognition. A separate GPU-backed **Cognition Gateway** fronts **Mica-4B** (System 1, typed calibrated-probability decisions, no text) and a **System 2** generative model (dialogue, offline content). **Redis** carries presence, the room registry, shared-NPC leases/fences, pub/sub, caches, and rate limits — never truth. Postgres holds truth as an **append-only event log** (every other table is a replayable projection); pgvector is a rebuildable RAG recall index. The spine that makes LLM-driven NPCs safe: the sim enumerates a legal option set, the model can only return an *index* or *typed intent*, and deterministic validators inside the room — the **Trusted Computing Base (TCB)** — own all state writes. The client is not trusted; the LLM is not trusted.

```
LOGIN → MATCHMAKE → CONNECT → INTENT → NPC DECISION → DIALOGUE → PERSIST

Godot        NestJS         Redis        Colyseus room(zone)     Cognition GW      Postgres
  │  POST /auth/guest         │              │                        │               │
  ├────────────▶│ mint access(15m)+refresh(60d), account_id ──────────────────────────▶│ (authz.*)
  │◀── tokens ──│             │              │                        │               │
  │                                                                                    │
  │ POST /play {Bearer access, intent:home}  │                        │               │
  ├────────────▶│ verify JWT(JWKS, local)    │                        │               │
  │             │ resolve zone; GET presence ─▶│                       │               │
  │             │ mint REALTIME TICKET (EdDSA, aud:celestia-realtime,60s) │               │
  │             │ /internal/reserve ──────────────────▶ seat reserved  │               │
  │◀─ {endpoint, reservation, reconnectionToken, zoneId} ─│           │               │
  │                                                                                    │
  │ WSS joinById(ticket) ──────────────────────────────▶│ onAuth:                     │
  │                                              reject aud=celestia-api; verify ticket;  │
  │                                              GETDEL rtticket:{jti}; GET banver     │
  │                                              onJoin: warm rel+inv from PG ─────────▶│
  │◀══════════ schema state sync (StateView, 2–10 Hz) ═══│                             │
  │                                                                                    │
  │ send intent {seq, give_gift(mira,leek), traceparent} ─▶│ onMessage: ratelimit,     │
  │                                              bounds → intentQueue                   │
  │                                       TICK: validate(TCB) → enumerate options       │
  │                                              dispatch(cid, opts, frame) ───────────▶│ /v1/systemone
  │                                              [NO await; tick returns]       Mica 54ms│
  │                                       TICK N+k: inbox{argmax,probs}◀────────────────┤
  │                                              re-validate; execute; mutate schema    │
  │                                              (dialogue? → ConversationFSM) ─────────▶│ /v1/chat (System 2)
  │◀── rel_delta (per-player) + token stream (per-client) ─│  parse typed intents       │
  │                                              RE-VALIDATE intents (TCB)              │
  │                                       COMMIT txn: scalars + log.event +             │
  │                                              log.oracle_call + outbox ──────────────▶│ (log.*, player.*)
  │◀── ack(seq) ─────────────────────────────────│  outbox→embed worker (async)─────────▶│ (memory.*)
```

---

## 2. Component Map

| Component | Stack piece | Single responsibility | Owns (authoritative) | Does NOT |
|---|---|---|---|---|
| **Game client** | Godot 4 | Render, input, interpolation, token custody, connection UI | Access token (RAM), refresh token (encrypted at rest) | Decide anything; hold authoritative state; call a model |
| **Meta API** | NestJS | Auth/account authority, matchmaking policy, inventory/economy custody *at rest*, admin/moderation, GDPR | `authz.*`, zone-assignment policy, the ban/erasure authority | Host rooms; hold hot sim state; verify in the hot loop |
| **Zone room** | Colyseus | Authoritative in-session simulation of one village; the TCB | SHARED-sim RAM state, intent validation, event `seq` assignment | Be durable truth; call a model directly |
| **Cognition Gateway** | cognition svc (Node) | Batch/route/cache every model call; RAG assembly | Model endpoints, batch scheduler, decision cache | Write game state; be inside the TCB; be handed a client-supplied `player_id` |
| **Mica-4B (S1)** | cognition svc (GPU) | Typed calibrated decision over a sim-authored enum | Nothing (stateless oracle) | Emit text; write state |
| **System 2** | cognition svc (hosted→vLLM) | Dialogue text + offline content, constrained to typed intents | Nothing (stateless oracle) | Write state; be on the <100ms path |
| **Postgres+pgvector** | Postgres | Durable source of truth (event log) + RAG recall index | All truth; projections; embeddings | Hot per-tick state |
| **Redis** | Redis | Ephemeral coordination: presence, registry, leases/fences, pub/sub, caches, rate-limit, ban stream | Nothing durable | Be truth |

---

## 3. Seam Designs

### Seam 1 — Identity & Auth

**Shape.** The managed IdP is a *credential broker only*; **NestJS mints every Celestia token**. One immutable `account_id` is the universal join key, stable across guest→registered upgrade. Access = 15-min EdDSA JWT (`aud:celestia-api`); refresh = opaque 256-bit, one-time-use, DB-backed, 60-day sliding; **realtime ticket = EdDSA JWT, `aud:celestia-realtime`, 60s, single-use**. Colyseus verifies locally against cached JWKS — zero NestJS round-trips on the hot path.

**Key contracts.**
- `POST /auth/guest {device_id, attestation}` → tokens (NestJS-native, no IdP).
- `POST /auth/upgrade (Bearer guest) {code, verifier}` → same `account_id` + new tokens; `409` if identity linked elsewhere.
- `POST /auth/token/refresh {refresh}` → rotated pair; reuse → whole-family revoke; ~10s idempotency grace on `(family_id, generation)` for retried refreshes.
- `GET /auth/realtime-ticket?zone=` → the ONLY credential `onAuth` accepts.
- `GET /.well-known/jwks.json` → `current`+`next` Ed25519 keys, mirrored to Redis `auth:jwks`.

**Critique resolved — this is the corrected design:**

- **One ticket scheme, one burn point** *(fixes ticket contract/burn ambiguity)*. There is exactly one realtime credential: the EdDSA JWT with `aud:["celestia-realtime"]`, 60s, carrying `{sub, sid, zone, jti}`. The seat-reservation `/internal/reserve` step (Seam 2) is an *internal* NestJS→Colyseus HMAC-signed service call that is a **separate** concern — it does **not** reuse the client ticket. The client ticket is **burned exactly once, atomically, with `GETDEL rtticket:{jti}`, at `onAuth`** (the first and only server that consumes it). Reserve does not touch it.
- **Reject `aud:celestia-api` at `onAuth` from day one** *(fixes audience confusion / 15-min REST-credential replay)*. There is no slice-1 shortcut of passing the access token to `onAuth`. `onAuth` requires `aud` to include `celestia-realtime` and rejects anything else. The realtime ticket exists from the first commit.
- **Ban/revocation is durable + fail-closed for sensitive actions** *(fixes Redis fail-open ban evasion)*:
  - Ban fan-out is a **Redis Stream `auth:ban:events`** (persistent), not bare pub/sub. Each room process maintains a consumer position and **reconciles on every Redis reconnect** (reads the stream tail since its last ack) — a `PUBLISH` missed during a reconnect window is caught on reconnect.
  - Bans are also pushed over an **authenticated NestJS→room gRPC channel** (room fleet registers with NestJS), so delivery does not depend solely on Redis or the 10-min renew.
  - **Connect may fail *open* on Redis-down (availability), but sensitive actions fail *closed*.** The room re-checks ban state before any **economy, trade, chat, or cross-player-visible** action; if `ban_version` cannot be confirmed, those actions are refused (queued/soft-denied) while cosmetic/local play continues. "Instant ban" is thus honest: fan-out is immediate and durable; the only residual window is cosmetic actions by an unconfirmed session, bounded by the 15-min token.
- **Guest-upgrade hijack hardened** *(fixes device-token theft → permanent takeover)*: linking any identity to a guest account requires **step-up confirmation** (email/OTP challenge on the new identity) and emits a `security.identity_linked` alert to the account's notification channel. A stolen guest token alone cannot bind an attacker identity.
- **Sybil defense is a slice-1 prerequisite, not deferred** *(see Seam 4 and Risk 8)*: guests get **no chat and no embedding-generating interactions** until device attestation + per-account embedding caps are in place.

**Failure modes.** JWKS unreachable → in-process cache → Redis mirror → unknown `kid` triggers rate-limited refetch → **zero keys ⇒ fail closed**. NestJS down → existing sessions + valid-token connects survive; only new logins/refresh/guest-create fail. Redis down → connect fails open, **sensitive actions fail closed** (above). Signing-key compromise → short TTL + `kid` rotation + opaque refresh survives + global `ban_version` baseline bump.

---

### Seam 2 — Connection & Session

**Shape.** Zone assignment is NestJS *policy* (continuity → party → load/instancing → region); seat reservation is Colyseus *coordination*. One client round-trip: `POST /play` verifies the JWT, resolves the zone, mints the realtime ticket, calls `/internal/reserve` on any Colyseus node (service-auth HMAC), and returns `{endpoint, reservation{roomId, processId, publicAddress}, reconnectionToken, zoneId}`. The client opens WSS **directly to the owning pod** via `publicAddress` (StatefulSet per-pod addressing; no `@colyseus/proxy` SPOF). `onAuth` verifies the ticket (local JWKS) and `GETDEL`-burns `rtticket:{jti}`.

**Assignment priority:** explicit visit (`joinById`) → continuity (`home_zone_id`/`last_zone_id`) → party target → per-zone load policy (home farms are per-player-instanced, social hubs cap ~150 and shard only if flagged, else queue with `queueToken`) → region (home villages pinned; never live-migrate across regions).

**Reconnect:** `onLeave(consented=false)` → `allowReconnection(60s)`, seat held, entity frozen, presence→`grace`. Stale token (pod gone) → clean fall-through to `/play resume`, zone rebuilt from PG.

**Zone handoff saga** (`handoff:{pid}`, TTL 60s auto-rollback): **reserve dest → freeze+flush source → consume dest → release source**. Per-player affection is reloaded for the destination's NPCs, never shipped room-to-room.

**Critique resolved:**

- **Handoff read must hit the primary** *(fixes read-replica item-dupe)*: the destination's carried-state load during handoff reads the **Postgres primary**, or waits on a confirmed-replicated LSN/`stateVersion` token. Read-your-writes is **never** satisfied from an async replica. The `stateVersion` fence makes any late source write lose.
- **Double-presence fence, not pub/sub alone** *(fixes missed-evict split-brain)*: single-session take-over CAS-writes a **presence fence token** (same discipline as NPC fencing, Seam 5). The old room checks the fence **at the top of every tick** and self-fences on loss — it does not rely on receiving the `evict` pub/sub message. A second owner that missed evict discovers it holds a stale fence and stops before acting.
- **Inventory single-writer declared** *(see Risk 2 / Seam 6)*: while `presence=active`, the owning room is the **sole** inventory writer. NestJS trades/grants route *through* the owning room (or are refused if the player is mid-handoff). `/play` returns the owning `publicAddress` so WS always lands on the correct process regardless of which node served matchmaking.

**Failure modes.** Seat TTL expiry → idempotent `/play` retry. Owning-process crash → `reconnect` fails → `/play resume` → rebuild from PG; a driver janitor reaps ghost rooms vs process heartbeat. Zone split-brain → lease+fence (Seam 5) guarantees ≤1 authoritative instance. Region outage → "region offline," no silent cross-region fork (pending PG-topology decision).

---

### Seam 3 — Zone Room Simulation (the TCB)

**Two clocks.** `setSimulationInterval(onTick, 250ms)` = synchronous authoritative tick, budget ≤8ms, **never awaits the GPU**. `setPatchRate(100ms)` = Colyseus binary diff of synced schema. Cognition is a *third*, unbounded-latency concern pulled off both — it communicates with the tick only through the `cognitionInbox` mailbox. **A GPU stall can never stall the event loop.**

**State split.** Only `@colyseus/schema` classes hit the wire (SHARED-sim: `worldTick/time/weather`, `NpcPublic` 7 fields, `PlayerPublic`, `CropPlot`). NPC brains (mood, perception, pending decision, memory ring) are plain server-only objects. PER-PLAYER data (affection/opinion/quest) goes to the owning client only via `rel_delta` / per-client StateView — **Player B never receives Player A's relationship**.

**Interest management:** 16×16 tile spatial-grid StateView (bucket + 8 neighbors), minimal field set, target-based movement with client dead-reckoning. This is the lever for "hundreds per room."

**Intent pipeline = TCB** (drained at tick start in deterministic `(recvTick, sid, seq)` order): auth → legality → **enumerate-membership** → per-NPC single-writer reservation → execute (sim computes all economy/affection numbers) → side-effects (memory delta, ack). The enumeration function is shared with the NPC affordance path.

**NPC decision loop** (split across ticks): `perceive → enumerate → dispatch(cid, no await)` … later `drainInbox → staleness guard → threshold/abstain → re-validate legality NOW → execute → enqueue memory`. **Re-validate on apply** because the world moved between dispatch and result.

**Scheduling tiers** (LLM budget follows attention): Foreground (in-conversation) → System 1+2 every eligible tick; Near (in AoI) → System 1 every 2–8 ticks; Ambient (off-screen) → **scripted schedule only, no LLM**. Bounded `K` NPCs per tick; degrade Ambient first.

**Critique resolved:**
- **Zone lease/fence checked at the TOP of every tick, before draining intents** *(fixes event-loop-stall split-brain)*. On fence loss the room **actively nacks any ACKed-but-unflushed actions** and self-fences, rather than draining a stale queue and ACKing against a lease it no longer holds.
- **SHARED free-text memory is forbidden here too** — see Seam 5/6; dialogue summaries are PER-PLAYER only, never promoted to SHARED canon.

**Failure modes.** GPU saturated → semaphore `tryAcquire` fails → abstain to scripted; alert `abstain_rate >15%`. Late/stale result → `cid` staleness guard discards. Out-of-range index → bounds check → abstain. Tick overrun → reentrancy guard + shed `K`. Crash → rehydrate from snapshot + event tail (Seam 6).

---

### Seam 4 — Cognition Integration

**Shape.** Game code never opens a socket to a model. The room calls an in-process `CognitionClient` → **gRPC/HTTP2** (deadline-propagated, multiplexed) → the stateless, horizontally-scaled **Gateway** → models. The Gateway batches decisions from thousands of NPCs across many rooms into dense continuous batches, holds model credentials, runs the decision cache and the priority-lane micro-batcher. It returns **indices + calibrated probs (S1, no text)** or **typed candidate intents (S2)** — never state writes.

**`/v1/systemone`:** request = structured frame (`npc/clock/needs/mood/loc/sched/nearby[bounded]/rel/inv`) + question + `allowed_answers[]`; response = `{options:[{index,p}], abstain_p, argmax_index, seed, calibration_version}`. The model is constrained to the index tokens; the **threshold/accept policy lives in the room (TCB)**, not the Gateway — flip globally between probs-as-gates and probs-as-rankings via config.

**System 2 dialogue:** escalation gate (itself an S1 decision) → `generate` → Gateway does RAG + prompt + stream → `final.candidate_intents` are **UNTRUSTED** → the room re-validates every intent through the same pipeline as a player action. Raw text never writes state.

**Model routing** is a deterministic table (never model-chosen): routine/social/gate → Mica (80–120ms, local, same AZ); high-stakes arc beats + 2× abstain → JEV escalation (600ms, same typed contract); `generate` → System 2 (6s stream). **JEV/System 2 are never on the <100ms path.**

**Critique resolved — the headline fix:**
- **RAG scope enforcement is pulled INTO the TCB** *(fixes the cross-player memory-leak hole and the ownership contradiction)*. The Gateway **does not hold pgvector credentials and never accepts a caller-supplied `player_id`.** Two allowed patterns, in order of preference:
  1. **Room pre-fetches** PER-PLAYER memories via its DAL (`WHERE player_id = session.player_id`, scoped by the authenticated session) and passes them *in* the `DialogueRequest`. The Gateway only assembles and generates.
  2. If retrieval must be Gateway-side for caching, it reads **only through a NestJS/room-mediated API that injects the authenticated session `player_id` server-side**; the Gateway sends an opaque session handle, never a `player_id`.
  Either way, the `(player_id, npc_id)` scope filter is applied by code inside the trust boundary that already authenticated the session. A compromised or buggy Gateway can no longer cause an NPC to recite Player A's secrets to Player B.
- **Shared/SHARED memory promotion is blocked** — the Gateway may *read* SHARED memory but a System-2 dialogue summary is written back **only as PER-PLAYER**; promotion to SHARED canon is not a dialogue-driven path (Seam 5/6).
- **Sybil cost-DoS gated** *(see Risk 8)*: embedding generation and dialogue are entitlement-gated; per-account embedding caps enforced at the write path.

**Failure modes.** Mica slow → room deadline fires → scripted fallback; late result discarded by `tick_epoch`. Mica down → circuit-breaker fails fast `shed:true`. Calibration drift → `calibration_version` stamped, ECE shadow-eval, flip to rankings. Injected intents → re-validated/dropped. S2 outage → templated line via gate. Budget exhaustion → Redis token buckets short-circuit to templated.

---

### Seam 5 — Shared-NPC Coordination

**Granularity:** `zone = room = process`; shared NPC "travels" across a zone-room boundary. Within one room there is exactly **one writer** (the single event loop) — all intra-zone consistency is free. All distributed hazard is concentrated into two seams: **traveling-NPC handoff** and **cross-room reads**.

**Three scopes:** GLOBAL (canon, read-only at runtime, content pipeline writes) · SHARED-sim (one lease-holding room writes, keyed `(npc_id, village_instance_id)`) · PER-PLAYER (only actions attributable to that `player_id`; DAL hard-scopes every read/write).

**Single-writer discipline:** ownership = room owning the NPC's `current_zone_id`, enforced by **Redis lease (`SET NX PX 15000`) + monotonic fence token (`INCR`)**. Every SHARED write is `WHERE fence_token=:token AND version=:expected` — a paused owner that wakes cannot clobber the new owner (its token is behind). Autonomous ticking only when ≥1 player present; empty zones fast-forward deterministically from the schedule DSL (never the LLM).

**Co-presence (slice):** shared affection-neutral *body* (everyone sees the same walk cycle) + **private 1:1 dialogue** streamed only to the initiator; others see a "busy" indicator. One `conversation_slot` per NPC, others queue.

**Why cross-player poisoning is structurally impossible:** no raw text ever crosses a scope boundary into shared state; players write only their own PER-PLAYER rows; SHARED-sim moves only through the finite sim-authored transition set via typed intents; "gossip" is a *typed* `town_event_log`, never free text; and S1 only returns an index into a sim-authored enum, so a fully injected model can at most re-weight *sanctioned* options within the attacker's own session.

**Critique resolved:**
- **No SHARED free-text memory — reconciled with Seam 6** *(fixes the forbidden-vs-stored contradiction)*. `memory.npc_memory` with `scope=SHARED` stores only **typed, sim-validated facts** (derived from `town_event_log` events or content-pipeline authoring), never a raw System-2 dialogue summary. The `memory.summarize` path writes **PER-PLAYER only**. Promotion of any text to SHARED requires a deterministic, validated event — dialogue cannot poison canon for all players. This is the data-seam's binding rule.
- **RAG scope filter is in the TCB** (Seam 4) — this seam's "DAL physically incapable of cross-player reads" is the authoritative statement; the Gateway honors it.
- **Time authority** — this seam subscribes to the single clock authority (below), it does not run a competing ticker.

**Failure modes.** Split-brain owner → fence rejects stale writes. Owner crash pre-flush → ≤1 flush-interval of autonomous motion lost; bonds are write-through so nothing player-visible is lost. Handoff gap/dupe → version-gated spawn + single `NX` acquire. Redis down → fall back to static home-zone-owns-its-NPCs map + PG advisory lock for handoff; running villages keep full strong consistency. Thundering herd on a beloved NPC → conversation slot + queue + S1 fast path + abstain-to-scripted (honest product wound, bounded not eliminated; real fix is intimate shards).

---

### Seam 6 — Data & Persistence

**One truth:** PostgreSQL, with an append-only `log.event` as the *actual* truth and every other table a replayable projection. Redis is never truth. pgvector is a rebuildable recall index. Schemas enforce scope as a grant boundary: `global`, `sim`, `player`, `authz`, `log`, `memory` (cognition svc gets read-only `global`/`sim`, mediated-scoped `memory`, zero `authz`).

**Write path:** validate (TCB) → optional non-blocking decision → **one Postgres txn** { scalar mutations + `log.event` (struct + per-account-DEK-encrypted text + `seq` + `prev_hash`) + `log.oracle_call` + `log.outbox` } → ack → relay drains outbox to pub/sub + async embed worker. Economy/trade/cross-player events are **durable-before-ack**; cosmetic ticks batch write-behind.

**Recall is a union:** (a) recency/salience by btree — immediately consistent, serves "recalls yesterday's gift" with no embedding; (b) semantic ANN — eventually consistent. An embedding outage degrades only (b).

**Event log as truth / replay:** pure reducer `apply(state, event, oracleLookup) → state'`; seeded PRNG from `event.seed`, integer money, no wall-clock. **Replay reads logged oracle outputs (`log.oracle_call.chosen_idx`) — never re-runs inference** (Risk-6 logged-external-oracle; defeats GPU logit drift).

**GDPR:** crypto-shred (destroy per-account DEK → all encrypted personal payloads become noise everywhere incl. backups) + tombstone (preserve `seq`/hash-chain/replay). SHARED references de-identified ("a traveler"), not deleted. Hash chain is over structural fields, so shredding *content* preserves continuity.

**Critique resolved:**
- **SHARED-sim replayability is honest** *(fixes the rehydrate-gap claim)*: we pick one — **every SHARED-sim mutation is a logged event** (log = truth, snapshot+tail rehydrates exactly). Cosmetic batched writes to `sim.*` are a **non-authoritative projection**; on crash, rehydrate strictly from `snapshot + event tail`, and we do **not** claim unlogged `sim.*` writes are recoverable. We never claim both.
- **Event-log append is fenced** *(fixes chain fork / seq collision under failover)*: `seq` is sourced from a **fenced authority** — the owning room's `seq` is guarded by its zone fence token (Seam 5), and the `log.event` INSERT carries `WHERE fence_token=:token`; out-of-fence appends are rejected. A split-brain owner cannot fork the hash chain or collide the PK. Per-zone `seq` therefore survives handoff without gaps/dupes.
- **GLOBAL canon cache has an immediate invalidation path** *(fixes safety-hotfix lag)*: constitution/forbidden-lines are versioned; a `canon-version` bump **publishes an immediate invalidation on `ch:admin`** that live rooms honor at once (treated like the kill switch, not slow TTL content). No running room keeps an unsafe constitution until TTL expiry.
- **Inventory single-writer** *(see Risk 2)*: the owning room is the sole `player.inventory` writer while `presence=active`; NestJS writes route through the room; flush conflicts are an explicit reconcile, never last-writer-wins.

**Failure modes.** Embedding backlog → recency path covers gameplay. PG primary failure → rooms degrade to read-only (no economic actions, buffer), recover via WAL/PITR; durable-before-ack prevents double-spend. Redis loss → self-heals. ANN latency collapse → `ef_search`/iterative-scan/hash-partition, then migrate behind `MemoryStore` interface (Postgres stays truth; re-embed from `text_enc`).

---

### Seam 7 — Deployment / Infra / Observability

**Topology:** NestJS = `Deployment`+HPA (stateless, textbook). Colyseus = **`StatefulSet`** (per-pod routable WS address = free stickiness via the two-phase connect), autoscaled on **rooms/CCU, not CPU-average**, KEDA + matchmaking placement cap (~1 room/vCPU). Graceful drain mandatory (`preStop` → `acceptNewRooms=false` → snapshot → exit; large `terminationGracePeriod`; PDBs; **spot banned for room pods**). Deploys = **off-peak drain-and-replace**.

**GPU:** System 1 is on the <100ms path → **same AZ/region as rooms** (cross-region RTT blows budget — Risk 8). System 2 tolerates 100s of ms → hosted until economics force self-host vLLM (~1–2k CCU crossover, measured not dated). **Warm floor ≥1 Mica per region, never scale-to-zero** (cold weight-load = minutes = mass fallback). Predictive/scheduled pre-ramp ~30–45min ahead of the evening curve; KEDA bursts on top; the abstain→scripted ladder is the shock absorber. Overnight trough runs offline world-gen/compaction (fills idle GPU); follow-the-sun shares the S2 fleet (S1 cannot be shared).

**WS routing:** per-pod `wss://v-{ordinal}.villages.{region}.celestia.gg`, ingress host-based route, no `@colyseus/proxy` SPOF.

**Secrets/config:** External Secrets Operator; workload identity for DB/Redis; Colyseus holds JWKS verify-URL only (signing stays with NestJS/IdP); **model version is pinned config**, promoted via canary + shadow-eval (persona-regression + red-team + ECE) before traffic shift; kill switches / per-player token budgets / degradation ladder are live flags.

**Observability:** OTel traces client→NestJS→Colyseus→cognition; **intent envelope carries `traceparent`** (no WS headers); batched inference modeled with **span links** (1 batch span links N decision spans). Prometheus metrics low-cardinality (**no per-NPC/per-player labels** — those go to traces + Langfuse): `rooms_per_process, ccu_total, tick_duration_ms, abstain_rate, timeout_rate, fallback_rate, batch_queue_depth, gpu_tokens_total`. Langfuse = the logged-oracle store feeding replay + persona-regression + ECE drift. Cost dashboards render cost-per-NPC-day and cost-per-CCU-hour live; alert → auto-tighten budgets.

**Critique resolved:**
- **Client↔room schema versioning** *(missing piece)*: `@colyseus/schema` is binary and brittle against CDN/store-shipped Godot builds. We add a **version-gate handshake at `onAuth`** (`protocolVersion` in connect options; mismatch → force-update screen, no silent desync) and **reducer/event-payload schema versioning** (`event_type@version`) so replay of old events stays deterministic across code changes. No deploy may change schema wire-format without a version bump + migration.

**Failure modes.** Pod eviction → drain + reconnect + PG rehydrate. GPU spike → warm floor + pre-ramp + ladder. Redis outage → running villages survive (in-RAM authoritative); only new joins/matchmaking degrade. Hosted S2 outage → self-host failover + templated fallback.

---

### The Clock Authority (resolves the triple-specification)

Because three seams specified time incompatibly, this is the single authoritative model:

> **A clock authority (one ticker; a NestJS/Redis singleton per `village_instance`) emits `world_clock` events into the event log. Rooms apply those events deterministically in the reducer. The 250ms local tick only *interpolates* time-of-day for rendering and animation — it never advances canonical game-time on its own.**

This simultaneously satisfies: cross-room NPC handoff (all rooms see the same `world_clock` event, no skew-driven double-fire/drop — Seam 5 subscribes here), deterministic replay (time is event-sourced — Seam 6), and shared-world consistency. The old per-room `advanceClock(dt)` is downgraded to render interpolation only.

---

## 4. Trust & Safety Boundaries

**The client is not trusted.**
- Client sends **intents only** (indices/typed requests), never state. Every intent is re-validated in the room TCB: auth (session owns avatar) → legality → **enumerate-membership** (must be in the sim-authored legal set for current state) → reservation → execute. Economy/affection numbers are computed deterministically in the TCB, never accepted from the client.
- `onAuth` rejects any token not scoped `aud:celestia-realtime`; the realtime ticket is single-use (`GETDEL`). Rate limits + bounds checks reject floods on receipt. Anti-cheat is forensic audit over the event log (replay feeds *logged* outputs, never re-simulated inference).

**The LLM is not trusted (outside the TCB).**
- **Enumerate → index.** The sim authors a finite legal option set; the model returns an index. Out-of-range/hallucinated index → abstain. A fully prompt-injected model can at most re-weight *sanctioned* options.
- **Typed intents only.** System 2 text mutates state exclusively by emitting typed intents (`offer_quest(id)`, `give_item(id,qty)`) that **re-enter the same validation pipeline**. Raw text never writes state.
- **Low-confidence/timeout → abstain to scripted fallback.** Deterministic validators are the TCB; the degradation ladder always lands on determinism.
- **Scope filter is inside the TCB** (Seam 4 fix): the Gateway never receives a caller-supplied `player_id`; PER-PLAYER retrieval is scoped by the authenticated session inside the trust boundary. Per-player opinions are private by construction.
- **No dialogue-to-canon promotion.** System-2 summaries are PER-PLAYER only; SHARED canon changes only via validated typed events. Injection cannot poison the shared world.

---

## 5. Top Architecture Risks (ranked)

| # | Risk | Mitigation (as designed above) |
|---|---|---|
| 1 | **Time/clock authority** underpins handoff, replay, and shared consistency at once. | **Resolved:** single clock authority emits `world_clock` events; rooms apply deterministically; local tick interpolates for render only. |
| 2 | **Inventory/economy single-writer undefined** — dupe/loss in an economy game is catastrophic. | **Resolved:** owning room is sole `player.inventory`/ledger writer while `presence=active`; NestJS trades route through the room or are refused; flush conflicts reconcile explicitly; handoff reads **primary** (no replica dupe); economy events durable-before-ack. |
| 3 | **RAG scope enforcement outside the TCB** → cross-player memory leak breaks the core promise. | **Resolved:** Gateway holds no pgvector creds and never takes caller `player_id`; room pre-fetches scoped memories or reads via a session-authenticated mediator. |
| 4 | **Ban/revocation evasion** (Redis fail-open + fire-and-forget fan-out + 15-min tokens). | **Resolved:** durable Redis Stream + per-room reconcile on reconnect + authenticated NestJS→room push; sensitive actions **fail closed** even when connect fails open. |
| 5 | **Human-chat moderation + COPPA/minor safety absent** while guests can chat — grooming/CSAM/legal exposure. | **Mitigated + gated:** guest chat disabled until attestation; a **moderation plane** (report → queue → authorized-decrypt-with-audit → action) is a launch blocker; crypto-shred reconciled with moderation legal-hold (hold expires → shred wins after retention). COPPA posture is a Week-1 blocking spike (Open Decisions). |
| 6 | **SHARED free-text memory** could let injection poison canon for all players. | **Resolved:** SHARED memory is typed/validated only; dialogue summaries are PER-PLAYER; no dialogue→canon promotion path exists. |
| 7 | **Deploy/versioning gaps** — `@colyseus/schema` vs store-shipped clients; reducer/event-payload schema vs replay. | **Resolved:** `protocolVersion` gate at `onAuth` with forced-update; `event_type@version` schema versioning; no wire-format change without bump + migration; model bump = shadow-eval canary. |
| 8 | **Sybil guests** → cost-DoS on the embedding/GPU pipeline + seat-hold DoS on capped hubs. | **Mitigated:** attestation prerequisite before guest chat/embeddings; per-account embedding + total-guest-vector caps; guests barred from economy; capped-hub overflow → queue, home farms per-player-instanced. |
| 9 | **Thundering herd on a beloved NPC** (finite attention product wound). | **Bounded, not eliminated:** conversation slot + queue + S1 fast path + templated routine lines + abstain-to-scripted; real fix is intimate shards (Phase 2). |
| 10 | **Zone/room split-brain** on event-loop stall or lost lease. | **Resolved:** lease+fence checked at **top of every tick** before draining; ACKed-but-unflushed actions nacked on fence loss; PG rejects out-of-fence writes/seq. |

---

## 6. Open Decisions (team must still make)

1. **COPPA / minor posture (Week-1 blocking spike):** can a minor play as guest; age-gate at IdP or NestJS. Gates guest-chat policy, retention, and the whole T&S posture.
2. **Human-to-human chat subsystem:** full report/mute/block + authorized-decrypt-with-audit moderation plane, and its reconciliation with per-account-DEK crypto-shred (legal-hold vs erasure retention).
3. **Managed IdP** (Auth0 vs Cognito vs Clerk vs Keycloak) behind the swappable port — fixes JWKS/`onAuth` contract before Phase-2 social rollout.
4. **Device attestation vendor** (Play Integrity/App Attest + desktop equivalent) — prerequisite for real Sybil defense beyond rate-limits.
5. **PG topology (regional vs globally replicated truth)** — determines cross-region DR for home villages and whether a region outage is a hard lockout.
6. **Cross-player trade/gifting flow** (cross-session, cross-zone): owner, atomicity, and single-writer model — currently "outside this seam" and must be owned (likely a NestJS-escrow saga that routes execution through both owning rooms).
7. **Per-zone instancing & co-presence beyond the slice:** which villages shard; marriage/romance exclusivity (per-shard vs instanced "your-version") — decide **before authoring romance content**.
8. **Village sharding identity:** is a shared NPC one global canon or per-instance (recommend per-instance keyed by `village_instance_id`).
9. **System-1 accept predicate** if calibration proves weak: probs-as-gates vs probs-as-rankings (code path identical) — pins on the Week-1 calibration spike.
10. **Decision budget `K`, batch windows, degradation thresholds** — pin on the Week-4 one-GPU load microbench.
11. **Embedding model + dimension, run location, and the pgvector→dedicated-vector-DB migration threshold** (live vector count / filtered p99 / recall@k); re-embed story on model change vs shredded `text_enc`.
12. **Backup/PITR retention window** — the published compliance SLA covering backup residue (raw embeddings) that crypto-shred alone cannot reach.
13. **Realtime WS exposure** (per-pod StatefulSet vs proxy) and **managed vs self-operated** Postgres/Redis — confirm against the chosen cloud's WS/host-routing and pgvector/erasure tooling.
14. **Real-time anti-cheat/anti-abuse detectors** (bot patterns, economy exploitation, chat-spam heuristics) behind the current rate-limit + forensic-audit + "flag to moderation" scaffolding.
15. **Write-behind batch interval** and the exact synchronous-durable-before-ack event classification; **per-zone `seq` source** under failover (confirm fenced Redis `INCR` vs PG sequence).
