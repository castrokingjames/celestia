<!-- Generated 2026-10-09 by a multi-agent design pass: 4 facets -> over-abstraction/feasibility critic -> synthesis. -->
<!-- Internal-SDK-first, game-first. Ports only where a credible second implementation exists. -->

# Celestia SDK Architecture

*Modular, swappable, SDK-shaped — game-first. Single committable spec; supersedes the per-seam notes in PLANNING/ARCHITECTURE/AUTH/WEB3/WEB3-READINESS/TECH-STACK where they disagree.*

---

## 1. Thesis

Celestia is built on **ports & adapters (hexagonal)**. A *port* is a stable interface; today's technology choice is one *adapter* behind it; a **composition root** wires which adapter is active. **A swap is a wiring change, not a call-site hunt.** This is the Web3-readiness "one `EconomyService` value chokepoint" lesson generalized to every technology seam.

Three disciplines govern everything below:

1. **Internal-SDK-first.** We are building swappable seams **for the team's own use**, shaped so they *could* be externalized later. We are **not** building a public plugin framework. A versioned public SDK before a shipped game violates the locked game-first / YAGNI stance. "Going public" (semver, public docs, compat guarantees, plugin discovery, examples) is a **clearly-marked DEFERRED hardening layer** (§6) — and dynamic plugin loading is an outright **anti-goal**, not a deferral (loading third-party code into the single-threaded room = untrusted code in the TCB).

2. **Ruthless YAGNI — the credible-second-implementation test.** A port is born the day a **concrete second adapter is funded**, not the day someone imagines it. Until then the seam is **prose in this catalogue, not an interface file**. Cataloguing a `none → future` seam as a port invites someone to write the interface in P0 and ossify the wrong shape — the exact WEB3-READINESS "reserved stub columns" (D3) anti-pattern.

3. **Where a swap is not feasible, we say so.** "Swap Colyseus" and "swap Postgres" are **fantasies** (§2.3). `ITransport` abstracts the *client connection only* and buys **zero** server-framework portability.

**Most seams here are already named in the docs** (EconomyService, GenerativeProvider, chain adapter, MemoryStore, IdP/entitlement sources, ITransport, Mica serving). This doc's job is to (a) rule which are *real ports now*, which are *deferred prose*, and which are *modules forever*; (b) add the few seams the planning docs missed; and (c) kill the naming drift that already exists inside our own notes.

**Headline verdict:** of ~30 candidate seams, **exactly three are ports you build in Phase 0** — `SystemOneProvider`, `GenerativeProvider`, `ITransport` — plus the two composition roots. Everything else is a module, a deferred prose seam, or a fantasy.

**Canonical-name ruling (drift kill):** the System-1 seam is named **`SystemOneProvider`** everywhere — not `DecisionProvider`, not `SystemOnePort`. One name + one shape live in `@celestia/cognition-contract`, imported by every consumer. A CI doc/codegen check asserts no module re-declares a catalogued port name. The SDK's own spec drifting on a port name is precisely the failure the SDK exists to prevent.

---

## 2. The Port Catalogue

### 2.1 Real ports (ranked by leverage = value-of-swap × cheapness-now)

| # | Port | Abstracts | Adapters today → next | Feasibility | Verdict | Introduced |
|---|---|---|---|---|---|---|
| 1 | **SystemOneProvider** | typed `/v1/systemone` decision oracle (index + calibrated probs, no text) | **mica-mock (laptop DEFAULT)** · llama.cpp GGUF → vLLM | **wire-easy, but a MODEL-VERSION boundary** | **PORT** | **P0** |
| 2 | **ITransport** (client, GDScript) | the client's room connection (connect / send intent / state deltas) | colyseus.js-bridge (web) · native-JSON dev-client · replay-mock | **easy** for dev/replay; **fantasy** for native-prod | **PORT** | **P0** |
| 3 | **GenerativeProvider** | streamed System-2 text + UNTRUSTED typed candidate_intents | system2-mock · hosted Claude → self-host vLLM | **HARD** (not a base_url swap) | **PORT** | **P0** |
| 4 | **AuthClient** (client, GDScript) | per-host login dance → "fresh access JWT + single-use connect ticket" | dev-stub (P0) → web · telegram | **easy** (host-selected) | **PORT** | **P1** (dev-stub only in P0) |
| 5 | **JwtSigningKeyProvider** (server) | custody of the EdDSA token-signing key + JWKS source | local dev keypair → cloud KMS/HSM | **easy** wire / **hard** ops | **PORT** | **P1** |
| 6 | **Colyseus Presence/Driver** | cross-process presence + room registry | Local* (P0) → Redis* | **easy** (framework-provided) | **PORT** | **P2** |
| 7 | **EntitlementSource** (resolver) | grant-row *producer* feeding `hasEntitlement` | discord-role → Stripe · Stars · wallet | easy-when-needed | **PORT, DEFERRED** | adapter #2 (P1+) |

Build-now is **#1–#3** (and #4's dev-stub). Their second adapter runs **every day** in P0 — mica-mock is the laptop default, the dev-client is the *only* way to iterate netcode in-editor under the web-only `JavaScriptBridge` constraint, and mock-vs-Claude both run daily. Maximum leverage, near-zero marginal cost. #5 is new (see §2.4); #6 is free when the sim goes multi-process; #7's **predicate + schema** are a P0 module bake-in while the *resolver port* waits for source #2.

