<!-- Generated 2026-10-06 by a multi-agent design pass: 6 layer facets -> integration/YAGNI critic -> synthesis. Versions as of 2026-10-06. -->

# Celestia — Authoritative Tech Stack

**Status:** DECIDED. This doc supersedes the six layer drafts where they disagree. Reconciled against PLANNING.md / ARCHITECTURE.md / AUTH.md / WEB3.md / WEB3-READINESS.md and the adversarial critique. Versions verified against npm/registry state as of 2026-10-06.

> ⚠️ **AMENDED by `REALTIME.md` (real-time MMO).** The cozy / low-tick / tap-to-move premise in this doc is superseded on these points — `REALTIME.md` is authoritative where they disagree:
> - **tick 2–10 Hz → 20 Hz** real-time, fixed timestep (per-zone configurable);
> - **tap-to-move → real-time directional** movement (virtual stick / WASD); intents are not "tap @ 2–10 Hz";
> - **StateView / per-client AoI: P1 → P0-core**;
> - "a couple hundred per room, single-thread, fine" → the **World > Zone > Sector (+ Channel / Instance)** model with a **load-tested per-channel cap**;
> - dialogue HTML `<input>` overlay "core P0" → **dev/tester-console only** (players get one-way NPC display, no free-text);
> - the client SDK autoload is **`Jupiter`** (not `CelestiaSDK`).

**Pinned baselines (one of each — no drift):**

| Thing | Pin | Note |
|---|---|---|
| Godot | **4.5.x**, exact patch, Compatibility (GLES3/WebGL2) | Client layer wins over the DevOps "4.4" typo. |
| Colyseus | **0.16.x** (`@colyseus/core`, `@colyseus/schema` 3.x) + **`colyseus.js` 0.16.x** | Server + client + schema MUST be the same line. (Node layer's "0.18" rejected — doesn't exist on this date.) |
| Node | **22 LTS** | DevOps wins over Node layer's "24". |
| TypeScript | **5.7** (stable, JS compiler) | TS 7.0 / `tsgo` rejected for ship-critical work — preview-grade decorator emit (critique). |
| Postgres / pgvector | **17.x** / **0.8.x** | — |
| Redis engine | **Valkey 8.x** (BSD) | One deliberate license call; vanilla commands only so Redis-8 swap is trivial. |

---

## 1. Overview + End-to-End Wire Map

Celestia is a thin-client, intents-only cozy MMO: a Godot WEB export (the flagship runtime, also the Telegram Mini App and iOS path) renders and interpolates; a single-threaded Colyseus room per village holds authoritative sim state and is the Trusted Compute Base (TCB); a NestJS meta backend owns accounts/auth/economy-at-rest; PostgreSQL is the append-only source of truth with pgvector for RAG; Redis/Valkey is ephemeral; and all model calls pass through one Cognition Gateway (never game code → model directly). The deliberate choice is **three serialization formats by hop** — binary `@colyseus/schema` on the hot state path, JSON everywhere human-facing, a frozen proto-typed *frame* for cognition — not one-format-everywhere, because the client edge needs browser-native reach while the state hop needs mobile-bandwidth deltas.

**Wire map** (protocol / serialization per hop; `[P0]` = exists in Phase 0, `[P1]`/`[P2]` = later):

