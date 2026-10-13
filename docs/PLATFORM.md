<!-- Generated 2026-10-10 by a multi-agent design pass: 5 facets (incl. life-sim & pokemon-like worked modules) -> genre-neutrality critic -> synthesis. -->
<!-- Celestia = engine (@celestia/*) + GameModules (@celestia/game-*). Engine = mechanisms; module = game logic. -->

# PLATFORM.md — Celestia Engine ↔ GameModule Architecture

**Status:** authoritative. Reconciles ARCHITECTURE / AUTH / AUTHZ / WEB3 / WEB3-READINESS / SDK / TECH-STACK, five facet designs, and the adversarial critique. Supersedes the single-game framing in which `@celestia/*` *was* the game: those docs now describe `@celestia/*` (engine) + `@celestia/game-cozy` (the first module). Codenames are provisional; this doc refers to services by function and gives the codename on first mention.

---

## 1. Thesis

**The engine is a set of genre-neutral *mechanisms*. A GameModule is where all genre *meaning* lives.** A new Celestia game is a new first-party `@celestia/game-*` package + content + a Godot render package, selected at the composition root by typed config (`cfg.game.driver`). It is **never** an engine fork.

Precisely:

- **ENGINE (reused as-is, deployed per game):** the room-as-process TCB and the fixed intent pipeline; the one `can()` policy chokepoint; the one `EconomyService` value chokepoint; owned-asset custody + the escrow saga; event-log-as-truth + the replay/reducer driver; the cognition gateway (System-1 index / System-2 dialogue / scoped memory); identity, matchmaking, coordination, moderation; the scope model; the client SDK runtime.
- **MODULE (all game logic/rules/content):** entity/component definitions; the intent vocabulary + per-action `enumerate()` legality + `execute()`; progression + win rules as pure reducers; economy *config* (currencies, items, reason codes, caps); NPC decision schemas + dialogue assembly; room-type definitions (tick driver, lifecycle, visibility); content/canon; the Godot render/input package.

**The one line that resolves most of the design:** `can()` answers *"may this principal act on a resource of this scope/owner?"* — ENGINE, game-agnostic, deny-by-default. `enumerate()` answers *"is this a legal move in the game right now?"* — MODULE. They are different questions and live on different sides. `can()` checks **authority**; `enumerate()` checks **legality**.

**The sweet spot (what the engine targets):** shared-world, server-authoritative, intent-based, NPC-and-economy games where every player action is an enumerable choice and the LLM returns an index into a sim-authored option set. Both launch titles — a **cozy life-sim** (Harvest-Moon-like) and a **Pokémon-like** (collect / turn-based battle / trade) — are expressible as modules against the *same* engine.

**Explicit non-goals:** twitch shooters / sub-100ms competitive action; offline single-player; **dynamic third-party plugin loading** (untrusted code in the single-threaded TCB — a hard anti-goal); cross-game asset/currency portability.

**The locked invariants hold across all games, verbatim:** client not trusted; LLM not trusted (returns an index/typed candidate-intent, is never assembled into an Actor); one `can()` chokepoint; event-sourced truth with pure replay; ports/adapters; integer money `NUMERIC(38,0)`. A GameModule is **trusted code inside the TCB** — the clean boundary is an *interface discipline* (capability handles + zero engine-internal reach) that buys multi-game reuse, **not** a security sandbox.

### 1.1 The honest correction this doc makes

The facet designs disagreed about the battle, and **the disagreement is the finding.** Facet-1 claimed a turn-based battle is "just a `zoneArchetype:ephemeral-match` entity, round-trip unchanged, no engine change." That is **false**, and Worked Example B refutes it: a battle requires a one-time `CelestiaRoom → Zone/Match` factoring plus a small cluster of primitives (match lifecycle, a sealed-commit turn barrier, a result-return single-writer-commit saga, a scoped entity checkout, a per-instance timer, a per-seat visibility filter). Facet-1's interface literally has no hook for any of them.

**Ruling (adopted platform-wide): the canonical `GameModule` contract in this doc is Worked Example B's, not facet-1's.** These primitives are built **during game #1**, not deferred — because they touch the deepest seams (room TCB, intent pipeline, clock authority, single-writer invariant) and "add later" means re-opening the TCB in production. The life-sim exerts near-zero pressure to build them, which is *precisely* how a naive "extract the engine from game #1" produces an engine that cannot host game #2 without the exact surgery the no-fork promise denies. We pay that cost up front, and we justify each primitive by a credible second life-sim consumer (instanced interiors, co-op, festival windows, trade confirmation) so none is a hypothetical-game-#3 over-generalization.

---

## 2. The Engine ↔ Module Boundary — "where does X live?"

| Concern | Side | Why |
|---|---|---|
| **Entities + components (storage, id alloc, wire-sync)** | ENGINE | Both games are entities-with-components; the scope/DAL hard-scope is the privacy TCB — too dangerous to re-implement per game. |
| **Entity *definitions* (which components, which are synced vs server-only brain)** | MODULE | Pure data declared at mount; the engine stores/syncs what it is told. |
| **Scope enforcement (GLOBAL / SHARED / PER_PLAYER / PLATFORM-GLOBAL)** | ENGINE | The cross-account-read-is-physically-impossible guarantee. |
| **Intents: pipeline *order* + TCB** (`auth → resolveResource → can() → enumerate → reserve → commit-barrier → execute → fenced append → ack`) | ENGINE | The fixed stage order is the security spine. |
| **Intent *vocabulary* + `enumerate()` legality + `execute()` numbers** | MODULE | Legality and all game math (price, damage, affection, yield). |
| **`resolveResource` (id → `Resource{scope, ownerAccountId}`)** | **MODULE declares typing; ENGINE performs the trusted read** | Scope/owner read **only** from authoritative state, never the client payload. |
| **Authz `can(actor, authzClass, resource, ctx)`** | ENGINE | One chokepoint, closed game-agnostic `AuthzClass` vocabulary; deny-by-default. |
| **Mapping game verb → `authzClass`** | MODULE | Each action tagged with exactly one class at registration; unmapped ⇒ deny. |
| **Progression / win rules** | MODULE | Pure reducers + optional `terminal()`; the engine stays silent on "winning." |
| **Economy *mechanism* (double-entry, idempotency, holds, `NUMERIC(38,0)`, fence)** | ENGINE | The one value chokepoint; the module gets a handle, never writes a balance. |
| **Economy *config* (currencies, items, reason codes, faucet caps)** | MODULE | Values declared as data; the engine posts against `SYS_*` the module never names. |
| **Owned-asset custody + ownership transfer + escrow saga** | ENGINE | Atomicity / anti-dupe / `trade_block` enforcement; the hardest correctness surface. |
| **What is tradeable / per-component travels-vs-stays** | MODULE | Tradeability policy + the asset's own state schema. |
| **NPC decisions (routing, batching, mailbox, staleness, index-only, re-validate)** | ENGINE | The LLM-not-trusted spine must be byte-identical across games. |
| **Decision *schemas* (option sets, frames) + dialogue assembly (persona, scoped recall query, typed candidate-intent schema)** | MODULE | What a decision *means*; the engine runs the recall scoped. |
| **Dialogue loop / token streaming / memory scope enforcement** | ENGINE | Scope filter lives in the TCB; the gateway never sees a `player_id`. |
| **Rendering + input mapping** | MODULE | Godot scenes, archetype→scene, input→intent; opaque to the server. |
| **Persistence / event-log-as-truth / replay driver** | ENGINE | `seq`, `prev_hash`, fence, durable-before-ack, outbox, crypto-shred. |
| **Event *types* + pure `apply()` reducers** | MODULE | `gift.given@1`, `pkmn.turn_resolved@1`; kept forever. |
| **Room lifecycle, matchmaking, reconnect, handoff, Match sessions, timers** | ENGINE | Container concerns. |
| **Room-type *definitions* (tick driver, lifecycle, interest, visibility, barrier)** | MODULE | Declared per room; the engine owns both implementations and picks by declaration. |

### 2.1 The divergence ruling table (reconciled)

| # | Divergence | Life-sim | Pokémon-like | Ruling | Owner |
|---|---|---|---|---|---|
| 1 | **Battle vs overworld room** | 1 persistent pinned village | ephemeral 2-seat battle + shared overworld | `CelestiaRoom` factored into `Zone`/`Match` siblings sharing the TCB. **BUILD DURING GAME #1.** | Engine (base, lifecycle) · Module (room-type defs) |
| 2 | **Creature vs farm-plot ownership** | plot: PER_PLAYER, fixed, non-transferable | creature: PER_PLAYER, portable, tradeable + a SHARED→PER_PLAYER capture flip | `scope:'dynamic'` + owned-asset custody + escrow (N9 flips DEFER→BAKE-IN). | Engine (custody, escrow) · Module (asset kinds, state schema, tradeability) |
| 3 | **Real-time tick vs turn structure** | 4 Hz interval tick, interest grid | discrete turns; a move is an intent | tick driver + interest + visibility become **per-room-type properties**; the global Clock Authority drives *one* room-type (overworld), not the engine. | Engine (pipeline, tick-driver seam, per-instance timer) · Module (turn logic) |
| 4 | **Collection/leveling vs cultivation/relationships** | affection, crop growth | XP, evolution, catch, type chart | **PURE MODULE** — reducers + content + decision schemas. No engine change. Strongest proof the boundary is genre-neutral. | Module (100%) |
| 5 | **Team-of-6 vs inventory limits** | bag slot/weight limits | ordered party ≤6 + unbounded box | Module `validate()` rule over generic storage; cardinality/ordering is **not** an engine primitive. Box is lazy-projected. | Module (rules) · Engine (storage, tunable warm-load) |
| 6 | **PvP simultaneous secret commit** | never — no adversarial co-present intents | both pick hidden, then reveal | **Genuine new intent-pipeline stage** (sealed-commit barrier). Facet-1's "round-trip unchanged" is false for PvP. **BUILD DURING GAME #1.** | Engine (barrier) · Module (`isTurnComplete`) |
| 7 | **Hidden-info visibility** | per-owner auto-scope suffices | per-seat, per-reveal-state | **New per-seat view-filter hook** over the per-client StateView; static `shared-wire\|per-player\|server-only` is insufficient. | Engine (hook) · Module (filter) |

**Net honesty verdict.** The engine's *primitives* (room, intent pipeline, enumerate→index cognition, event log, `can()`, scopes, `EconomyService`) are genuinely genre-neutral. The places the single-game design was *secretly life-sim-shaped* are exactly these, now all made explicit and all scheduled for game #1: **(a)** hardcoded real-time tick + single global clock → per-room-type tick driver + per-instance timer; **(b)** no sealed-commit stage → the barrier; **(c)** no per-seat visibility → the view-filter hook; **(d)** inventory-as-items vs stateful owned assets → custody; **(e)** pinned-persistent assignment vs ephemeral instances → the `Match` sibling; **(f)** deferred synchronous trade → escrow flips to BAKE-IN; **(g)** game-blind `can()` → `game_id` as a first-class scope dimension (§6).

---

## 3. The `GameModule` Contract

### 3.1 Dependency direction and the composition root

```
@celestia/engine  ──imports──▶  @celestia/game-contract   (interfaces + leaf types ONLY)
@celestia/game-*  ──imports──▶  @celestia/game-contract, @celestia/engine
engine            ──NEVER────▶  @celestia/game-*
```

A concrete module is wired only at a per-game `app` composition root (`engine.mount(cfg.game.driver)`), a server-boot singleton — never sourced from client join options. A `dependency-cruiser` CI arch-test fails the build on any `@celestia/<engine-pkg> → @celestia/game-*` edge, and a pure-reducer lint bans `Date.now`/`Math.random`/float-money inside reducer packages.

### 3.2 The server interface

```ts
// @celestia/game-contract — the ONLY game-shaped thing the engine imports.
export interface GameModule {
  readonly gameId: string;                 // 'cozy' | 'pkmn' — namespaces data, tokens, deploy; stamped into every event
  readonly schemaNamespace: string;        // 'mod_cozy' | 'mod_pkmn' — its own Postgres schema, same GRANT discipline
  readonly engineContractVersion: string;  // CTK asserts ⊆ the running engine's supported range

  // ---- STATIC DECLARATION (pure data; read once at mount; engine validates + freezes) ----
  declare(reg: ModuleRegistry): void;      // components, archetypes, actions+authzClass, economy cfg,
                                           //   decision/dialogue schemas, event types+reducers, room types,
                                           //   asset kinds, content manifest  (see §3.3)

  // ---- ROOM LIFECYCLE (caps are the ONLY way to touch the world) ----
  onRoomCreate(room: RoomContext, caps: RoomCaps): Promise<void>;
  onJoin(p: JoinContext, caps: RoomCaps): Promise<void>;     // warm-load is MODULE-TUNABLE (party≤6 warm, box lazy)
  onTick(t: TickContext, caps: RoomCaps): void;              // SYNC, ≤ budget, NEVER awaits cognition
  onLeave(p: LeaveContext, reason: LeaveReason, caps: RoomCaps): Promise<void>; // reason: 'graceful'|'disconnect'|'kick'
  onRoomDispose(caps: RoomCaps): Promise<void>;

  // ---- INTENT LEGALITY + EXECUTION (engine wraps with auth/can()/fence/barrier) ----
  resolveResource(i: Intent, w: WorldView): Resource | null; // id → {scope, ownerAccountId}; from AUTHORITATIVE state
  enumerate(r: Resource, w: WorldView, actor: ActorRef): OptionSet;  // PURE legality
  execute(ctx: ExecuteCtx, caps: RoomCaps): Event[];         // compute numbers; effects via caps; returns events

  // ---- TURN / MATCH (the primitives the canonical contract MUST expose) ----
  isTurnComplete(committed: SealedCommit[], live: Seat[], now: TickTime): boolean; // commit-barrier predicate
  resolveTurn(state: unknown, revealed: ChosenOption[], seed: bigint): Event[];    // PURE seeded reducer
  projectMatchResult(state: unknown): MatchResult;           // transient battle state → durable outcomes
  applyMatchResult(r: MatchResult, caps: RoomCaps): Event[]; // committed by the SINGLE writer, through can()+EconomyService
  onForfeit(seat: Seat, cause: ForfeitCause, caps: RoomCaps): Event[]; // disconnect/timeout → award opponent, release checkout
  viewFilter(state: unknown, seat: Seat): unknown;           // per-seat visibility (hidden-info battle)

  // ---- COGNITION (engine owns mailbox/staleness; module re-validates, engine re-authorizes as actor=sim) ----
  buildDecisionFrame(subject: EntityId, w: WorldView): DecisionFrame;        // { ..., gameContext:<opaque> }
  onDecision(d: DecisionResult, caps: RoomCaps): Event[];                    // S1 index → re-enumerate → execute
  buildDialogueRequest(req: DialogueBuildReq, mem: MemoryHit[]): DialogueSpec;
  onDialogueIntents(ints: CandidateIntent[], caps: RoomCaps): Event[];       // UNTRUSTED → re-validate each

  // ---- CLIENT ----
  render: RenderPackageRef;                 // OPAQUE to the server; see §3.5
}
```

### 3.3 What `declare()` registers (the six things + room types + assets)

```ts
export interface ModuleRegistry {
  component(name, { fields: ZodSchema, sync: 'shared-wire'|'per-player'|'server-only' }): void; // money NEVER a field
  archetype(kind, { components: string[], scope: Scope|'dynamic', ownerComponent?: string }): void;
  action(type, { payload: ZodSchema, authzClass: AuthzClass, locate: (p)=>ResourceRef }): void;  // ids only; amount fields rejected
  progression({ events: EventTypeDecl[], reducer: PureReducer, terminal?: (s)=>WinState|null }): void;
  economy({ currencies: {id,decimals:0}[], items, reasonCodes: readonly string[], faucets, sinks }): void;
  decisionSchema(name, { question, options:(npc,w)=>Option[], frame:(npc,w)=>DecisionFrame }): void;
  dialogue({ personaPrefix, recall:(scope)=>MemoryQuery, allowedIntents: JsonSchema }): void;
  event(decl: EventTypeDecl): void;                     // 'x@1' + PURE apply(); kept forever
  assetKind(kind, { tradeable: boolean, portable: boolean, stateSchema: ZodSchema }): void; // creature, tool...
  roomType(name, {
    persistence: 'persistent-pinned' | 'player-instanced' | 'ephemeral-match',
    tick: { kind:'interval'; hz:number } | { kind:'phase'; advanceOn:'all-commits'|'timeout'; timeoutMs:number },
    interest: 'spatial-grid' | 'whole-room',
    visibility: 'open' | 'per-seat-filtered',          // per-seat ⇒ engine calls viewFilter() per client
    seats?: { min:number; max:number; roster:'open'|'reserved' }, // 'reserved' = Match roster
    teardownWhen?: (w)=>boolean,
  }): void;
  content(manifest: ContentManifest): void;             // GLOBAL canon, read-only at runtime
}
```

The `AuthzClass` vocabulary is **closed and game-agnostic**: `read | write_owned | interact_shared | transfer_custody | spend_own` + the fixed engine admin/money/staff verbs + **`match_seat`** (participation in *this* Match's roster — see §3.6). The `can()` `Action` union does **not** grow per game; game verbs are *tagged* with one class at registration.

### 3.4 Capability handles — `RoomCaps` (the module never sees Postgres / Valkey / the room object / a model socket)

```ts
export interface RoomCaps {
  store:     EntityStore;      // scoped CRUD; engine syncs + persists-as-events
  ledger:    LedgerHandle;     // the ONE value chokepoint — fungible, integer Minor=bigint, idempotent
  custody:   CustodyHandle;    // owned-asset ownership transfer + escrow saga (see §4.3)
  cognition: CognitionHandle;  // dispatch S1/S2 → mailbox; results arrive via onDecision/onDialogueIntents
  memory:    MemoryHandle;     // recall(session) — engine injects session scope; no caller-supplied player_id
  events:    EventSink;        // append a game-typed event; engine assigns seq/prev_hash, fences, durable-before-ack
  clock:     WorldClock;       // READ authoritative event-sourced time; module CANNOT advance it
  timer:     TimerHandle;      // NEW: deterministic per-instance timers (turn deadlines, respawns, festival windows)
  match:     MatchHandle;      // NEW: create()/entity-checkout; server-side instanced-session creation
  rng:       SeededRng;        // deterministic PRNG seeded from the current event — replay-safe
  log:       ScopedLogger;     // low-cardinality telemetry only
}
```

Each handle makes one locked invariant **structurally** impossible to violate from module code:

- `ledger` rejects any `assetId`/`reasonCode` not declared in economy config → a buggy or injected line cannot invent money or a faucet; it can never write `ledger.posting` or name a `SYS_*` account.
- `memory.recall(session)` takes the engine-authenticated `SessionScope`, never an id → the cross-player memory leak is closed in the handle, not by module discipline.
- `clock` has no `advance()` → single-clock-authority holds even though "sleep skips the day" is a core life-sim verb (resolved via per-instance fast-forward, §3.7).
- `timer` schedules deterministic, replay-safe wake-ups keyed to event-time (not wall-clock) → the per-match turn deadline has a home without a second clock authority.
- `rng` is the only randomness → the pure-reducer replay property survives any module author.
- `events.append` stamps `seq/prev_hash/fence_token/actor` itself; the module supplies only the PII-free payload.

### 3.5 The client interface (Godot render/input package over Astrolabe)

```gdscript
# res://games/<gameId>/game_module.gd — registered with the CelestiaSDK autoload.
# Touches ONLY SDK facades: SDK.entities (EntityView), SDK.intents (IntentSender), SDK.dialogue.
# Never the transport, never a raw WebSocket, never a money/amount field (IntentSender refuses them).
class_name CelestiaClientModule extends RefCounted

func register(sdk: CelestiaSDK) -> void:
    sdk.renderers.bind(&"villager",  preload("res://games/cozy/view/villager.tscn"))
    sdk.renderers.bind(&"creature",  preload("res://games/pkmn/view/creature.tscn"))

func on_entity_added(coll, id, snap):   _spawn_view(coll, id, snap)
func on_entity_changed(coll, id, changes): _apply(id, changes)   # per-seat-filtered state arrives already redacted
func on_entity_removed(coll, id):       _free_view(id)
func on_message(type, payload):
    match type:
        "dialogue.token": _dialogue_ui.append(payload.text)
        "rel_delta":      _hud.set_affection(payload.npc, payload.value)   # PER_PLAYER, this client only
        "battle.event":   _battle_fx.play(payload)

func on_player_action(ui: StringName, target: String, option_index := 0) -> void:
    SDK.intents.send(ui, { "target": target, "optionIndex": option_index })  # indices only; money firewall below it
```

The client is a **dumb intents-only renderer** in both games. Hidden-information battle state (the opponent's unrevealed bench) never reaches the client because the engine applies `viewFilter(state, seat)` before the StateView patch — redaction is server-side, not a client courtesy.

### 3.6 The intent pipeline (engine code; the fixed stage order is the spine)

```ts
// CelestiaRoom.tick() — ENGINE. Hook slots marked (M); everything else is (E).
if (!this.holdsFence()) return this.selfFence();                              // (E) fence at top of tick
for (const env of this.drainIntents()) {                                      // (E) (recvTick, sid, seq) order
  const actor = this.actors.fromAuth(env.client);                            // (E) principal from onAuth, NEVER payload
  const spec  = this.catalog[env.intent.type];                               // (E) module-declared action
  if (!spec) { this.reject(env,'unknown_action'); continue; }                //     unmapped ⇒ deny-by-default
  const r = this.mod.resolveResource(env.intent, this.view);                 // (M) scope+owner from AUTHORITATIVE state
  if (!r) { this.reject(env,'unknown_resource'); continue; }
  if (can(actor, spec.authzClass, r, this.ctx).effect==='deny')              // (1 E) THE policy chokepoint + game_id scope
      { this.auditDeny(); this.reject(env,'forbidden'); continue; }
  const opts = this.mod.enumerate(r, this.view, actor);                      // (2 M) legality — PURE
  if (!opts.has(env.intent.optionIndex)) { this.reject(env,'not_enumerated'); continue; }
  if (r.scope==='SHARED' && !this.holdsFence(r)) { this.reject(env,'no_fence'); continue; } // (3 E) single-writer reserve

  if (this.roomType.tick.kind === 'phase') {                                 // (3b E) SEALED-COMMIT BARRIER (Match only)
    this.sealCommit(env, actor);                                            //     held server-side; NOT synced to peers
    this.ack(env.seq);                                                      //     client sees "committed", not the choice
    if (!this.mod.isTurnComplete(this.sealed, this.liveSeats, this.now)) continue;
    const revealed = this.reveal();                                         //     simultaneous reveal AFTER barrier
    const evs = this.mod.resolveTurn(this.matchState, revealed, this.nextSeed()); // (4 M) PURE seeded reducer
    this.appendFenced(evs); this.syncViewFiltered();                        // (E) durable turns; per-seat redaction
    continue;
  }
  const evs = this.mod.execute({ actor, intent: env.intent, resource: r, option: opts.at(env.intent.optionIndex),
                                 world: this.view }, this.caps);            // (4 M) interval rooms: execute now
  this.appendFenced(evs); this.ack(env.seq);                               // (E) durable-before-ack
}
this.mod.onTick(this.tickCtx, this.caps);                                   // (M) autonomous sim + cognition dispatch
this.dispatchCognition();                                                   // (E) no await; mailbox
```

NPC/dialogue apply reuses the **same** gate: the engine sets `actor={kind:'sim'}` itself, re-`enumerate`s NOW (world moved), re-runs `can()`, then `execute`. A fully prompt-injected model can at most re-weight sanctioned options inside its own session — it is structurally never a principal.

### 3.7 One worked intent round-trip — `give_gift(mira, leek)`

1. **Client.** Drag leek onto Mira → `on_player_action(&"give_gift","npc:mira",0)` → `IntentEnvelope{seq, type:"give_gift", payload:{target:"npc:mira", item:"leek"}}` over the one WSS. *IntentSender structurally refuses any `amount`/`price` field.*
2. **Engine — admit.** Rate-limit + bounds → queue; drained in `(recvTick,sid,seq)` order.
3. **Engine — resolve + authorize.** `catalog["give_gift"] = {authzClass:'interact_shared', locate:p=>p.target}`. `resolveResource("npc:mira")` reads authoritative state: `{kind:'villager', scope:'SHARED', owner:undefined}`. `can(player,'interact_shared',mira,ctx)` with `ctx.gameId='cozy'` → **allow**.
4. **Module — legality.** `enumerate(mira, world, player)` → `[give_gift, converse, …]`, each pre-filtered (does Alice hold a leek? is Mira mid-conversation?). `optionIndex 0` ∈ set.
5. **Engine — reserve.** Mira is SHARED → room checks `holdsFence(mira)`. Yes.
6. **Module — execute.** Returns events; effects via caps: `store.patch("inv:alice","items",{leek:-1})` (PER_PLAYER, hard-scoped to Alice); reads `rel:alice:mira` (auto-scoped — Bob can never be returned); emits `gift.given@1`; `cognition.decide("npc_gift_reaction","npc:mira",60)` (S1, no await).
7. **Engine — append + ack.** `gift.given@1` written durable-before-ack in one txn (`seq`, `prev_hash` chained, fenced); `ack(seq)`.
8. **Engine — mailbox (tick N+k).** S1 returns `{argmaxIndex:0 /*delighted*/, probs, seed}`; staleness guard passes; `onDecision` called.
9. **Module — apply.** Re-`enumerate` confirms still legal; engine re-runs `can({kind:'sim'},'write_owned',rel:alice:mira)`; `store.patch("rel:alice:mira",{affection:+8})`; optional `cognition.converse` for an S2 line.
10. **Engine → Client.** The `rel:alice:mira` patch rides Alice's PER_PLAYER StateView → `on_entity_changed` → `_hud.set_affection`. S2 tokens stream as `dialogue.token`. Net: Alice's inventory decremented, only her relationship moved, one replayable event logged, the client asserted no number.

---

## 4. Engine services as generic primitives

| Service (codename) | Generic primitive exposed to modules | Handle | Engine owns / module owns |
|---|---|---|---|
| **Auth (Janus)** | identity; `account_id` as the sole cross-game principal | none at runtime (`client.auth` inside the Actor) | E: token mint/refresh, 60s single-use realtime ticket (now `game`-claimed), JWKS, ban fan-out, login adapters · M: `OPEN_TIERS`/flags config |
| **Authz (Libra/Astraea)** | one pure `can(actor, authzClass, resource, ctx)` | engine *calls* it; module supplies `resolveResource` + action→class map | E: chokepoint, Actor union, deny-by-default, DAL hard-scope, `game_id` scope dimension · M: resource typing, legality in `enumerate` |
| **Room (Atlas / Colyseus)** | `CelestiaRoom` base → `ZoneRoom` + `MatchRoom` siblings (§4.1) | `RoomCaps` | E: tick, drain order, fence, reserve, barrier, sync, reconnect, handoff · M: room-type defs + hook bodies |
| **Economy (Moneta)** | double-entry ledger over module-declared currencies | `LedgerHandle` | E: postings, conservation, idempotency, holds, fence, `NUMERIC(38,0)`, `SYS_*`, durable-before-ack · M: currency semantics, reason codes, prices (computed in `execute`) |
| **Custody (part of Moneta)** | owned-asset ownership transfer + escrow saga (§4.3) | `CustodyHandle` | E: atomicity, anti-dupe, `trade_block`, two-leg commit · M: asset kinds, state schema, tradeability |
| **Persistence (Akasha)** | append-only `log.event` + replay driver | `EventSink` | E: `seq`, `prev_hash`, fence-guarded append, replay-reads-logged-oracle, crypto-shred, `event_type@version` registry · M: event types + pure reducers |
| **Cognition (Mercury S1 / Calliope S2 / Mnemosyne RAG)** | batching gateway over a frozen `DecisionFrame`; index-only S1, typed-intent S2; scoped recall | `CognitionHandle`, `MemoryHandle` | E: routing, batching, model creds, staleness guard, index-into-enum guarantee, RAG scope in the TCB · M: `gameContext` (opaque), `allowedAnswers`, persona, recall query |
| **Moderation (Custos)** | report intake + `authz.restriction` records consumed by `can()` with deny-precedence | declares restriction-type→denied-action rows | E: report plane, classifier port, restriction mechanism, ban fan-out · M: what is moderatable, the restriction table |
| **Client SDK (Astrolabe)** | `ITransport`, one `IntentSender` (money firewall), `EntityView`, `DialogueClient`, `Session`, protocolVersion handshake + a `RenderPackage` slot | SDK facades | E: all of the above · M: the render package |
| **Timer / Match (new)** | deterministic per-instance timers; server-side instanced-session creation | `TimerHandle`, `MatchHandle` | E: timer wheel keyed to event-time, Match lifecycle + roster · M: deadlines, Match kinds + rosters |

### 4.1 The room factoring (the one engine extension, built during game #1)

```ts
abstract class CelestiaRoom {               // owns the TCB: intent queue, can() chokepoint, enumerate→reserve→execute,
  protected mod: GameModule;                //   fenced log append, cognition dispatch, reconnect, per-seat sync
}
class ZoneRoom  extends CelestiaRoom {}     // + spatial StateView, world_clock subscription, matchmaking-continuity assign
class MatchRoom extends CelestiaRoom {}     // + bounded reserved roster, commit-barrier TurnScheduler, viewFilter,
                                            //   MatchResult return channel, per-instance turn timer; NO spatial grid