### 2.2 Deferred prose seams — named, NOT interface files

These are documented so they aren't re-invented ad hoc, and so their forward-compatible *bake-ins* get built. **Writing their `.ts`/`.gd` interface in P0 is forbidden.** Each is born the day its second adapter is funded.

| Seam | Owns / blocks | P0 reality | Bake-in now |
|---|---|---|---|
| **EmbeddingProvider** (text→vector) | the `re-embed from stored text_enc` migration that makes any MemoryStore swap possible | none (btree recall) | **store raw `text_enc`** so re-embedding is possible later |
| **MemoryStore** (ANN recall index — *not* truth) | recall@k/p99 scaling | recency/salience btree in PG | PG stays truth; recall is a localized module call |
| **IdP / LoginProvider** (server) | Phase-2 social | Discord-primary | `account_id`-as-sole-principal + `idp_provider` enum |
| **ChainAdapter** (+ `SignerPort`, `AddressScreeningProvider`) | deposits/withdrawals/mint (build+broadcast, **never sign**) | `chain=none` null-object | `is_withdrawable=false` + account_id invariants (edge is additive) |
| **PaymentRail** | fiat → non-withdrawable GEM | none | — (two genuinely different rails = a real port *when monetization lands*) |
| **ComplianceGate** | KYC/AML/age/geo/OFAC at the money chokepoint | null-adapter → ALLOW | the single money chokepoint it will hang off |
| **ModerationProvider** (classifier only) | launch-blocker the day human chat ships | no chat in P0 | the moderation *plane* is a module; only the classifier is the future port |
| **AttestationProvider / PoH / AgeVerification** | P1 Sybil defense + withdrawal gate | rate-limit only | — |

`EmbeddingProvider` and `JwtSigningKeyProvider` are the two seams the server planning notes **dropped** — `EmbeddingProvider` got silently folded into `MemoryStore` even though recall takes a *pre-computed* embedding, leaving the producer unspecified. It is restored here as a deferred prose seam that **owns the re-embed migration**.

### 2.3 Fantasy swaps — claimed-swappable, actually load-bearing

- **"Swap Colyseus."** FANTASY. The TCB, single-thread room, `@colyseus/schema` sync, driver/presence, `@colyseus/testing`, StateView, reconnect, zone-handoff, and the **fenced-seq `WHERE fence_token=:token` append** are all bound to it. `ITransport` abstracts the *client* side only.
- **"Swap Postgres."** FANTASY. Event-log-as-truth, pgvector, hash-chain trigger, LISTEN/NOTIFY outbox, advisory locks, fenced seq, GRANT-role scoping, dbmate-owned DDL — all load-bearing. An `IDatabase` port is a lowest-common-denominator trap. **Postgres is not swappable; say so.**
- **Native-production Colyseus client via `ITransport`.** FANTASY *adapter*. No maintained GDScript `@colyseus/schema`-v3 decoder exists; Android/iOS ship as **TWA/WebView wrappers around the web export**. The native-JSON dev-client is **DEV-ONLY**; its plaintext debug variant can silently drift from the binary schema path (false green in-editor) — hence the mandatory cross-client golden-trace gate (§5). Downstream fantasies that die with it: `KeychainSessionStore` and desktop/mobile auth adapters (they all presuppose a native build that is **not the plan**).
- **"Swap the economy" / a second `EconomyService` adapter.** FANTASY *and anti-pattern* — the "second implementation" **is** landmine L6 (two divergent ledgers). See §3.4.
- **`LedgerStore` as a production tech swap.** FANTASY (and dropped — see §3.4). An in-memory ledger cannot reproduce the hash-chain trigger, the fenced append, or the Seam-6 durable-before-ack transaction, so a green suite against it gives **false confidence** about the one thing that matters.
- **"Swap Godot / NestJS."** Rewrites, not config. Not ports.

### 2.4 Correcting two oversold swaps (from the critique)

- **`SystemOneProvider` is a model-version boundary, not a free flip.** Q5_K_M logits ≠ vLLM logits. A serving swap without re-fitting `calibration_version` per `(model_file, quant)` + shadow-eval ships miscalibrated NPCs and silently drifts replay/threshold behavior. **Treat every serving swap as a model deploy.** The *wire* is easy; the *flip* is gated.
- **`GenerativeProvider` → vLLM is HARD, everywhere.** Anthropic Messages API ≠ OpenAI/vLLM chat schema (roles, tool/stop, SSE event shapes); prompt-cache semantics differ; the UNTRUSTED `candidate_intents` extraction is provider-specific. Budget a real adapter + persona-regression + ECE shadow-eval, **not a URL change.** (This resolves the facet contradiction: the notes said HARD in one place and "base_url swap" in two others — HARD wins.)

---

## 3. Server SDK

### 3.1 Package layout — three kinds of package + a composition root

Strictly acyclic (`apps → composition → {core, adapters-*} → ports → leaf-contracts`), so Turborepo build order is clean and `cognition-svc` can be **denied the ledger package at the package level** (mirrors the Seam-6 grant boundary).