```
                          BROWSER / TELEGRAM MINI APP WEBVIEW
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  Godot 4.5 WEB export (GDScript, Compatibility/WebGL2, single-threaded)   │
  │   ├─ ColyseusBridge (autoload) ─── JavaScriptBridge ──► colyseus.js 0.16  │
  │   ├─ TelegramBridge  (autoload) ─── JavaScriptBridge ──► telegram-web-app │
  │   └─ HTML <input> overlay for NPC dialogue text (not Godot LineEdit)      │
  └───────┬───────────────────────────────┬───────────────────────┬──────────┘
          │ WSS/TLS1.3                     │ WSS (same socket)      │ HTTPS/TLS1.3
          │ @colyseus/schema 3.x           │ JSON Colyseus msgs     │ JSON REST (OpenAPI 3.1)
          │ BINARY DELTA (state in)        │ IntentEnvelope{seq}    │ fetch(credentials:'include')
          │                                │ (intents out) +        │  for cookie auth; HTTPRequest
          │                                │ dialogue tokens (in)   │  for bearer   [P1 — no login P0]
          ▼                                ▼                        ▼
  ┌─────────────────────────────┐                      ┌──────────────────────────┐
  │ COLYSEUS zone-room (TCB)     │   HMAC-HTTPS/JSON     │ NestJS meta-api          │
  │ Node 22, single-thread/room │◄──/internal/reserve──►│ auth · accounts ·        │
  │ onAuth: jose JWKS verify +  │   [P1]                 │ matchmaking · economy ·  │
  │ GETDEL connect:<ticket>     │   Redis pub/sub +      │ moderation   [P1]        │
  │ imports @celestia/ledger,event,│◄─ durable Stream  ────►│                          │
  │ net-schema,auth-contract    │   (ban/revoke) [P1]    └─────────┬────────────────┘
  └──────┬─────────────────┬────┘                                  │
         │ in-proc call     │ localhost HTTP/JSON  [P0]             │
         │ (EconomyService) │ (proto-typed FRAME; gRPC @ P2)        │
         │                  ▼                                       │
         │        ┌───────────────────────────┐                    │
         │        │ Cognition Gateway (Node/TS)│                    │
         │        │ deadline→abstain, semaphore│                    │
         │        │ shed, GenerativeProvider   │                    │
         │        └───┬───────────────┬────────┘                    │
         │  HTTP/JSON │ (same AZ)      │ HTTPS + SSE stream          │
         │   /v1/systemone            │ (OpenAI/Anthropic-shaped)   │
         │            ▼               ▼                             │
         │   ┌─────────────────┐  ┌──────────────────┐             │
         │   │ llama.cpp server│  │ hosted Claude     │             │
         │   │ Mica-4B GGUF +  │  │ haiku-4-5/sonnet-5│             │
         │   │ nomic-embed     │  │ (vLLM self-host@P2│             │
         │   │ (--embeddings)  │  └──────────────────┘             │
         │   └─────────────────┘                                   │
         ▼                                                          ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ PostgreSQL 17 + pgvector 0.8   (SOURCE OF TRUTH)                           │
  │  log.event (append-only, seq+prev_hash, event_type@version, REVOKE U/D)   │
  │  log.oracle_call (HARD P0 — feeds deterministic replay)  log.outbox       │
  │  projections (ledger.balance NUMERIC(38,0), sim, memory.* vector(768))    │
  │  schemas+GRANT roles: global/sim/player/authz/log/memory                  │
  └──────────────────────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Valkey 8  (EPHEMERAL — never truth): presence · room registry · leases/   │
  │ fences · pub/sub · rate-limit · decision cache [P2]                        │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decided Stack — Per Layer

### 2a. Client (Godot)

| Concern | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Engine + renderer | Godot **4.5.x** pinned, **Compatibility (WebGL2)** | Only backend that runs in web export; a 2D cozy sim needs nothing Vulkan offers | Forward+/Mobile Vulkan (no web) | P0 |
| Language | **GDScript** | Smallest WASM + fast cold start on cellular; first-class `JavaScriptBridge` | C#/.NET (experimental WASM, heavy runtime kills Telegram cold-start) | P0, permanent for launch targets |
| 2D | **TileMapLayer** + Y-sort + **Camera2D** (smoothed) | All native, zero plugins, renders on Compatibility | Tiled import | P0; Tiled P2+ |
| UI | **Control nodes + Container layout + one Theme** on CanvasLayer | Handles mobile aspect ratios + Telegram viewport; large touch targets | bespoke immediate-mode UI | P0 |
| **Dialogue text input** | **HTML `<input>` overlay via JavaScriptBridge**, positioned over the canvas | Godot web in-canvas text/IME/virtual-keyboard is flaky; this is core (dialogue game), not a footnote | Godot `LineEdit` (unreliable on mobile web) | **P0** |
| Input | action-based **InputMap**, tap-to-move/interact primary + WASD/E fallback | Fits low-tick intents-only model; one action layer for touch+keyboard | virtual joystick | P0 |
| Build/export | Godot **headless CLI** in GitHub Actions, pinned templates, **single-threaded** web export, brotli at CDN | Single-threaded dodges COOP/COEP conflict with the 3rd-party telegram.org script | threaded export | P0; APK/desktop P1 |
| Assets | **Aseprite** sheets, OGG, native `.import` | Standard, reproducible | heavyweight pipeline | P0 |

### 2b. Transport

| Hop | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Client ↔ Colyseus state | **WSS + `@colyseus/schema` 3.x binary delta** | Compact mobile deltas; the lever for hundreds/room | JSON-over-WS (3–5× bytes) | P0 |
| Client ↔ Colyseus intents | **Plain Colyseus message, JSON `IntentEnvelope{seq,type,payload,traceparent}`** | Intents are tiny/low-freq (tap @ 2–10Hz); JSON suffices — **msgpack/notepack dropped** (critique: avoid a 3rd client-edge format in P0) | msgpack envelope | P0 |
| Wire-format safety | **`protocolVersion` handshake**, mismatch → forced-update | Binary schema is brittle vs CDN/store-cached builds (ARCH Risk 7) | unversioned | P0 (constant lives in net-schema; enforced at connect) |
| Client ↔ NestJS | **HTTPS REST + JSON**, OpenAPI 3.1 via `@nestjs/swagger`, `/v1` prefix | Browser-native, curl-debuggable, OpenAPI is the client-contract source | GraphQL/gRPC-web | P1 (no-login P0) |
| NestJS ↔ Colyseus `/internal/reserve` | **HMAC-signed HTTPS JSON**, one-shot | Reuses HTTP server; does NOT reuse client ticket (AUTH Seam-1) | gRPC | P1 |
| NestJS → room ban/revoke | **Redis pub/sub + durable Redis Stream** (reconcile on reconnect); gRPC server-stream push | Push eviction + durable catch-up | pub/sub only | pub/sub P1, gRPC P2 |
| Room ↔ Gateway | **Frozen proto-typed frame over localhost HTTP/JSON** → gRPC/ts-proto | Same local Node pair in P0 — gRPC/protoc/mTLS is pure overhead until multi-room batching loads the hop | gRPC from day 1 | **frame P0, gRPC transport P2** |
| Gateway ↔ Mica | **HTTP/1.1 + JSON**, same AZ | ~54ms inference dominates; transport is noise | gRPC | P0 |
| Gateway ↔ System 2 | **HTTPS + SSE stream** (OpenAI/Anthropic-shaped) | Token streaming; same shape for self-host vLLM | WS/gRPC stream | P0 |
| Dialogue tokens → client | **over the one WSS** (Colyseus messages) | Client never holds an SSE/gRPC stream — WebView stream-buffering can't reach the player | direct SSE to client | P1 (single-client P0) |
| TLS / ingress | TLS 1.3; terminate client WSS/HTTPS at L7 ingress; **per-pod StatefulSet host-routing, NO `@colyseus/proxy`**; mTLS internal | Proxy is a SPOF; two-phase connect gives stickiness; set LB idle > ping interval | `@colyseus/proxy` | client TLS P1, ingress/mTLS P2 (localhost P0) |

### 2c. Backend (Node)

| Concern | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Runtime / language | **Node 22 LTS + TypeScript 5.7**, SWC transpile for apps | Broad lib support (Nest 11, Colyseus 0.16); SWC emits DI/decorator metadata correctly | Node 24 + TS 7 (preview decorators) | P0 |
| Monorepo | **pnpm 10 workspaces + Turborepo 2.3** | Strict, cached, fits many small `@celestia/*` | Nx (heavier) | P0 |
| Lib build | **tsup 8.5** → ESM+CJS+`.d.ts` | Consumable by CJS Nest and ESM-leaning deps; correct `exports` map | project refs | P0 |
| Meta backend | **NestJS 11 on Fastify** | Matches stack; feature modules map 1:1 to ARCH components; **NO `@nestjs/cqrs`** (event-sourcing lives in log.event + reducer) | Express micro | **P1** |
| Validation | **Zod 4 + nestjs-zod 5** | One schema = runtime validator + inferred type, shareable in `@celestia/*` | class-validator (can't leave Nest) | P0 (lib), P1 (Nest pipe) |
| Realtime | **Colyseus 0.16.x**, `@colyseus/ws-transport`, **LocalPresence/LocalDriver** | Single process in P0; room imports ledger/event/net-schema/auth directly | always-Redis driver | P0 |
| JWT/crypto | **jose 6** (EdDSA/Ed25519 sign; `createRemoteJWKSet` offline verify), algs pinned `['EdDSA']` | Correct, dependency-light; lives in `@celestia/auth-contract` so issuer/verifier can't drift | jsonwebtoken | contract stub P0, issuer P1 |
| Discord OAuth / gating | **manual Auth-Code+PKCE via undici** + **discord.js 14 gateway bot as separate process/secret scope** | AUTH flow is bespoke; MUST-5 isolates bot token from signer | passport-discord | P1 |
| Config | **`@celestia/config` zod env loader** + Node `--env-file` | Fail-fast typed config | raw `process.env` | P0 |

**`@celestia/*` packages** (single source of truth, imported by room AND NestJS — never re-declared): `auth-contract` (frozen AUTH constants, `verifyJwt`, `hasEntitlement`), `ledger-contract` (the one `EconomyService`, `AssetId`, closed `ReasonCode`, `Minor=bigint`), `event-contract` (`log.event` types, `event_type@version` registry, pure `apply()` reducer), `net-schema` (`@colyseus/schema` classes + `protocolVersion`), `http-contract` (Zod REST shapes), `config`, `tsconfig`/`eslint`. **TS↔TS sharing is workspace imports — zero codegen.**

### 2d. Data

| Concern | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Postgres / pgvector | **PG 17.x + pgvector 0.8.x in-DB** | No separate vector DB to start; 0.8 iterative scans fix filtered-ANN recall | Qdrant/Pinecone | P0 |
| **Schema owner** | **SQL-first via `dbmate`** = SOLE owner (CREATE EXTENSION, ENUMs, GRANT roles, REVOKE U/D, hash-chain trigger, partitions) | ORM auto-migrators clobber REVOKE/GRANT/triggers — the exact landmine | drizzle-kit/Prisma migrate owning DDL | P0 |
| **Query layer** | **Kysely + kysely-codegen** (reads DB by introspection only, never diffs/migrates) | Typed raw-SQL-first builder that suits append-only writes + hand-written projections/ANN | Drizzle in strict introspect/pull mode | P0 |
| Event log | `log.event` + `log.oracle_call` + `log.outbox`; seq+prev_hash chain; `event_type@version`; U/D revoked | Enforced append-only, not aspirational | mutable state rows (L5) | P0 |
| Money | **NUMERIC(38,0) at rest / bigint in process / decimal string on wire** | 18-dec tokens overflow BIGINT | BIGINT | P0 |
| Vector index | **NONE (exact flat scan)** in P0; HNSW `vector_cosine_ops` at a named metric | Thousands of rows → exact scan is faster + perfect recall; recall path = recency/salience **btree** only in P0 | IVFFlat | HNSW later |
| Outbox drain | **`SELECT … FOR UPDATE SKIP LOCKED` + LISTEN/NOTIFY wake** | Transactional outbox, zero extra infra | Debezium/CDC | P0 |
| Pooling | **pg.Pool per process (max ~10)** | Few procs stay under max_connections; no middlebox | PgBouncer txn-mode (breaks LISTEN/NOTIFY + advisory locks) | pg.Pool P0, pooler at fleet scale |
| Redis | **Valkey 8 single node** + **ioredis 5** | BSD license, standard commands, matches Colyseus Redis drivers | Redis 8 (AGPL) / Cluster | P0 |
| Backup | Managed automated backup + **PITR, bounded 7–14d** | Covers primary-failure recovery; bounds crypto-shred residue | pgBackRest self-host | P0 |
| Local dev | docker-compose **`pgvector/pgvector:pg17` + `valkey/valkey:8`**, pinned, `TZ=UTC` | Reproduces prod shape; deterministic replay/ledger tests | Testcontainers-only | P0 |

### 2e. Cognition

| Concern | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Mica (System 1) serving | **llama.cpp `llama-server`**, Mica-4B **GGUF Q5_K_M**, **GBNF grammar** → index tokens + logprobs | One binary, single GPU, trivially meets ~54ms at 4 NPCs; grammar keeps the gateway tokenizer-free | vLLM ≥0.8 (continuous batching) | **P0** → vLLM at p99 queue-wait breach (P2) |
| Gateway language | **Node/TS**, thin service / in-process module | No model math in-process (I/O-bound batcher/router); imports `@celestia/*` with zero drift | Python/FastAPI (forks contracts out of TS monorepo) | P0 |
| Decision contract | **Frozen proto-typed frame** over localhost HTTP/JSON | Deadline carried as request field; gRPC/ts-proto deferred to P2 | gRPC day 1 | frame P0, gRPC P2 |
| Timeout path | **deadline → abstain + semaphore `tryAcquire` fail-fast (`shed:true`) + opossum breaker**; room `tick_epoch`/`cid` discards late results | Never queue unbounded; belt-and-suspenders staleness guard | retry/queue | P0 |
| Batcher / cache | **lane+abstain skeleton ONLY** | Micro-batcher + Redis decision cache are near-useless on single-decode llama.cpp at 4 NPCs | priority lanes + sha256 Redis cache | **skeleton P0, real batching + cache P2** |
| System 2 | **hosted Claude via `@anthropic-ai/sdk`** behind `GenerativeProvider`: `claude-haiku-4-5` routine / `claude-sonnet-5` high-stakes; prompt caching on persona prefix; streamed | Native prefix caching serves the cost mitigation; typed `candidate_intents` are UNTRUSTED → re-validated by TCB | OpenAI/Google SDK | P0; vLLM self-host (base_url swap) ~1–2k CCU (P2) |
| Embeddings | **nomic-embed-text-v1.5 (768-d, Matryoshka)** on the **same llama.cpp binary** (`--embeddings`) | One serving tech, no extra GPU/API cost; store `text_enc` to re-embed | hosted OpenAI / TEI | **model P1** (P0 recall is btree-only, no ANN) |
| JEV (System 1.5) | **DEFERRED** | P0 = Mica S1 + abstain→scripted ladder + hosted S2 | build now | P2 |

### 2f. DevOps

| Concern | PICK | Why | Alternative | When |
|---|---|---|---|---|
| Daily loop | **docker-compose.infra.yml** (pg+valkey+mica-mock+system2-mock) + app code on host via `turbo run dev` | Fastest hot-reload loop | everything-in-compose (kills hot-reload) | P0 |
| Mica on Mac | **mica-mock is DEFAULT**; real llama.cpp only via compose `gpu` profile on the NVIDIA box | Apple Silicon can't pass a GPU into Linux containers | CPU llama.cpp (too slow) | P0 |
| Migrations | **dbmate one-shot service** gating app start | Same in dev + CI | ORM migrate | P0 |
| TS tests | **Vitest 3** repo-wide + **`@colyseus/testing`** | Fast ESM/TS-native; official room harness | Jest | P0 |
| Godot tests | **GUT headless** in CI (`chickensoft-games/setup-godot`) | Named, headless, documented | GdUnit4 | P0 |
| Web E2E | **Playwright** — **boot/handoff/COOP-COEP smoke only** | Cannot see inside WebGL canvas; in-game logic = GUT + server integration | full E2E (infeasible) | P1 |
| Load | `@colyseus/loadtest` (P1); k6 for REST/auth (P2) | Speaks room protocol | — | later |
| Logging | **pino 9** JSON, trace_id-correlated | Structured, correlated | winston | P0 |
| Tracing | **OTel SDK + traceparent in intent envelope**, console/local-Jaeger exporter | `traceparent`-in-envelope is architectural (cheap now, costly to retrofit); full backend later | no tracing | thread P0, backend P2 |
| Metrics | **prom-client `/metrics`**, low-cardinality (no per-NPC/player labels) | Endpoints defined now | — | define P0, Prom/Grafana P2 |
| Oracle logging | **`log.oracle_call`** (inputs, logit vector, model+version, seed) | **HARD P0** — deterministic replay/ECE depend on it, uneconomical to retrofit | — | P0 |
| Eval | **Python `/ml` (uv 0.5 + 3.12)**: ECE/reliability notebook over `log.oracle_call` + prompt-injection red-team | Keeps Python out of the JS task graph | Langfuse-as-infra | P0 harness; Langfuse P2 |
| Prod secrets | External Secrets Operator + workload identity | No secrets in manifests | sealed-secrets | P2 |

---

## 3. The Four Must-Resolve Integration Decisions

### (a) Godot ↔ Colyseus — native + web

**PICK:** **`colyseus.js` 0.16.x driven from a GDScript `ColyseusBridge` autoload via `JavaScriptBridge`**, state decoded by **colyseus.js schema reflection** (no GDScript codegen). Bind `onAdd`/`onChange`/`onRemove` → GDScript signals so only **deltas** cross the bridge.

**Critique verdict incorporated — this WORKS in web production, with hard constraints:**
1. **`JavaScriptBridge` exists ONLY in the HTML5/WASM export.** Any Colyseus-touching code **cannot run from the editor Play button or a native debug build.** The "instant iteration" claim for GDScript is **false for the networked path.** → **Mitigation (mandatory):** put transport behind a GDScript `ITransport` interface with a **dev-only native JSON client over `WebSocketPeer`** that speaks a plaintext debug variant of the room protocol, so netcode is iterable in-editor. If that's too costly, **explicitly accept web-export-only netcode iteration** as a logged decision — it taxes the whole P0 loop either way.
2. **Two confirmed footguns:** `JavaScriptBridge.create_callback()` refs are **GC'd unless held in a GDScript var** (retain them in the autoload); and every `onChange`/`onAdd` is a JS→WASM marshaling hop — **bind deltas, never full-state-per-tick.**
3. **Native (Android/desktop) has NO working Colyseus client.** No maintained GDScript `@colyseus/schema`-v3 client exists; the old `colyseus-godot` is Godot-3/unmaintained; C# is correctly disqualified (web-export cost). → **Phase-1 Android plan = ship a TWA/WebView wrapper around the web export** (preserves the single client), **NOT** a native Godot build. Owning a `@colyseus/schema` binary decoder in lockstep with the server is the fallback, not the default. Gate any true native client behind a **cross-client golden-trace contract test**.

Schema reflection (no client codegen) is a genuine win over the C# client (which needs schema-codegen).

### (b) TS ↔ GDScript contract sharing

**PICK — three distinct seams, not one tool:**
- **Live Colyseus state:** `colyseus.js` **reflection** — zero GDScript codegen (JS client reconstructs schema from the handshake).
- **Constants** (`@celestia/auth-contract` WS close codes 4000/4010/4011/4012/4030/4031, intent `type` strings, `@celestia/ledger-contract` reason codes, **`protocolVersion`**): **tiny Node codegen** reading the TS source → committed **`celestia_contract.gd`**, enforced by **`git diff --exit-code`** in CI.
- **REST request/response shapes:** **hand-kept GDScript builders + a CI contract test** against the `@nestjs/swagger` OpenAPI doc. **No OpenAPI→GDScript DTO generator** (none mature — over-tooling).

**Inconsistency resolved (critique):** the "`git diff --exit-code` on *generated DTOs*" story was wrong. The codegen/diff gate **legitimately covers only `celestia_contract.gd` constants** (incl. the `protocolVersion` equality assertion TS==`.gd`). REST DTOs are hand-kept + contract-tested, not generated.

### (c) ORM / query layer for ledger + pgvector

**PICK:** **`dbmate` (SQL-first) = sole schema owner** + **Kysely + kysely-codegen = read-only typed query layer** (introspection; never migrates/diffs the DB).

**The big contradiction resolved:** the three drafts proposed Drizzle-kit migrations / dbmate-sole-owner-with-kysely-codegen / "Drizzle migrate one-shot" — mutually incompatible, and **dual DDL ownership is exactly the GRANT/REVOKE/trigger-clobbering landmine.** Critique verdict: *Drizzle-as-query-layer is fine; Drizzle-as-schema-owner is not.* We go one step cleaner — since `kysely-codegen` already implies Kysely and the query layer only ever **reads**, standardize on **Kysely** (raw `sql\`\`` anywhere, no unit-of-work, perfect for append-only writes + hand-written replay projections + pgvector `<=>` ANN). Event-sourcing needs hand-written DDL (REVOKE U/D, GRANT scope roles, `CREATE EXTENSION vector`, hash-chain trigger, partitioning) that no ORM auto-migrator should touch. **One owner (dbmate), one query layer (Kysely).** (Drizzle in strict introspect/pull mode is an acceptable substitute if the team already knows it — but never let drizzle-kit own DDL.)

### (d) Mica serving + gateway language

**PICK:** **llama.cpp `llama-server`** (Mica-4B GGUF Q5_K_M, GBNF grammar → index tokens + logprobs) on one GPU for Phase 0; **Node/TS gateway** (thin service or in-process module). The gateway runs **no model math** (I/O-bound batcher/router/credential-holder/stream-relay) so Node's one-stack + zero-contract-drift advantage dominates; Python's ML ecosystem is moot when models are out-of-process (and would fork `@celestia/*` out of the TS monorepo).

**Critique incorporated:** the Cognition draft's "gRPC in Phase-0-minimal" **contradicted** the Transport draft and is **over-tooling for a same-local-Node process pair** — **freeze the proto-typed decision frame, run it over localhost HTTP/JSON (or in-process) in P0, defer gRPC/ts-proto/protoc/mTLS to P2** when multi-room batching + span-links actually load the hop. **Calibration MUST be fit against the exact served GGUF quant and stamped `calibration_version` per `(model_file, quant)`;** the vLLM cutover is a model change → shadow-eval ECE before flipping. **Warm floor ≥1 Mica/region, never scale-to-zero.** A tiny Python grammar/token sidecar is the escape hatch (not P0) if gateway-side token math is ever needed.

---

## 4. True Phase-0 Minimal Stack

The smallest set to build the single-NPC slice end to end. Phase 0 is the **offline, no-login sandbox** (PLANNING): no NestJS, no auth, no AoI, no gRPC, no ANN.

- **Client:** Godot 4.5.x (one patch), GDScript, Compatibility/WebGL2, **single-threaded** web export. TileMapLayer + Y-sort + Camera2D(smoothed) + Control HUD w/ one Theme; tap-to-move InputMap + keyboard fallback. **NPC dialogue entry via HTML `<input>` overlay** through JavaScriptBridge.
- **Server:** **ONE local Colyseus 0.16.x process**, single room / single client, LocalPresence + LocalDriver + ws-transport. **No NestJS, no StateView/AoI, no auth** — connect via a **dev stub** (no Discord/JWT/ticket). Economy runs **in-process** as `@celestia/ledger-contract` `EconomyService`.
- **Transport:** `colyseus.js` (matched 0.16.x) via the `ColyseusBridge` autoload; `onAdd/onChange/onRemove` → GDScript signals (deltas only; **retain callback refs**). `protocolVersion` constant sent at connect. **Add the native JSON `WebSocketPeer` dev-client behind `ITransport`** so netcode is iterable in-editor (or log the web-only-iteration cost).
- **Data:** PostgreSQL 17 + pgvector 0.8 present. `log.event` (seq+prev_hash, event_type@version, U/D revoked), **`log.oracle_call` (HARD)**, `log.outbox`. Pure TS reducer `apply(state,event,oracleLookup)`; synchronous economy projection; NUMERIC(38,0)/bigint. **Recall = recency/salience btree only (NO ANN index, NO embedding model).**
- **Schema:** **dbmate** sole owner (CREATE EXTENSION, ENUMs, GRANT roles, REVOKE, hash-chain trigger) + **Kysely + kysely-codegen** read-only query layer.
- **Cognition:** llama.cpp llama-server (Mica-4B GGUF Q5_K_M, GBNF + logprobs) on the NVIDIA box; **mica-mock DEFAULT on the Mac laptop**. Hosted Claude (`claude-haiku-4-5`) behind `GenerativeProvider`, streamed. Gateway = thin Node service / in-process module over **localhost HTTP/JSON**; frozen proto-typed frame; **deadline→abstain + semaphore-shed skeleton only** (no gRPC, no Redis cache, no real batcher).
- **Coordination:** one local Valkey/Redis node only where needed; **outbox drain via plain `setInterval` poller** (not BullMQ).
- **Shared code:** pnpm 10 workspace + Turborepo; `@celestia/*` (ledger, event, net-schema w/ protocolVersion, **auth-contract STUB**, config-zod) imported by the room. Tiny Node codegen → committed `celestia_contract.gd` (constants only, diffed in CI). **TS 5.7, Node 22**, SWC transpile, CJS apps.
- **Dev/CI:** docker-compose infra (`pgvector/pgvector:pg17` + `valkey/valkey:8`) + app on host via turbo watch; `TZ=UTC`. GitHub Actions: lint/typecheck → Vitest + `@colyseus/testing` → GUT headless + web-export build smoke → **the ledger contract gate** (event_type@version snapshot + closed reason-code enum + replay-determinism). pino + console-OTel with `traceparent` threaded through the intent envelope and the cognition call. `/ml` uv harness: ECE over `log.oracle_call` + prompt-injection red-team against the typed-decision+validator boundary.

---

## 5. Safe to Defer (with trigger)

| Deferred | Phase | Trigger |
|---|---|---|
| NestJS meta backend (Fastify, feature modules, nestjs-zod pipe, swagger) | **P1** | Need accounts/multiplayer matchmaking |
| Full auth path (Discord OAuth, discord.js gateway bot, JWKS offline verify, connect-ticket, joinById({token,ticket}), refresh cookies, protocolVersion-at-onAuth) | **P1** | Leaving the no-login sandbox |
| StateView / 16×16 per-client AoI filtering | **P1** | More than one client per room |
| Embedding model (nomic) + outbox embed worker + **HNSW/ANN index** | **P1** | Semantic recall beyond "recalls yesterday's gift"; then index at a named live-vector-count / filtered-p99 / recall@k metric |
| BullMQ 6 (replace setInterval outbox) | **P1** | Retries/backoff + async-grant mailbox exist |
| Android/desktop | **P1** | Android = **TWA/WebView wrapper around web export**; OS-keychain refresh storage via GDExtension |
| gRPC/ts-proto room↔gateway + mTLS/protoc toolchain | **P2** | Multi-room batching + span-links actually load the hop |
| vLLM (Mica + self-host System 2) | **P2** | p99 S1 queue-wait breaches budget (Mica); ~1–2k CCU (S2, base_url swap). Re-fit calibration/ECE first |
| Redis decision cache + priority-lane micro-batcher + JEV tier | **P2** | Aggregate QPS on a batching engine |
| Colyseus Redis presence/driver, uWS transport, StatefulSet host-routing | **P2** | Multiple room processes / a room nears a core |
| Prometheus/Grafana/Tempo, Langfuse-as-infra, External Secrets/K8s, k6, Playwright, Turbo remote cache, Nx | **P2** | Scale ops; Playwright boot-smoke P1 |

---

## 6. Top Stack Risks (ranked) + Missing Glue

**Ranked risks:**

1. **Realtime client split (BIGGEST).** `colyseus.js`-via-JavaScriptBridge is **web-only** — no JS engine in native, no maintained GDScript schema-v3 client. *Mitigate:* P0 web-only single client, pinned 0.16.x server+client, `protocolVersion` gate + forced-update, **Android = TWA/WebView wrapper (not native Godot)** in P1, golden-trace contract test before any native client.
2. **Networked-path dev loop is web-export-only.** JavaScriptBridge doesn't exist in editor/native — netcode can't iterate from the Play button. *Mitigate:* `ITransport` interface + native JSON `WebSocketPeer` dev-client, or an explicit accepted-cost decision. **This taxes the whole P0 loop — decide now.**
3. **`@colyseus/schema` binary brittleness vs CDN/store-cached builds.** Any field change silently desyncs stale clients. *Mitigate:* no wire change without a `protocolVersion` bump + migration, enforced at connect.
4. **Dual DDL ownership.** An ORM auto-migrator alongside SQL migrations clobbers GRANT/REVOKE/triggers/partitions. *Mitigate:* dbmate is the **only** owner; Kysely only reads.
5. **COOP/COEP vs the Telegram 3rd-party script, + CSP/Trusted-Types vs JavaScriptBridge.** Cross-origin isolation (threads) conflicts with telegram.org; a strict CSP can break the bridge and the injected `telegram-web-app.js`. *Mitigate:* single-threaded export; **validate CSP + bridge + load budget in the REAL Telegram WebView early (P0 exit metric)** — not a localhost static host.
6. **JS↔WASM marshaling + GC'd callbacks.** *Mitigate:* bind deltas (never full-state/tick); retain `create_callback()` refs in a GDScript var.
7. **GGUF-quant logit drift / calibration coupling.** Q5_K_M shifts logits vs full precision; the vLLM cutover moves them again. *Mitigate:* fit calibration against the exact served quant, stamp `calibration_version` per `(model_file, quant)`, shadow-eval ECE before any engine swap.
8. **Telegram-WebView cookie persistence is genuinely uncertain** (storage partitioning / 3p-cookie blocking). *Mitigate:* treat **memory-only + re-auth-via-handoff as the DEFAULT**, not a fallback (P1 concern — P0 has no login).
9. **Three contract surfaces drift** (schema reflection / proto frame / OpenAPI). *Mitigate:* CI contract gates (AUTH MUST-13 pattern) fail at build, not runtime.
10. **Economy leakage onto the wire.** A stray amount/balance on an intent is a money-printer regression forcing a client redeploy. *Mitigate:* intents carry indices/typed args only; only a minimal holdings projection in schema, gated by protocolVersion.

**Missing glue the critique found (must be designed, not assumed):**

- **Server↔client clock/tick sync.** Target-based interpolation needs a clock-offset / server-tick handshake even at low tick — specify a ping/offset exchange in `ColyseusBridge`. **(P0.)**
- **Mobile-web dialogue text input.** The HTML `<input>` overlay (position/focus/blur/submit → intent, keyboard-safe-area) is **core P0 functionality** for a dialogue game — design it, don't footnote it. **(P0.)**
- **Room-TCB intent flood/backpressure.** `seq`-dedup is not throttling — add per-connection intent rate-limiting + beyond-seq dedup at the room (Redis rate-limit is infra-level only). **(P0 room concern.)**
- **Mica GGUF weight provisioning/versioning.** Pin + store the exact quantized artifact bound to `calibration_version` (object store + checksum + manifest) so the served quant is reproducible on the vLLM cutover. **(P0.)**
- **Exact CORS allowlist for `api.celestia.gg` credentialed fetch** (`Access-Control-Allow-Credentials: true` + specific `Origin`, never `*`; `app`↔`api` are same-site/cross-origin so SameSite=Strict is fine but CORS is still required) and the concrete `SameSite`/partition cookie behavior inside the Telegram WebView. **(P1 — document the design now.)**
- **Telegram-WebView backgrounding reconnection UX.** Tab suspension drops the WS often; `allowReconnection(60s)` + `reconnectionToken` is named, but the **silent re-auth-without-losing-session-state UX** is unspecified and core to a mobile launch. **(P1.)**