interface MatchHandle {                     // server-side instanced-session creation — NOT client-browse matchmaking
  create(req: { kind: string; participants: AccountId[]; simSeats?: SimSeatSpec[];
                roomType: string; params: unknown; returnTo: ReturnChannel }): Promise<{ matchId: string }>;
  checkout(entityId: EntityId, intoMatch: string): Lease;   // hold an entity into a Match (exclusive)
  // commit on win / release on abnormal termination — the hold/capture/release discipline, parameterized over entities
}
```

**Why this is a factoring, not a fork:** `MatchRoom` inherits the *entire* TCB — same `can()`, same `enumerate→reserve→execute`, same fenced `log.event`, same cognition dispatch, same reconnect. It opts **out** of three Zone-only concerns (spatial interest grid, continuous `world_clock` ticker, continuity assignment) and opts **in** to a turn barrier + a result channel + a per-instance timer. **Second consumers in the life-sim** keep each piece from being Pokémon-specific: instanced interiors / co-op cooking / festival mini-games (Match lifecycle); trade confirmation and synchronized co-op actions (commit-barrier); the engine already per-player-instances home farms and runs a private 1:1 dialogue slot (both degenerate Matches). We are naming latent primitives, not inventing foreign ones.

### 4.2 Battle-state durability — the contradiction resolved

**Ruling: battle turns ARE durable, event-sourced truth.** `"ephemeral-match"` describes the **process/room lifecycle, not the event stream.** Each `resolveTurn` emits `pkmn.turn_resolved@1` (with its seed and the logged AI `chosen_idx`) into `log.event`. Consequences, stated so no facet can waffle:

- A disputed or crashed battle **replays bit-for-bit from Akasha** using the engine's existing forensic machinery — free deterministic anti-cheat, the same guarantee the life-sim gets for economy actions, inherited at zero marginal cost.
- **Reconnect to an ephemeral instance** = reload room state by replaying its turn stream; the MatchRoom process is rebuildable, so a mid-battle crash does not violate event-sourced truth.
- Transient-only battle state (render-timers, animation cursors) is **never** logged and is the `projectMatchResult` "transient vs durable" split.

### 4.3 The two value authorities and the escrow saga — the honest invariant softening

The critique is correct that `"ONE EconomyService chokepoint"` becomes **two value authorities**: the **fungible ledger** (`LedgerHandle`, double-entry integer money) and **non-fungible custody** (`CustodyHandle`, unique stateful entities). This doc **explicitly amends the invariant**: it is now *"all value movement flows through an engine chokepoint; there are exactly two — fungible (ledger) and non-fungible (custody) — and any trade spanning both commits through **one** escrow saga with specified atomicity."* The module never gets a third path.

```ts
type AssetHandle =
  | { kind:'ledger';  asset: AssetId; amount: MinorString }                    // fungible
  | { kind:'entity';  gameId: ModuleId; entityKind: string; entityId: string };// non-fungible (a creature)