```
CONTRACTS  (frozen; shared by room + Nest + gateway; anti-DRIFT, not anti-swap)
  @celestia/event-contract      log.event types, event_type@version registry, PURE apply() reducer   [leaf]
  @celestia/cognition-contract  the frozen proto FRAME: DecisionFrame, Decision{Req,Res}, Dialogue{Req,Res},
                             and the SystemOneProvider / GenerativeProvider interfaces              [leaf]
  @celestia/auth-contract       verifyJwt, hasEntitlement predicate + grant-row schema, CHANNELS,
                             WS close codes, EdDSA pin, claim/ent shapes, join/auth-options shape
  @celestia/ledger-contract     Minor=bigint, AssetId, closed ReasonCode, Receipt, EconomyService (iface + the ONE impl)
  @celestia/net-schema          @colyseus/schema classes + protocolVersion (incl. schema structural hash)
  @celestia/http-contract       Zod REST shapes (OpenAPI source of truth)
PORTS  (swappable TECHNOLOGY seams only; interfaces + their DTOs; zero runtime deps)
  @celestia/ports               SystemOneProvider*, GenerativeProvider*, JwtSigningKeyProvider,
                             EntitlementSource(DEFERRED)      (*re-exported from cognition-contract)
ADAPTERS  (one dir per port; one class per adapter; the only code touching a vendor SDK)
  @celestia/adapters-systemone   mica-mock | mica-llamacpp | mica-vllm
  @celestia/adapters-generative  s2-mock | claude-hosted | vllm-openai
  @celestia/adapters-signing     jwt-local-keypair | jwt-kms
CORE  (framework-free domain; consumes ports; never imports an adapter or framework)
  @celestia/core                 cognition routing table + S1 threshold/accept policy (TCB-side),
                              memory recall-union (plain module), sim enumeration/validation
COMPOSITION ROOT
  @celestia/config               zod env loader → typed CelestiaConfig (discriminated unions per seam)
  @celestia/composition          buildServerContainer(cfg) + CelestiaModule.forRoot(Nest) + wireColyseus(room)
APPS (3 processes; each builds its OWN container from the SAME config+code)
  apps/meta-nest   apps/zone-colyseus   apps/cognition-gateway
```

**What is NOT in `@celestia/ports`** (the critique's demotions): no `LedgerStore`, no `CognitionClient`, no generic `IDatabase`/`IEventBus`. `EconomyService` sits on a **plain Kysely repo** in `@celestia/ledger-contract`; the room→gateway hop is a **module behind the frozen frame**, not a wired adapter set.

### 3.2 The one composition root (framework-neutral)

Adapter selection happens in **exactly one function**. NestJS DI and Colyseus rooms are two *bindings* over the same container instance.

```ts
// @celestia/config — the ONLY swap surface. Discriminated unions == the swap knob. zod FAIL-FAST at boot.
export interface CelestiaConfig {
  role: 'nest' | 'zone' | 'gateway';
  systemOne:  { driver: 'mock' } | { driver: 'llamacpp'; baseUrl: string; model: string; grammarPath: string }
            | { driver: 'vllm'; baseUrl: string; model: string };
  generative: { driver: 'mock' } | { driver: 'claude'; model: string } | { driver: 'vllm'; baseUrl: string; model: string };
  signing:    { driver: 'local' } | { driver: 'kms'; keyArn: string };     // P1
  db: { url: string; poolMax: number };
}
```

```ts
// @celestia/composition — the single place a driver string becomes a class.
export interface CelestiaContainer {
  config: CelestiaConfig;
  economy: EconomyService;          // the chokepoint — a plain MODULE over a Kysely repo, NOT a port
  systemOne?: SystemOneProvider;    // materialized only where the model actually lives (gateway/in-proc)
  generative?: GenerativeProvider;
  signing?: JwtSigningKeyProvider;  // nest role only
  dispose(): Promise<void>;
}

export function buildServerContainer(cfg: CelestiaConfig): CelestiaContainer {
  const db       = makeKysely(cfg.db);                             // ONE query layer (read + append); dbmate owns DDL
  const economy  = new StandardEconomyService(new LedgerRepo(db)); // chokepoint over a plain repo — see §3.4
  const local    = cfg.role === 'gateway';
  const systemOne  = local ? makeSystemOne(cfg.systemOne)     : undefined;
  const generative = local ? makeGenerative(cfg.generative)  : undefined;
  const signing    = cfg.role === 'nest' ? makeSigning(cfg.signing) : undefined;
  return { config: cfg, economy, systemOne, generative, signing, async dispose() { await db.destroy(); } };
}

function makeSystemOne(c: CelestiaConfig['systemOne']): SystemOneProvider {   // the ONLY driver→class switch for S1
  switch (c.driver) {
    case 'mock':     return new MicaMockProvider();                        // laptop DEFAULT
    case 'llamacpp': return new MicaLlamacppProvider(c);                   // compose `gpu` profile
    case 'vllm':     return new MicaVllmProvider(c);                       // P2 — model deploy, re-fit calibration
  }
}
```

**Binding A — NestJS** (interfaces vanish at runtime → inject by Symbol token, centralized in one file; a typo fails at runtime, so a boot-time resolution smoke test is mandatory):

```ts
@Global() @Module({})
export class CelestiaModule {
  static forRoot(cfg: CelestiaConfig): DynamicModule {
    const c = buildServerContainer(cfg);
    const providers = [
      { provide: TOKENS.EconomyService, useValue: c.economy },
      ...(c.signing ? [{ provide: TOKENS.JwtSigningKeyProvider, useValue: c.signing }] : []),
    ];
    return { module: CelestiaModule, providers, exports: providers.map(p => p.provide) };
  }
}
```

**Binding B — Colyseus rooms** (no DI; the key sub-problem). The container is a **server-boot process singleton** — never sourced from client join options (that would be infra injected over a client-controlled channel = attack surface):

```ts
// @celestia/composition/colyseus.ts
let CONTAINER: CelestiaContainer | undefined;
export function wireColyseus(server: Server, c: CelestiaContainer) { CONTAINER = c; server.define('village', VillageRoom); }
export function roomContainer(): CelestiaContainer {
  if (!CONTAINER) throw new Error('wireColyseus() not called');   // fail-fast at boot, not mid-tick
  return CONTAINER;
}
// VillageRoom reads roomContainer() in onCreate; tests do wireColyseus(testServer, buildServerContainer(TEST_CFG)) in beforeEach.
```

Only `@celestia/composition` ever touches the container (no service-locator smell): `@celestia/core` and the room take ports by constructor/field, so the swap surface stays at the root and never metastasizes into call sites.

**Config-drift guard (3 processes build 3 containers):** one `@celestia/config` loader, one config/image source, log `{role, driver, engineId, calibration_version}` at boot, and a CI assertion that all three processes resolve **identical driver ids for shared seams**.

### 3.3 Top server port sketches (minimal surface)

```ts
// @celestia/cognition-contract — the room NEVER calls a model directly (ARCH Seam 4). Canonical names.
export interface SystemOneProvider {                       // adapters: mica-mock | mica-llamacpp | mica-vllm
  readonly engineId: string;                               // 'llamacpp:mica-4b-q5km' → stamped into log.oracle_call
  decide(req: {
    frame: DecisionFrame;              // frozen proto frame (npc/clock/needs/mood/loc/nearby/rel/inv)
    question: string;
    allowedAnswers: string[];          // sim-authored enum — model returns an INDEX only
    deadlineMs: number;                // carried as a FIELD (P0 HTTP/JSON), not a transport deadline
  }, signal: AbortSignal): Promise<{
    options: { index: number; p: number }[];
    argmaxIndex: number; abstainP: number;
    seed: number;                      // LOGGED → replay reads this, NEVER re-infers
    calibrationVersion: string;        // per (model_file, quant) — the swap is a MODEL-VERSION boundary
  }>;
  health(): Promise<{ ready: boolean; warm: boolean }>;
}
// Threshold/accept + deadline→abstain policy stays in the room-TCB (@celestia/core), NOT in the provider.

export interface GenerativeProvider {                      // adapters: s2-mock | claude-hosted | vllm-openai
  readonly engineId: string;                               // 'anthropic:claude-haiku-4-5'
  generate(req: {
    personaPrefix: string;             // cache-friendly prefix (Anthropic prompt caching)
    scopedMemories: MemoryHit[];       // PRE-FETCHED by the room-TCB — provider holds NO pgvector creds, gets NO player_id
    allowedIntentSchema: JsonSchema;   // typed candidate_intents the model may emit (UNTRUSTED)
    maxTokens: number;
  }, signal: AbortSignal): AsyncIterable<GenChunk>;        // {kind:'token',text} | {kind:'final', candidateIntents, usage}
}                                                          // candidateIntents RE-VALIDATED by the room-TCB

export interface JwtSigningKeyProvider {                   // NEW — adapters: jwt-local-keypair | jwt-kms
  readonly kid: string;                                    // key id surfaced in JWKS + JWT header
  sign(payload: Uint8Array): Promise<Uint8Array>;          // EdDSA/Ed25519; private key NEVER leaves the adapter
  publicJwks(): Promise<Jwks>;                             // served at /.well-known/jwks.json
}
```

### 3.4 Why `EconomyService` is a module and `LedgerStore` was dropped

`EconomyService` (`@celestia/ledger-contract`) is the **one value chokepoint**, imported — never reimplemented — by both the room-TCB and NestJS. Hexagonally it is a **single-implementation module**: the only "second adapter" (room keeps its own ledger, NestJS keeps its own) is landmine **L6**. Its forward-compatibility comes from **additive methods** (`hold/capture/release`, `purchase`, `convert`, `payout`, `mint`) and **new `economy.posted@N` reducer versions** over an append-only stream — not an adapter swap. It is the **host** of the deferred money-edge seams (`ComplianceGate`, `ChainAdapter`+`SignerPort`, `PaymentRail`), not a port itself.

**`LedgerStore` is dropped** (critique): its only non-prod adapter was an in-memory fake, and the **pure versioned `apply()` reducer already gives DB-free deterministic testing**. The port duplicated that while implying a production swap that doesn't exist — and worse, a green suite against an in-memory ledger gives *false confidence* because it can't reproduce the hash-chain trigger, the fenced `WHERE fence_token=:token` append, or the Seam-6 durable-before-ack transaction. So:
- `EconomyService` sits on a **plain `LedgerRepo` (Kysely)** — not a port.
- DB-free coverage comes from the **pure reducer** (replay-determinism: `economy.posted@1` events → identical balances, reading logged `chosen_idx`, never re-running inference).
- Persistence invariants (hash-chain, fenced seq, durable-before-ack) are tested against a **real Postgres testcontainer**.

### 3.5 Server seams that stay modules

| Seam | Why module |
|---|---|
| **Room→gateway cognition transport** | The contract is the **frozen proto frame**, not the transport. In-proc (P0) → localhost HTTP (P1) → gRPC (P2) swaps *behind a stable in-process `CognitionClient` call* with **no port and no second adapter today**. (Resolves the facet-2 over-build: it is a module, not `adapters-cognition{in_process|http|grpc}`.) |
| **Server↔server internal auth** (NestJS → Colyseus `/internal/reserve`) | NEW — a trust-critical seam the notes missed. HMAC-signed shared secret (P0) → mTLS/service-mesh identity (scale). A **module behind the frozen `/internal/*` contract** — named so it isn't re-invented ad hoc, not a port until the second mechanism is funded. |
| **apply() reducer** | Pure, integer-only, seeded, wall-clock-free; versioned by `event_type@version` (old versions kept forever). It *defines* replay — an adapter could sneak in non-determinism. |
| **Kysely DAL / Postgres** | dbmate is sole DDL owner; a swappable ORM owning schema **is** the dual-DDL / GRANT-clobber landmine. Only the DOMAIN seams (none, now that LedgerStore is dropped) are ever ports — never a generic data layer. |
| **Memory recall-union** | One btree implementation in P0; the ANN half becomes `MemoryStore` only when latency forces it. |
| **verifyJwt / hasEntitlement predicate / grant-row schema** | One verifier + one text-slug OR-semantics predicate shared by both runtimes. A "pluggable verifier/check" reopens MUST-3 alg drift and the L15 constraint-migration landmine. The *sources* vary (`EntitlementSource`); the predicate must not. |
| **Clock authority, TCB intent-validation + enumerate pipeline, S1 accept policy, model-routing table, outbox relay, config loader, telemetry (OTel is already the neutral port)** | Single safety-critical implementations; `probs-as-gates` vs `probs-as-rankings` is a **config flag on the same code path**, not an adapter. |
| **Trade/gift escrow saga owner** | NEW placement note — not a port, but an **unowned coordination seam**. ARCH's "likely a NestJS escrow saga routing through both owning rooms" has no home in the package layout. Place it in `apps/meta-nest` **as a caller of the `EconomyService` chokepoint** (never a second value-writer); its N9 cross-zone-transfer scope is a P0 bake-in decision per WEB3-READINESS. |

---

## 4. Client SDK — the Godot `celestia-sdk` addon

The thinnest facet. The client is untrusted and sends intents only, so almost nothing on it is "logic worth abstracting." The ports earn their place for exactly one reason: **`JavaScriptBridge` exists only in the HTML5/WASM web export.** The production transport, the Discord dance, and (later) the wallet SDK are web-only JS reaches that **cannot run from the editor Play button or a native debug build.** So the real swap axis is *host/runtime* plus the one axis the docs name (`ITransport`).

### 4.1 Addon shape (ports kept minimal per the critique)

```
res://addons/celestia_sdk/
  celestia_sdk.gd            # AUTOLOAD = composition root (the ONLY place an adapter class is named)
  celestia_config.gd         # committed config Resource (host override, endpoints, flags)
  gen/celestia_contract.gd   # GENERATED from TS, git-diff-gated — constants ONLY
  ports/
    i_transport.gd        # PORT  (bridge | native-json-dev | replay)   [named in docs]
    auth_client.gd        # PORT  (dev-stub | web | telegram — THREE adapters, not five)
  modules/
    entity_view.gd        # MODULE (read-only state facade)
    intent_sender.gd      # MODULE (the one intent chokepoint)
    dialogue_client.gd    # MODULE (S2 stream core; owns a text-entry STRATEGY field)
    session.gd            # MODULE (memory-only token custody — see §4.4)
  adapters/
    transport/{colyseus_bridge,native_json_dev,replay}_transport.gd
    auth/{dev_stub,web,telegram}_auth.gd
```

GDScript has no `interface` keyword, so a port is a base `RefCounted` whose methods `assert(false)` until overridden; adapters `extends` it. Game code only ever touches references hung off the `CelestiaSDK` autoload — never a concrete adapter, never `OS.has_feature()`.

**Demotions from the critique:**
- **`SessionStore` → plain module.** In the shipping topology (web + Telegram Mini App + Android/iOS as TWA/WebView) there is exactly **one** adapter: memory-only. `KeychainSessionStore` presupposes a native Godot build that is **not the plan**. One real adapter = module. Promote to a port the day a native client is funded.
- **`AuthClient` → 3 adapters, not 5.** Desktop-loopback and mobile-App-Link assume a native build; desktop/mobile ship as TWA/WebView = the web host, reusing `WebAuthAdapter`. Real set: **`dev-stub | web | telegram`**. The port is still justified (the web-only JS-reach axis differs per host), but build 3.
- **`ITextEntry` → strategy field, not a catalogued port.** HTML-overlay-vs-LineEdit is a two-branch strategy owned by `DialogueClient` on the same web-only axis as `ITransport`. A field inside `DialogueClient` is enough; a catalogued port is ceremony for a dev-only fallback.
- **`WalletClient`** stays a **deferred prose seam** (§2.2) — no adapter ships in P0/P1-login; the client only ever proves ownership of the *user's own* wallet via a server-issued single-use domain-bound nonce, never holds Celestia custody, and is never an auth principal.

### 4.2 Composition root

```gdscript
# celestia_sdk.gd  (Project Settings → Autoload → "CelestiaSDK")
extends Node
var transport: ITransport
var auth: AuthClient
var entities: EntityView
var intents: IntentSender
var dialogue: DialogueClient
var _held_cbs: Array = []                      # RETAIN JavaScriptBridge.create_callback() refs or they GC (silent drops)

func _ready() -> void:
    var cfg := CelestiaConfig.load()
    match _detect_host(cfg):                   # host_override → export feature tags → editor detection
        &"editor_dev":                         # Play button / native debug: NO JavaScriptBridge
            transport = NativeJsonDevTransport.new()       # plaintext debug variant over WebSocketPeer
            auth      = DevStubAuth.new()                  # P0: no NestJS/auth
            dialogue  = DialogueClient.new(transport, intents, GodotLineEditInput.new())
        &"replay_test":
            transport = ReplayTransport.new()              # GUT headless, canned golden-trace frames
            auth      = DevStubAuth.new()
        &"web", &"telegram":
            transport = ColyseusBridgeTransport.new(_held_cbs)      # colyseus.js over JavaScriptBridge [flagship]
            auth      = (TelegramAuthAdapter if _host == &"telegram" else WebAuthAdapter).new(cfg)
            dialogue  = DialogueClient.new(transport, intents, HtmlOverlayInput.new(_held_cbs))
    entities = EntityView.new(transport)       # modules depend on the PORT, not an adapter
    intents  = IntentSender.new(transport)
    transport.closed.connect(_on_closed)       # map protocolVersion/revoke close codes → forced-update / UI
```

The only files that know a concrete adapter class name are `celestia_sdk.gd` and the adapter itself.

### 4.3 `ITransport` (the one client port the docs name)

```gdscript
class_name ITransport extends RefCounted
# State: bind DELTAS only — full-state-per-tick across the JS→WASM boundary kills perf.
signal entity_added(coll: String, id: String, snap: Dictionary)
signal entity_changed(coll: String, id: String, changes: Dictionary)
signal entity_removed(coll: String, id: String)
signal message(type: String, payload: Dictionary)                 # dialogue tokens, acks — all ride the ONE WSS
signal opened(server_tick: int, clock_offset_ms: int)             # clock handshake: interpolation needs this
signal closed(code: int, reason: String)                          # 4000/4010/4011/4012/4030/4031 + protocolVersion-mismatch
func connect_room(opts: Dictionary) -> void: _abstract()          # {endpoint, room_id, protocol_version, auth:{token,ticket}}
func send(type: String, payload: Dictionary) -> void: _abstract()
func close() -> void: _abstract()
func _abstract() -> void: assert(false, "ITransport is abstract")
```

`ColyseusBridgeTransport` sends `CelestiaContract.PROTOCOL_VERSION` in join options and `{token, ticket}` in **auth options, never the `wss://` URL** (MUST-9), binds `onAdd/onChange/onRemove` to the signals, and holds every `create_callback()` ref in `_held_cbs`. `opened(server_tick, clock_offset_ms)` is mandatory: dead-reckoning interpolation is wrong without it, and the local 250 ms tick only interpolates render time, never advances canonical game-time (ARCH Clock Authority).

### 4.4 Client modules (not ports)

- **`EntityView`** — read-only facade fed by whichever transport is live (the swap already happened at `ITransport`; no maintained GDScript schema-v3 decoder = no second impl). Enforces the economy-leakage firewall: exposes **only** a minimal holdings projection as **decimal strings**, protocolVersion-gated.
- **`IntentSender`** — the single client intent chokepoint (mirror of the server's one `EconomyService`). Forms `IntentEnvelope{seq,type,payload,traceparent}` and **structurally refuses any money/amount/price field** (L3 money-printer firewall — a stray amount on the wire would require a client redeploy).
- **`DialogueClient`** — S2 tokens arrive as plain room `message`s over the one WSS (a client-held SSE/gRPC stream is forbidden — WebView stream-buffering can't reach the player). Owns the text-entry strategy field (HTML overlay | LineEdit).
- **`Session`** — memory-only custody: access JWT in RAM, refresh unreachable to GDScript by design (MUST-4). Telegram WebView cookie persistence is genuinely uncertain, so **memory-only + re-auth-via-handoff is the default, not a fallback.**

### 4.5 Per-seam verdict (client)

| Seam | Verdict | Adapters | Feasibility |
|---|---|---|---|
| `ITransport` | **PORT** | bridge · native-JSON-dev · replay | easy for dev/replay; **fantasy** for native-production |
| `AuthClient` | **PORT** | dev-stub · web · telegram | easy, host-selected; a 2nd IdP is one adapter |
| `EntityView` / `IntentSender` / `DialogueClient` core / `Session` / `TelegramBridge` | **MODULE** | single impl each | n/a — swap is at the transport |
| text-entry, contract codegen | **not a port** | strategy field / build tooling | n/a |

---

## 5. The swap mechanism + conformance

### 5.1 A swap is one typed-config change per side

- **Server:** edit one env var / one `CelestiaConfig` line (`CELESTIA_SYSTEMONE_DRIVER=mock → llamacpp`; `CELESTIA_GENERATIVE_DRIVER=claude → vllm` + `base_url`; `CELESTIA_SIGNING_DRIVER=local → kms`). If the adapter class is new, add it to the one `switch` in `@celestia/composition`. Restart; every consumer (Nest providers, rooms, gateway) gets the new adapter via the **same container**. **Zero call sites change.**
- **Client:** flip one typed constant / export feature; the `CelestiaSDK` autoload picks the adapter.

### 5.2 Four stability tiers (what may change, and how)

| Tier | Meaning | Members | Change rule |
|---|---|---|---|
| **F — Frozen** | money / identity / wire | auth claim+channel+close-code shape; `economy.posted@N` + closed reason codes; `net-schema` wire + `protocolVersion`; `event_type@version`; join/auth-options shape | **additive-only**; new version = new reducer version / `/v2` route / `protocolVersion` bump + forced-update; old reducer versions kept forever |
| **S — Stable port** | real port, credible 2nd adapter | `SystemOneProvider`, `GenerativeProvider`, `ITransport`, `AuthClient`, `JwtSigningKeyProvider` | change the interface in one monorepo PR; the conformance suite forces every adapter to follow **in the same PR** — no deprecation window (we force-update ourselves) |
| **D — Deferred port** | shape named, not wired to adapter #2 | `EntitlementSource`, `MemoryStore`, `EmbeddingProvider`, `IdP`, `ChainAdapter`(+`SignerPort`,`AddressScreeningProvider`), `PaymentRail`, `ComplianceGate`, `ModerationProvider`, `AttestationProvider`, `WalletClient` | prose until adapter #2 is funded |
| **C — Churning module** | no guarantee | reducer internals, Kysely queries, cognition-gateway transport, observability, config loader, UI/InputMap, `EconomyService` internals | refactor freely; only the tier-F outputs they produce are frozen |

### 5.3 Conformance suite — every adapter must pass it

Ships **inside the port package**. For non-deterministic oracles it asserts **contract invariants, never exact values** — and this is the thing keeping the P0 default mock honest against the real adapter.

```ts
// @celestia/cognition-contract/conformance.ts — mica-mock, llama.cpp, vllm all import and must pass.
export function runSystemOneConformance(make: () => SystemOneProvider) {
  test('argmaxIndex within allowedAnswers range', ...);
  test('abstainP in [0,1] and probabilities well-formed', ...);
  test('calibrationVersion + engineId are stamped (non-empty)', ...);
  test('respects deadlineMs → abstains, never hangs', ...);          // sheds on timeout
}
```

### 5.4 Golden-trace — prevents client/server drift

- **Reducer:** exact replay-determinism (`economy.posted@1` events → identical balances across code versions, reading logged `chosen_idx`, **never re-running inference**).
- **Oracle:** invariants only (exact-value replay of a non-deterministic model is impossible).
- **Transport (the critical client/server gate):** a recorded room-protocol trace from the web client that the native-JSON dev-client must reproduce. This is the **only** thing stopping the plaintext debug variant from silently drifting from the binary schema path (false green in-editor), and it gates any future native client.
- **Model cutovers** additionally require **shadow-eval ECE + persona-regression** before the flip — a serving swap is a *model deploy*.

### 5.5 Contract-drift gates (MUST-13 pattern — fail CI, never the field)

| Surface | Carrier | Two-sided gate |
|---|---|---|
| State **wire** | `protocolVersion` (+ **schema structural hash folded in**) | TS `protocolVersion` == `celestia_contract.gd` equality assert; **a field rename mechanically bumps the hash → forces a bump + forced-update**, instead of relying on reviewer discipline (closes the untyped-Dictionary field-rename drift) |
| **Constants** (close codes, intent types, reason codes) | git-diff-gated codegen → `celestia_contract.gd` | `git diff --exit-code` on the generated file |
| **Per-intent-type payload shape** | shared payload schema in `@celestia/http-contract`/`cognition-contract` | **NEW gate**: contract-test both sides — today only the intent *type* enum is gated, so payload fields drift silently (the TCB re-validates, so not an exploit, but a correctness drift) |
| **Event payloads** | `economy.posted@N` / `event_type@version` | snapshot test + replay-determinism test |
| **Auth claims / revocation / join+auth-options** | claim+`uversion` shape; frozen channels; **full join/auth-options key names** | **MUST-13 extended** to assert the full join/auth-options shape, not just claim/ent |
| **REST** | OpenAPI `/v1` | hand-kept GDScript builders vs `@nestjs/swagger` doc — **blocking, MUST-13-tier**; **no** OpenAPI→GDScript DTO generator (no mature tool = over-tooling) |
| **Oracle / model** | `calibration_version` per `(model_file, quant)` | shadow-eval ECE before any serving swap |

---

## 6. The YAGNI boundary

**Seams people will want to portify but shouldn't yet:**
- `EconomyService` — chokepoint **module**; its swap axis is `event_type@version` + new `ledger.asset` rows, not a swapped class. "One chokepoint" ≠ "one port."
- `apply()` reducer — must stay pure for replay.
- The DB/Kysely layer — `IDatabase` is a trap; Postgres DDL is load-bearing.
- A generic `IEventBus` over Colyseus / Redis / outbox — three different delivery guarantees; one abstraction would **lie**.
- Observability — OTel's exporter config *is* the neutral port.
- The cognition-gateway transport — the frozen proto frame is the contract; HTTP→gRPC swaps with no port.
- The eight tier-D prose seams — a port is born the day adapter #2 is funded.

**The cost of a premature port** is fourfold: an indirection that hides call sites, a lowest-common-denominator interface that leaks or under-serves, a conformance suite to maintain, and a frozen shape that resists the refactor you'll actually need. A *plugin framework* multiplies all four and adds a dynamic-loading security surface.

**What "going public" would ADD — clearly DEFERRED, build none of it now:**

| Public-SDK addition | Why deferred (internal reality that replaces it) |
|---|---|
| Semver + deprecation windows + changelog | One operator, two consumers, one monorepo. A red CI gate + atomic force-update in a single PR is *stricter and cheaper* than a semver promise to strangers you can't force-update. |
| Public docs + examples + quickstart | Our "docs" are the typed interface + the conformance suite. No external audience → maintenance tax. |
| Back-compat guarantees (N-2 adapters, LTS) | We never run an old adapter in the field; `protocolVersion` forced-update is the *opposite* of back-compat, by design. |
| **Plugin discovery / registry / dynamic loader** | **ANTI-GOAL, not deferral.** Loading third-party code into the single-threaded room = untrusted code in the TCB. Adapters are wired at boot from typed config, never discovered at runtime. |
| Multi-tenant / isolation / per-plugin quotas | Single operator; the room is already single-writer per village. |
| Stable extension **ABI** (vs source interface) | We change source-level TS/GDScript atomically in-repo; an ABI matters only across release cadences, which we don't have. |
| Published `@celestia/*` packages | Private workspace packages; publishing adds surface with no consumer. |

The one-way door we keep open: tier-F contracts are already additive-and-versioned, so externalizing later is **additive, not a rewrite**.

---

## 7. The Phase-0 SDK

Phase 0 = offline, no-login sandbox: one local Colyseus process, no NestJS/auth, in-process economy, recency-btree recall (no ANN), llama.cpp Mica + mica-mock on a laptop.

**DEFINE AS PORTS NOW** (adapter #2 exists on day one — the only P0 ports):
- `SystemOneProvider` — `mica-mock (DEFAULT) | mica-llamacpp`. Strongest P0 port: the mock runs every day.
- `GenerativeProvider` — `s2-mock | claude-hosted`. Ship it **labeled HARD**, not "base_url swap."
- `ITransport` (client) — `colyseus-bridge | native-json-dev | replay`. Adapter #2 is a P0 **necessity**: the dev-client is the only way to iterate netcode in-editor (JavaScriptBridge is web-only), and replay is the only way to run GUT headless.
- Plus the **two composition roots**: the server `buildServerContainer` factory switch and the Godot `CelestiaSDK` autoload.

**BAKE IN NOW AS MODULES / SCHEMA** (not ports):
- `EconomyService` in-process over `log.event` (`economy.posted@1`), sitting on a plain `LedgerRepo`.
- The pure, seeded, integer `apply()` reducer — **this is your DB-free test seam** (it removes any need for a `LedgerStore` port); persistence invariants test against a real Postgres testcontainer.
- The `hasEntitlement` predicate + `ledger.*` and grant-row schema (text slug, OR-semantics, `UNIQUE(account_id,key,source,source_ref_key)`) — the cheap bake-in that defuses L15/L16.
- The frozen-constant codegen → `celestia_contract.gd` with git-diff gate, the `protocolVersion` equality assert **with the schema structural hash folded in**, and the **MUST-13 contract-test skeleton** wired even though auth is a stub (so the pattern exists before auth lands).
- Store raw `text_enc` (so the future `EmbeddingProvider` re-embed migration is possible at all).

**DEFER THE INTERFACE ENTIRELY** (prose seam, zero code; write each the day adapter #2 is funded):
`MemoryStore`, `EmbeddingProvider`, `IdP/LoginProvider`, `EntitlementSource` resolver, `ChainAdapter`/`SignerPort`/`AddressScreeningProvider`, `PaymentRail`, `ComplianceGate` (null-ALLOW stub, no port), `ModerationProvider`, `AttestationProvider`, `WalletClient`. Also keep **room→gateway a module behind the frozen frame** (not a formal `CognitionClient` port) and **server↔server auth a module behind `/internal/*`**. `JwtSigningKeyProvider` and `AuthClient`'s web/telegram adapters are **P1** (dev-stub is the only P0 auth).

**DO NOT BUILD, EVER** (anti-goal, not deferral): plugin discovery / registry / dynamic adapter loader; semver + public docs + N-2 back-compat; published `@celestia/*` packages. These are the clearly-marked public-SDK hardening layer and are additive later.

**Where to start:** `@celestia/cognition-contract` (frozen frame + `SystemOneProvider`/`GenerativeProvider` + the conformance suite) and the two composition roots. Those three artifacts make `mock`-vs-real exercised from day one, prove the wiring mechanism end-to-end, and establish the drift gates before any contract is load-bearing.