interface CustodyHandle {
  claim(entityId, toOwner, reason: ReasonCode): CustodyReceipt;                 // scope flip SHARED→PER_PLAYER, fenced, logged
  escrowSwap(spec: { legs: { from: AccountId; give: AssetHandle[] }[]; }): EscrowId; // atomic across ledger + custody
}
```

**Atomicity (specified, not hand-waved).** `escrowSwap` is a two-phase saga over a **single outbox-driven state machine** persisted in `log.event`: `PREPARE` places a `hold` on every leg (ledger `hold`, custody `checkout`); the barrier requires both counterparties to confirm; `COMMIT` captures all legs *or* `ABORT` releases all. Each leg's `hold`/`capture`/`release` is idempotent and fenced; a crash resumes from the logged saga state. A creature entering a battle is the **same** `checkout`→`capture-on-win`/`release-on-forfeit` discipline.

**The scope-flip concurrency hole (named).** Capture (`SHARED→PER_PLAYER`) *while the same entity is checked out into a Match* is resolved by making checkout an exclusive lease: `custody.claim` fails against a leased entity, and `onForfeit`/`applyMatchResult` releases the lease before any flip. This is a correctness surface, flagged in §7.

---

## 5. The two worked modules side-by-side

| Facet | Cozy life-sim (`@celestia/game-cozy`) | Pokémon-like (`@celestia/game-pkmn`) |
|---|---|---|
| **archetypes** | `villager`(SHARED), `crop_plot`(PER_PLAYER-instanced), `inventory`(PER_PLAYER) | `creature`(**scope:'dynamic'**, assetKind), `trainer`(SHARED), `party`/`box`(PER_PLAYER), battle state (Match room state) |
| **entity storage** | `mod_cozy.*` schema | `mod_pkmn.*` schema (**typed per-module rows**, chosen over an opaque cross-kind blob store — §7 YAGNI) |
| **actions → authzClass** | `plant/harvest/build`→`write_owned`, `gift/converse`→`interact_shared`, `buy`→`spend_own` | `use_move/switch`→`match_seat`, `capture`→`transfer_custody`, `trade_creature`→`transfer_custody`, `challenge_gym`→`interact_shared`, `buy_ball`→`spend_own` |
| **enumerate()** | plantable iff tilled+seed+season; giftable iff holding item | `use_move` iff your commit-window + PP>0 + not fainted; `capture` iff wild + ball in bag; `challenge_gym` iff badge-prereq met |
| **economy** | `COIN` (non-withdrawable, `is_token=false`); sinks seeds/upgrades, faucets crop sales | `COIN`; sinks balls/potions, faucets battle winnings |
| **S1 schemas** | `npc_gift_reaction`, `npc_daily_schedule` | `wild_move_select`, `trainer_switch_decision` (index-into-moves — a *strong* fit) |
| **progression** | relationship bands/seasons; `terminal: null` (open-ended) | badges + Elite Four + ladder; `terminal:(s)=>s.badges===8?WIN:null` |
| **room types** | `village`: persistent-pinned / interval 4Hz / spatial-grid / open / 150 | `town`: persistent-pinned / interval / spatial-grid / open; `pvp_battle`: **ephemeral-match / phase(all-commits,timeoutMs) / whole-room / per-seat-filtered / reserved-roster 2** |
| **trade** | async gift-mailbox (N9 deferred — a cozy launch can ship it) | **synchronous atomic `escrowSwap`** (N9 BAKE-IN — the Pokémon-like cannot defer it) |
| **client** | farm/dialogue/shop UI over SDK | battle/overworld UI over SDK; hidden-info redacted server-side |

Every row is a value or a pure function passed through `GameModule` and wired by capability handles. **No engine service is forked.**

### 5.1 Turn-based battle — the resolution, incorporating the critique's verdict

A battle is a **`MatchRoom`** (room-vs-sub-entity decision **made**, not waffled): an ephemeral, reserved-roster, phase-gated instance that reuses the TCB wholesale. The five seams it exercises — all engine-owned, all built during game #1:

1. **Room factoring** (§4.1) — `Zone`/`Match` siblings.
2. **Sealed-commit barrier** (§3.6) — PvP picks are held server-side and revealed *simultaneously*. `enumerate()` solves turn-*ownership*; the barrier solves hidden-*simultaneous*-selection — the genuine new pipeline stage facet-1 wrongly denied. **Built for committed Pokémon PvP; its API is NOT generalized for hypothetical sealed-bid auctions / RPS** (YAGNI, §7).
3. **Per-instance turn timer** (`TimerHandle`) — per-turn deadline → auto-struggle/forfeit; a per-match timer keyed to event-time, not a second global clock.
4. **Player-in-two-rooms** — the Zone sets `presence=in_match` (a freeze cousin of the zone-handoff saga) and delegates a scoped `checkout` of the ≤6 party into the Match. The Match is authoritative only for ephemeral battle state and **never writes durable PER_PLAYER rows or the ledger**. On terminal state it emits a typed `MatchResult`; the **single writer** (the owning Zone on return, or — folded into the `onForfeit` disconnect hook, **not** a separate generic offline channel — a Nest worker) applies durable outcomes through the normal `can()`+`EconomyService` path. No second writer ever exists.
5. **Per-seat visibility** (`viewFilter`) — the opponent's unrevealed bench is redacted before the StateView patch.

`can()` for battle moves degenerates to **`match_seat` participation** ("is this account a rostered seat of *this* Match?") — a genuinely new resource notion, now **first-class** in the scope model (not glossed by a "can() doesn't grow" claim). The real HP writes are `actor=sim` inside `resolveTurn`, so `"authz=engine, legality=game"` holds — honestly, *because* battle effects move to the sim-writer and the player's `can()` check is near-vacuous beyond seat membership.

The genre-defining 90% (type chart, damage math, catch rates, evolution, badges) is **pure module reducer + content**.

---

## 6. Multi-game model

**One engine, many games; per-game deploys.** The engine is *code*. A game is `{ GameModule + content + its own Postgres database + its own Atlas/Moneta/Akasha/Mnemosyne/Mercury/Calliope fleet }`. Games do **not** share a Colyseus fleet or a GPU pool — deploy cadence, battle-GPU curve, and crash blast-radius are independent. The **only** shared runtime is the **control plane**: auth, account directory, billing, global ban list.

**Scoping — four tiers (`game_id` is first-class, not a deployment artifact):**

| Scope | Lives in | Keyed by | Crosses games? |
|---|---|---|---|
| **PLATFORM-GLOBAL** | control-plane DB | `account_id` | **Yes** — identity, entitlements, billing, global bans |
| **GAME-GLOBAL** (canon) | per-game `global` | `game_id` | No — species, type chart, crops |
| **SHARED** (sim) | per-game `sim`/`log` | `(game_id, room_instance_id)` | No |
| **PER_PLAYER** (the save) | per-game `player`/`memory`/`ledger` | `(account_id, game_id)` | No |

**Your account is global; your save is per-game.** `(account_id, game_id)` composite-keys every per-game profile.

**Critical defense-in-depth fix (from the critique):** `can()`'s PER_PLAYER rule (`actor.accountId === resource.ownerAccountId`) is otherwise **game-blind** — cross-game isolation would rest *entirely* on per-game DB topology, so co-locating any shared service for cost (a shared Mnemosyne/Moneta) would silently defeat it. **Therefore `game_id` is a first-class dimension inside the policy chokepoint:** `ctx.gameId` is set from the session's game-scoped token, and `can()` denies any resource whose `game_id` ≠ the session's. Isolation is enforced at the chokepoint, not just by physical separation.

**Identity: one Celestia account, game-scoped sessions.** Log in once → one `account_id` → pick a game. The realtime ticket carries a `game` claim + game-scoped entitlements; each game's `onAuth` rejects any ticket whose `game` ≠ its `gameId`. A Pokémon token can never open a life-sim room. This is an *additive* extension of the frozen `aud:*-realtime` token, ratified via the MUST-13 contract test — not a silent edit.

**Cross-game economy/inventory: NO (a hard default, bordering on an invariant).** Two games are two closed ledgers; a creature is game-B semantics meaningless in game A; withdrawable coin crossing games is a money-transmission nightmare. The only things that cross: identity, social graph, presence, billing, global bans. A future cross-promo is modeled as a **derived PLATFORM-GLOBAL entitlement boolean** game B emits and game A reads — never the asset — **and not built until a cross-promo is committed**.

**Contract versioning — the SDK-doc reconciliation.** SDK.md rejects semver ("one operator, two consumers, one monorepo… a red CI gate + atomic force-update is stricter and cheaper"). Correct for one game; it assumes the two consumers deploy together.

- **Now (two first-party games): monorepo lockstep + a Conformance Test Kit (CTK).** Engine + modules version together; no external semver, no field back-compat. Breaking the `GameModule` interface is one monorepo PR the CTK forces every module to follow in the *same* PR. Each module declares `engineContractVersion`; CI asserts it.
- **Reserved, not built: real semver + N-2 compat + a published contract** — the SDK's deferred "going public" layer, kept a one-way door because the contract is already additive-and-versioned (`event_type@version`, additive handle methods, `protocolVersion`).

**The forever-compat surface the versioning section must not underplay:** engine-owned event schemas (`world_clock`, `economy.posted@N`, custody/match events) are "kept forever" **per game**. Monorepo lockstep + CTK handle forward *code*, but you cannot force-migrate a 2-year-old player's historical log. An engine event-schema bump is a per-game forever-compat obligation; replay must support every historical `@version`. This is an operational cost of event-sourcing-as-truth, carried explicitly.

**GDPR fan-out (gap, now owned):** a per-account crypto-shred/DEK delete must reach **every per-game data plane + the control plane**. A control-plane deletion orchestrator fans out a tombstone to each game fleet and confirms shred before closing the request.

**Per-module conformance (CTK runs in CI, identical for every game):**

```ts
export function runGameModuleConformance(make: () => GameModule) {
  test('every mutating intent routes through can() before execute');            // AUTHZ invariant
  test('resolveResource reads scope/owner from world state, never the envelope');// forgery guard
  test('ctx.gameId is enforced; a resource of another game_id is denied');       // cross-game isolation
  test('every event_type@version has a PURE reducer that round-trips replay');
  test('every enumerate() returns a bounded sim-authored option set (LLM gets an index)');
  test('fungible value moves only via LedgerHandle; non-fungible only via CustodyHandle; no third path');
  test('every room-type declares a valid tick driver + lifecycle; ephemeral rooms replay from the log');
  test('phase-gated rooms hold sealed commits; no committed choice syncs before reveal');
  test('per-seat-filtered rooms call viewFilter; hidden state never reaches a non-owning seat');
  test('tradeable asset kinds carry a stateSchema; transfer only via the escrow saga');
  test('MatchResult commits through the single writer + EconomyService; the Match never writes durable rows');
  test('no module re-declares an engine capability-handle / port name');          // drift kill
}
```

---

## 7. Bake-in-now vs defer, risks, open decisions

### 7.1 The YAGNI line (only the two committed genres justify an extension point)

| Extension point | Verdict | Justified by |
|---|---|---|
| `CelestiaRoom`→`Zone`/`Match` factoring + room-type registry + tick-driver seam | **BAKE NOW** | Pokémon battle ships at launch; 2nd consumer = life-sim instanced interiors/co-op/festivals |
| Sealed-commit barrier (hold + simultaneous reveal) | **BAKE NOW** | committed Pokémon PvP; **API not generalized for auctions/RPS** |
| Per-seat `viewFilter` hook | **BAKE NOW** | hidden-info battle; static per-component sync cannot express it |
| Per-instance `TimerHandle` (deterministic, event-time) | **BAKE NOW** | turn deadlines; also crop/respawn/festival windows |
| Owned-asset custody + `escrowSwap` saga (N9 flip) | **BAKE NOW** | creature trade is a core loop; life-sim gifting too |
| Game-scoped identity + `game_id` first-class in `can()` + `(account_id,game_id)` save key | **BAKE NOW** | required the moment there are two games; defense in depth |
| Per-game deploy topology + GDPR fan-out orchestrator | **BAKE NOW** | the premise of a multi-game engine |
| `GameModule` contract + CTK + four-tier scoping | **BAKE NOW** | the proof the boundary holds |
| Interest-management + visibility as per-room-type opt-in | **BAKE NOW** | battle rooms must not pay for a spatial grid they don't use |
| Cross-kind **opaque-blob** owned-asset store (`player.asset(... state jsonb)`) | **DEFER / reject** | pick **per-module typed rows** (`mod_pkmn.creature`); the blob store is a hedge for uncommitted asset kinds |
| Generic turn/battle **state-machine framework** (`BattleSystem` in the engine) | **DEFER / reject** | give the module only the barrier trigger + sealed hold; the module owns phases/FSM |
| `MatchResult` standalone offline-applier channel | **DEFER / fold** | fold into the `onForfeit`/disconnect hook, not a separate generic channel |
| Generic constraint-container (declared cardinality/ordering) | **DEFER** | team-of-6 / bag limits are module `validate()` rules |
| Generic stat/leveling/progression engine | **NEVER (engine)** | module reducers + content; the engine must not know what a level is |
| Real semver + N-2 compat + published contract | **DEFER** | monorepo lockstep + CTK suffices for two first-party games |
| Cross-game asset/currency bridge (even the derived-boolean entitlement) | **ANTI-GOAL** | boundary violation; not built until a cross-promo is committed |
| Dynamic module loading / plugin registry / rules DSL | **ANTI-GOAL** | untrusted code in the single-threaded TCB |

**Guiding cut:** build what the *committed* turn-based/trade/collect genre forces; refuse every generalization whose only customer is a hypothetical game #3.

### 7.2 Top risks (ranked, incorporating the critique)

1. **Extraction-shaped engine cannot host game #2 (highest).** A naive "extract from the life-sim" engine lacks the room factoring + 5 primitives, which touch the deepest seams; "add later" = TCB surgery in production, violating the no-fork promise. *Mitigation:* this doc makes the canonical contract Worked-B's and schedules all five for game #1, each with a named life-sim second consumer; the CTK fails any module that cannot express a Match.
2. **PvP sealed-commit is a genuine new pipeline stage facet-1 denied.** Without it, PvP is cheatable (moves leak before reveal) or unshippable. *Mitigation:* the barrier is in the canonical pipeline (§3.6) and CTK-tested ("no committed choice syncs before reveal").
3. **The riskiest correctness surface gets zero exercise from game #1.** Atomic cross-session trade + player-in-two-rooms checkout + `MatchResult` single-writer commit, spanning ledger *and* custody, is life-sim-dormant; dupe/double-spend/double-writer bugs would first surface in game #2 production. *Mitigation:* (a) build the escrow saga + checkout *during* game #1 and exercise it with a **synchronous player-to-player item trade in the life-sim** (promote one cozy trade path from the async mailbox purely to exercise the saga), not only the deferred creature trade; (b) a deterministic property-test harness replays randomized concurrent trade/checkout/forfeit interleavings against the saga state machine in CI; (c) the single-writer invariant is CTK-asserted.
4. **"ONE value chokepoint" silently became two authorities + a cross-chokepoint saga.** A direct softening of a locked invariant and the natural home for dupes. *Mitigation:* the invariant is **explicitly amended** (§4.3) to "exactly two chokepoints, one escrow saga with specified two-phase atomicity"; no third path; CTK-asserted.
5. **Hidden-info visibility inexpressible in the static sync model.** *Mitigation:* `viewFilter` per-seat hook (§3.5, §5.1); redaction server-side; CTK-tested.
6. **Single global Clock Authority cannot host a per-match turn clock/timeout/forfeit.** *Mitigation:* tick driver is per-room-type; `TimerHandle` gives per-instance event-time timers without a second clock authority.
7. **`can()` is game-blind; isolation rode deployment topology.** One co-location decision from cross-game leakage. *Mitigation:* `game_id` first-class in the chokepoint (§6); CTK-tested against a foreign-`game_id` resource.
8. **Battle-state durability was contradictory.** *Mitigation:* ruling (§4.2) — turns are durable event-sourced truth; "ephemeral" = process not stream; reconnect replays the turn stream.
9. **Shared control plane is the one cross-game SPOF / breach blast-radius.** The "independent crash blast-radius" claim holds for the data plane only. *Mitigation:* treat the control plane as the highest-availability, highest-scrutiny tier; a global ban must preempt a live per-game session — define the revocation path (short-TTL game-scoped tokens + a push revocation channel each room honors mid-tick) in AUTH.md.
10. **Forever-compat of engine event schemas, per game.** *Mitigation:* replay supports every historical `@version`; schema bumps are additive; a per-game "oldest replayable version" is tracked and gated.

### 7.3 Open decisions

1. **Scope-flip vs active checkout concurrency (§4.3):** confirm the exclusive-lease rule fully closes capture-during-battle for *wild* creatures that another player could also target; specify the loser's rollback.
2. **Life-sim synchronous trade for saga exercise (Risk 3):** decide whether to ship a real cozy synchronous trade or a CI-only harness as the game-#1 exercise of the escrow path.
3. **Global-ban mid-session enforcement latency:** the acceptable upper bound and the push-revocation mechanism (AUTH.md).
4. **Oldest-replayable-version policy:** per-game retention vs snapshotting of ancient logs to bound the forever-compat surface.
5. **Marriage/global-exclusivity (life-sim):** PER_PLAYER "your-version" marriage ships now; a globally-exclusive claim would need a SHARED claim + lease/escrow — deferred.
6. **Shared vs per-game cognition fleet:** cost pressure may tempt a shared Mnemosyne/Moneta; permitted *only* because `game_id`-in-`can()` + DAL hard-scope now make co-location safe — but confirm the GRANT model holds under co-location before doing it.
7. **Private-farm-ahead-of-town-time residual:** the one place the single-player time model does not fully survive the shared-world port (per-instance fast-forward re-syncs on entering town) — accept as an MMO tax or design a reconciliation UX.
