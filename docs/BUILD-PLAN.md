<!-- Generated 2026-10-11 by a multi-agent pass: 4 facets -> critical-path/YAGNI critic -> synthesis. The BUILD sequence, not more design. -->

# BUILD-PLAN.md — Celestia Phase-0 Kickoff / Build Plan

> **Status:** authoritative Phase-0 plan. Design is locked across the 11 docs; this is the *build* sequence, not more design.
> **Locked frame:** GAME-FIRST, ruthless YAGNI. LLM and web3 are **OFF** at v1 (mica-mock in-process; DB-sim COIN). Lean infra: one ~$5 Arm box, docker-compose, Node (NestJS stub + Colyseus) + Postgres 17 + Caddy; Valkey deferred until multi-process.
> **Naming:** published packages `@celestia/*`; the committed Godot codegen file stays `celestia_contract.gd` / autoload `Jupiter` (locked codename, per NAMING/CLIENT-SDK).
>
> ⚠️ **AMENDED by `REALTIME.md` (real-time MMO).** Superseded here — `REALTIME.md` is authoritative where they disagree:
> - the **"offline, no-login, no-users sandbox"** framing is dropped — it's an MMO with players and player storage from the start (the two de-risking spikes still stand; the "no users / no storage" framing does not);
> - **low-tick → 20 Hz** real-time; movement is real-time directional, not tap-to-move;
> - StateView / per-client **AoI → P0-core**;
> - dialogue `<input>` overlay → **dev/tester-console only**;
> - `CelestiaSDK` → **`Jupiter`** (fixed above).

---

## 1. Thesis

The design is done — stop designing. Before committing a line of build code, **prove the two make-or-break risks** that the whole architecture rests on: (1) **Mica calibration over DYNAMIC option sets** (System-1's gates-vs-rankings premise), and (2) the **Godot-web ⇄ Colyseus-via-JavaScriptBridge ⇄ real-Telegram-WebView** transport path (the only client path P0 runs on). These two spikes run **in parallel**, share no people or resources, and **gate everything** — nothing downstream (ledger, event-log, `EconomyService`, villager, real schema, `allow()`, codegen) is committed until both log a **GO / GO-with-mitigation / NO-GO**. Once the gate closes GO, promote the transport spike's keepers into a minimal `@celestia/*` monorepo and **lay the bake-in-now seams into the empty skeleton first** — the one `EconomyService` chokepoint, the event-sourced NUMERIC(38,0) ledger with provenance, the one deny-by-default `allow()`, the 3 ports + composition root, the GameModule boundary, `event_type@version` stamping, dbmate(sole DDL)/Kysely(read-only), the `celestia_contract.gd` codegen, dev-stub auth. Then pour content into the proven mold: deterministic farming/day-clock/COIN that is **fun with the LLM OFF** (a gate, not a hope), then **one** typed-decision villager that recalls yesterday's gift via a recency btree (no embeddings), with dialogue through an HTML `<input>` overlay. Ship the slice to one $5 box inside the real Telegram Mini App.

---

## 2. THE CRITICAL PATH (Day 1 → shippable Phase-0 slice)

A single ordered spine. Items under the same number run concurrently.

1. **(Day 1, FIRST ACTION)** Serve **Mica-4B exactly as P0 will** — llama.cpp `llama-server`, pinned **Q5_K_M** GGUF, **GBNF** grammar → index tokens, logprobs on, behind a `/v1/systemone`-shaped request — and **begin authoring the ~300–800 in-domain labeled frames** across the 5 decision types. (Standalone `ml/` uv harness; needs ZERO monorepo.)
1b. **(Day 1, parallel, different engineer)** Stand up the **bare repo shell** — pnpm workspace + one Colyseus app + Godot client dir + `docker-compose.gaia` (Postgres only) — and a **trivial `HelloState` Colyseus 0.16 room** + a dev plaintext-JSON debug endpoint. This exists only to receive the transport keepers.
2. **Transport spike (keepers):** define GDScript `ITransport` → build **`NativeJsonDevTransport` FIRST** (instant in-editor Play-button loop) → bare `CelestiaSDK` composition root (names the adapter by host mode) → prove in-editor round-trip → `ColyseusBridgeTransport` (colyseus.js reflection, `_held_cbs` retention, single `PROTOCOL_VERSION` in join opts) → single-threaded WebGL2 brotli export → **public HTTPS via Caddy + Cloudflare Pages** → desktop Chrome/Safari → footgun soak (forced GC + delta-proportional marshaling) → **BotFather Mini App** → **real iOS + Android Telegram WebView** + HTML `<input>` overlay → logged **VERDICT**.
2b. **Mica spike (parallel):** SIZE sweep k∈{2..30} + SEMANTIC perturbations → ECE/reliability/MCE/Brier + abstain AUROC + argmax flip-rate per decision-type/size → **one** per-(model,quant) recalibration **TRANSFER** test → logged **VERDICT** (probs-as-gates | rankings | NO-GO). **The verdict sets the room accept-predicate default and what mica-mock must emit; capture the per-type/per-size distributions + recalibration params as a committed fixture.**
3. **GATE CLOSE** — both verdicts logged GO / GO-with-mitigation. If either is NO-GO, **stop** and run that spike's redesign (decision-layer → fixed-enum + rankings; or client/runtime rethink) before any build code.
4. **Promote transport keepers** into a minimal `@celestia/*` pnpm10/Turbo2.3 monorepo (strictly acyclic graph); add a **minimal env read + the real `buildServerContainer(cfg)` driver→class composition root** now that a verdict exists.
5. **dbmate** migrations as **sole DDL owner**: `log.event` (seq+prev_hash chain, REVOKE U/D, `event_type@version`), `log.oracle_call` (HARD), `log.outbox`, `ledger.balance` NUMERIC(38,0), scope-role GRANTs, `CREATE EXTENSION vector` → `@celestia/db` Kysely **introspection-only** (zero DDL).
6. **`@celestia/event-contract`**: `event_type@version` registry + the **pure** `apply(state, event, oracleLookup)` reducer (integer money, seeded PRNG from `event.seed`, no wall-clock) + a replay harness that reads logged `log.oracle_call.chosen_idx` and **never re-infers**.
7. **C-M0 null walking skeleton:** `VillageRoom` + 250ms authoritative tick emitting `world_clock@1` (in-process clock authority) + 100ms patchRate + an avatar that joins/moves via `NativeJsonDevTransport` + a headless replay that reproduces one logged day **byte-identically**. Spine proof, zero game content.
8. **The chokepoints, before the first COIN write:** `@celestia/ledger-contract` `StandardEconomyService` (UNIQUE idempotency_key → same `Receipt` on replay, provenance tag, single-sided deltas, deterministic insufficient-balance refusal) + `@celestia/authz` pure `allow()` deny-by-default + `@celestia/core` intent pipeline (`resolveResource → allow() BEFORE enumerate → reserve → execute`, re-run on NPC apply).
9. **C-M1 deterministic systems — "fun with the LLM OFF" as a GATE:** day-clock/sleep via `day.advanced@1`, energy budget behind `allow()`, farming (`crop.*@1` advanced by day events inside `apply()`, never wall-clock), COIN via `economy.posted@1`, fixed gift tables as versioned data, one calendar-pinned festival. Verify cozy with **zero AI**; a multi-day session replays deterministically.
10. **Wire the Mica verdict into code:** commit the recorded fixture; **mica-mock** emits the verdict-shaped `{options[{index,p}], argmaxIndex, abstainP, seed, calibrationVersion}` over the **dynamic** `allowedAnswers`, seeded from the fixture, logged to `log.oracle_call`; **land the accept-predicate default in `@celestia/core`'s `acceptPolicy` before the drain loop reads it.**
11. **C-M2 the ONE villager:** author bible + **fallback schedule DSL first** (degradation baseline) → off-tick dispatch (`perceive → enumerate [SAME shared fn as the intent path] → dispatch cid NO-await → semaphore → cognitionInbox`) → drain on a later tick (staleness guard → accept policy → **RE-VALIDATE legality NOW** → execute → `npc.decided@1`). Prove a slow/killed mock → deadline→abstain→DSL and the tick never stalls; the day replays from logged `chosen_idx`.
12. **C-M3 dialogue + recall (culmination):** `DialogueClient` (HTML `<input>` overlay + `LineEdit` fallback strategy) → `give_gift` → `interaction.gift@1` + a **btree-keyed** memory projection row → recall-on-dialogue via the **recency/salience btree** (NO embeddings/ANN) → `GenerativeProvider` s2-mock streams text through the overlay → **UNTRUSTED `candidate_intents` RE-VALIDATED** through the same TCB pipeline → `dialogue.turn@1`.
13. **Accrete the aggregate CI gate** as each seam lands, then **deploy the same `docker-compose.yml`** to the ~$5 Arm box + Caddy ACME + Cloudflare Pages prod + Telegram Mini App — testers play several in-game days in the real WebView and ask for "one more day."

---

## 3. MILESTONES (grouped; tasks + EXIT CRITERIA, ordered per the critique)

> **Ordering note (per critique):** the bake-in-now seams are laid into the *empty* skeleton **before** game content (M2), not after it. "Seams solid before content" is the point — `EconomyService`/`allow()`/reducer must exist before the first COIN write, and the spine must replay before a crop exists.

### M0 — Repo shell + bootable infra (minimal; receives the spike keepers)

Deliberately *not* the full monorepo. Just enough to host the transport keepers and the spike's public-HTTPS gate.

- Bare pnpm 10 + Turbo 2.3 workspace (`node>=22`, `.node-version`, `tsconfig.base`); **one** Colyseus 0.16 app, Godot 4.5 `client/` dir, `tools/gen-gdscript/`.
- Trivial `HelloState` room (LocalPresence/LocalDriver, dev-stub `onAuth`, `move`/`echo`) + a dev-only plaintext-JSON debug endpoint speaking the same protocol. **NOT** the real `@colyseus/schema` game state.
- `docker-compose.gaia.yml` = `pgvector/pgvector:pg17` only, pinned, `TZ=UTC`. **No Valkey** (deferred to multi-process). **No nestjs-api, no cognition-gateway** (cognition is in-process; the gateway split is P1).
- The **minimal public-HTTPS serving slice pulled forward**: `Caddyfile` (auto-TLS), Cloudflare Pages target, a BotFather bot + Mini App URL — because the transport spike's true gate (real phones) requires it *before* the gate closes.
- Single `PROTOCOL_VERSION` constant + the tiny codegen → `celestia_contract.gd`; CI runs only `git diff --exit-code` on it + TS==`.gd` equality. (The rest of the aggregate gate accretes later.)

**EXIT M0:** `pnpm i` + `turbo run build` green on the shell; the `HelloState` room boots; the exported web build serves over public HTTPS and opens as a Mini App from BotFather. Nothing game-shaped exists yet.

---

### M1 — THE TWO DE-RISKING SPIKES **[GATE — stop if they fail]**

Two tracks, parallel, zero contention (Mica = 1 ML/server eng + 1 rented GPU, no client; Transport = 1 client/netcode eng + Godot + two real phones). **This is the only thing on the critical path right now.**

**Track A — Mica calibration (standalone `ml/` harness; no monorepo):**
- A1 Serve Mica-4B exactly as P0: `llama-server`, pinned **Q5_K_M**, GBNF→index tokens, logprobs, `/v1/systemone`-shaped request; run JEV through the identical harness as a comparison column. Pin the GGUF (sha256) — **do not** build the vLLM-cutover `calibration_version` manifest pipeline now.
- A2 Author ~300–800 in-domain labeled frames from P0 villager content across the 5 decision types: routine/next-action (nominal, dynamic), gift reaction (ordinal 5-pt), social approach/ignore (gate), memory worth-remembering (binary gate), dialogue-act (large nominal); include "no-correct-answer" instances for abstain. *(This is the schedule long pole — start day 1.)*
- A3 Sweep SIZE k∈{2,3,5,8,12,20,30} and SEMANTICS (order-permutation, injected distractors, near-duplicate paraphrase, abstain present/absent, nominal vs ordinal, numeric-index vs letter-label encoding).
- A4 Metrics per decision-type/size-bucket: ECE (10–15 bins) + reliability diagrams on top-1, MCE, Brier; abstain AUROC + abstain ECE; fallback metrics (top-1/top-3 acc, ranking correctness, argmax flip-rate under permutation).
- A5 Fit **one** per-(model_file, quant) recalibration (temperature/vector scaling); test whether a single fit **transfers** across the sweep, or must refit per size. *(That is the whole question — do NOT build a per-size table or a production `calibration_version` pipeline.)*
- A6 **Verdict + handoff:** write GO (probs-as-gates) / GO-rankings-only / NO-GO; **capture the per-type/per-size distributions + recalibration params as a committed fixture** for mica-mock; set the two baked-in defaults (room accept-predicate; mica-mock emit shape). Commit the eval harness (future shadow-eval tool).

**Track B — Transport, Godot-web ⇄ Colyseus ⇄ Telegram WebView (keepers, not throwaway):**
- B1 Define GDScript `ITransport` (connect / sendIntent / onAdd·onChange·onRemove → signals / mandatory `opened(server_tick, clock_offset_ms)`).
- B2 Build **`NativeJsonDevTransport` FIRST** (JSON over `WebSocketPeer`) — instant in-editor loop. Wire the **bare `CelestiaSDK`** autoload (only place an adapter is named; `editor_dev`→native, `web`/`telegram`→bridge). Prove in-editor round-trip from the Play button: WASD/tap → `move`, render from state, interpolate render-time via `opened()` offset, never advance canonical tick locally.
- B3 Build `ColyseusBridgeTransport`: HTML shell loads colyseus.js 0.16 + telegram-web-app.js via JavaScriptBridge; state via colyseus.js **reflection** (no GDScript codegen); bind **DELTAS only**. **FOOTGUN 1:** retain every `create_callback()` ref in `_held_cbs`. Send `PROTOCOL_VERSION` + stub `{token,ticket}` in options, never the wss URL.
- B4 Export single-threaded WebGL2 (no COOP/COEP — conflicts with the telegram script), brotli; serve build + colyseus.js + telegram script behind **Caddy TLS on the public HTTPS URL** (M0 slice), not localhost. Validate round-trip + delta-bind in desktop Chrome + Safari.
- B5 **FOOTGUN 2 soak:** multi-minute run + forced GC → zero dropped onChange; instrument hop-count + push a large state → per-tick cost is **delta-proportional, never full-state-per-tick**.
- B6 **The true gate:** BotFather Mini App → open in **real Telegram on real iOS (WKWebView) AND real Android**. Validate WASM cold-start on throttled cellular, WebGL2 render, WS connect + round-trip, `WebApp.ready()`/viewport/theme alongside the bridge, the shipping **CSP breaks neither the bridge nor the telegram script**, background→drop→reconnect, `protocolVersion` forced-mismatch → force-update path.
- B7 Validate the **HTML `<input>` dialogue overlay** (not `LineEdit`) in the Telegram WebView on both platforms: focus + virtual keyboard + typed text reaches the room.
- B8 **Verdict + keepers:** log GO / GO-with-mitigation / NO-GO; log the single-threaded + no-COOP/COEP decision and the exact working CSP. **Keep `ITransport` + both adapters + the minimal room + `CelestiaSDK` + the single `PROTOCOL_VERSION`** — these seed the real P0 loop.

**EXIT M1 (GATE CLOSE):**
- **Mica PASS (probs-as-gates GO):** top-1 ECE ≤ 0.10 (target ≤ 0.05) held across all sizes up to k ≤ 12 and across nominal+ordinal; no systematic over/under-confidence a single temperature fit can't remove; abstain AUROC ≥ 0.75; argmax flip-rate ≤ 5%; **one** recalibration pulls ECE ≤ 0.05 **and transfers** across the sweep. Deliverables: reliability-diagram report, verdict, accept-predicate + mica-mock semantics decided, committed distribution fixture, committed eval harness.
  - **KILL:** ECE > 0.10 after recalibration, OR calibration is size-dependent, OR argmax is position-dependent, OR abstain AUROC ≤ 0.6 → redesign the decision layer (fixed-enum + rankings; room flips to rankings-mode; mica-mock emits rank-only) **before any build code.**
- **Transport PASS:** a sprite moves under server authority through colyseus.js-via-bridge, rendered in the single-threaded WebGL2 export, **inside the real Telegram WebView on both iOS and Android**; the `<input>` overlay works there; the same scene runs via `NativeJsonDevTransport` from the editor Play button; both footguns demonstrably handled; cold-start/WASM budget met with the telegram script + CSP and no COOP/COEP; `protocolVersion` handshake + forced-update exercised.
  - **KILL:** bridge can't reliably drive colyseus.js in the WebView, OR WS can't be sustained, OR the `<input>` overlay can't work there, OR cold-start blows budget, OR GC-drop / full-state marshaling can't be prevented → rethink client/runtime before building anything.
- **Both verdicts logged.** If both GO (or mitigations adopted as logged decisions), the build is unblocked and the Mica verdict has already fixed the accept-predicate default + mica-mock emit shape. **If either is NO-GO, STOP.**

---

### M2 — Bake-in seams solid (foundation laid into the empty skeleton)

Promote the transport keepers, then lay every ruinous-to-retrofit seam at its *minimal* shape **before any game content**. (This is the critique's reordering: seams precede content.)

- **Promote + wire:** fold the transport keepers into the acyclic `@celestia/*` graph (`apps → composition → {core, adapters-*, game-cozy} → ports → leaf-contracts`). Add a **minimal env read** (not the full discriminated-union loader — only mocks exist) + the real `@celestia/composition.buildServerContainer(cfg)` single driver→class switch + `wireColyseus` process-singleton container (never from client join options).
- **dbmate (sole DDL owner):** `CREATE EXTENSION vector`; ENUMs; GRANT scope-roles (global/sim/player/log/memory); **REVOKE UPDATE/DELETE on `log.event`**; seq+prev_hash hash-chain trigger; tables `log.event` / `log.oracle_call` (HARD) / `log.outbox` / `ledger.balance` NUMERIC(38,0). A `dbmate up` one-shot container gates app start (identical dev + CI). `@celestia/db` = Kysely + kysely-codegen, **introspection-only**. *(Leave the `fence_token` column; do not enforce — single process = single writer.)*
- **`@celestia/event-contract`:** `event_type@version` registry + the pure `apply(state, event, oracleLookup)` reducer (integer money, seeded PRNG, no wall-clock) + replay harness reading logged `chosen_idx`.
- **C-M0 null skeleton:** `VillageRoom` + two-clock tick (`setSimulationInterval(onTick,250ms)` ≤8ms, never awaits; `setPatchRate(100ms)` binary diff); in-process clock authority emitting `world_clock@1`; avatar joins/moves via `NativeJsonDevTransport`; headless replay reproduces one logged day byte-identically.
- **`@celestia/ledger-contract`** `StandardEconomyService` (the interface + the one impl over a Kysely `LedgerRepo` — a module, not a port): `credit/debit/transfer` with `Minor=bigint` / NUMERIC(38,0) at rest / decimal-string wire; `AssetId`=COIN only; closed `ReasonCode`; one `economy.posted@1` per call with idempotency key + provenance tag; `UNIQUE(idempotency_key)` → same `Receipt` on retry/replay; balance is a reducer projection in the same txn; deterministic insufficient-balance refusal.
- **`@celestia/authz`** pure synchronous `allow(actor, action, resource, ctx)` with closed `Action`/`DenyCode` unions + default→deny; P0 rule = `PER_PLAYER` ownership (`actor.accountId === resource.ownerAccountId`) + GLOBAL-write-always-deny; dev-stub single account.
- **`@celestia/core` intent pipeline:** `authStub → resolveResource → allow() (deny-by-default) BEFORE enumerate → enumerate(sim) → reserve → execute`, re-running `allow()` on NPC/System-2 apply; `resolveResource` reads scope/owner **only from authoritative room/DB state**, never the client envelope. **Commit the accept-predicate default (from the Mica verdict) into `acceptPolicy` here now**, ahead of the drain loop.
- **GameModule boundary:** `@celestia/game-cozy` = module #1; engine packages stay genre-neutral and must never import it. Add the dependency-cruiser arch-test.

**EXIT M2:**
- Flipping one config line swaps mica-mock↔(stub) with zero call-site changes; only `CelestiaSDK` + the adapter name a concrete adapter class.
- App refuses to start while a migration is pending; a Postgres testcontainer proves `UPDATE/DELETE log.event` is rejected and the hash chain links; Kysely issues zero DDL and types compile.
- A recorded session replays from genesis to a byte-identical `ledger.balance` + projection hash twice, reading logged `chosen_idx`, never re-inferring; each `event_type@version` has a snapshot test.
- Same `idempotencyKey` posted twice → exactly one `economy.posted@1` + the same `Receipt`; `EconomyService` is provably the only `economy.posted@N` emitter; COIN is the only `AssetId`.
- CI asserts `resolveResource` never reads scope/owner from the envelope AND every mutating intent routes through `allow()` before `execute`; cross-owner intent denied with a typed `DenyCode`; unknown slug → deny.
- Arch-test goes red if any engine package imports `@celestia/game-cozy`; the engine builds with the game module absent.
- Avatar walks under the 250ms server-authoritative tick; one logged day replays byte-identically; the pre-gate CI checks (codegen diff + protocolVersion/structural-hash equality) stay green.

---

### M3 — Deterministic game: "fun with the LLM OFF" (**the gate**)

No NPC agency yet — the villager may be absent or a static scheduled prop. Fun-with-LLM-off is a gate, not a hope: if this isn't cozy on its own, no NPC saves it.

- Day-clock + sleep: a sleep intent advances the day via `day.advanced@1`/`world_clock@1` (clock-authority event, not a local timer); crops + festival key off these inside `apply()`.
- Energy: a per-player scalar depleted by actions, restored by sleep, enforced behind `allow()`; enumerate-membership refuses unaffordable actions.
- Farming: `CropPlot` schema + plant/water/harvest intents; growth advanced deterministically by day events in `apply()` (never wall-clock); `crop.planted@1 / crop.watered@1 / crop.harvested@1`.
- COIN through the one `EconomyService`: `buy_seed`/`sell_crop` → `economy.posted@1` (bigint, provenance). The sim computes every value; the client never sends an amount.
- Fixed gift tables as versioned sim data (item → reaction tier); no NPC consumes them yet.
- One calendar-pinned festival (`festival.*@1`) firing deterministically on its day. No LLM.

**EXIT M3:** a tester plays several in-game days (till/plant/water/sleep/harvest/sell/buy under an energy budget + COIN balance) and finds it satisfying with **zero NPC AI and zero LLM**; the festival fires on its day; every value flows through `EconomyService`; a multi-day session replays deterministically.

---

### M4 — The ONE typed-decision villager + recall + dialogue

- **mica-mock from the fixture:** emits the verdict-shaped `{options[{index,p}], argmaxIndex, abstainP, seed, calibrationVersion}` over the **dynamic** `allowedAnswers`, **seeded from the M1 captured distributions**, every call logged to `log.oracle_call`. *(Without this fixture handoff the mock's probabilities are fiction and believability can't be judged.)*
- **Bible + fallback schedule DSL authored FIRST** (the degradation baseline): personality, voice, backstory, core want, gift table, DSL routine.
- **NPC brain** = server-only plain object (mood, perception, pending-decision cid, memory ring) — **not on the wire**. Only `NpcPublic` (≤7 fields: pos/anim/current-action label) syncs.
- **Off-tick dispatch** (K=1): `perceive → enumerate affordances (SAME shared fn as the intent path) → dispatch(cid, frame, allowedAnswers) to SystemOneProvider with NO await` (semaphore `tryAcquire`; fail → abstain). Results land in `cognitionInbox` on a later tick.
- **Drain on a later tick:** staleness guard (tick_epoch/cid) → room-TCB accept policy (`probs-as-gates | rankings`, defaulted from the verdict) → **RE-VALIDATE legality NOW** → execute → `npc.decided@1`. Abstain/stale/out-of-range → schedule-DSL fallback.
- **Dialogue + recall:** `DialogueClient` (HTML `<input>` overlay + `LineEdit` native fallback strategy); `start_dialogue` opens the slot; `give_gift` → `interaction.gift@1` + a btree-keyed memory projection row `(npc_id, player_id, day, salience)`; opening a conversation pre-fetches scoped memories via the **recency/salience btree** (immediately consistent, **no embeddings/ANN/nomic**) → `GenerativeProvider` (s2-mock, gets no pgvector creds / no `player_id`) streams text through the overlay; **UNTRUSTED `candidate_intents` RE-VALIDATED** through the same TCB pipeline; `dialogue.turn@1`.

**EXIT M4 (= Phase-0 functional bar):**
- The villager runs a believable routine chosen by **typed decisions, not scripts**; it observably varies with world state; every routine decision is logged to `log.oracle_call`.
- In dialogue it recalls a prior interaction (yesterday's gift), served **purely by the btree** — no embeddings, no ANN, no nomic model present.
- A full in-game day replays byte-identically from the log reading logged `chosen_idx`, **never re-running inference**.
- An artificially slow/killed mica-mock triggers deadline→abstain→schedule-DSL and the 250ms tick **never stalls**.
- **Fun-with-LLM-OFF verified as a gate:** with mica-mock forced always-abstain (villager on the DSL) AND s2-mock reduced to templated lines, the farming/energy/day-clock/COIN/festival loop is still cozy.

---

### M5 — Deploy the slice to the $5 box + Telegram WebView (+ complete the aggregate CI gate)

- **Accrete the aggregate CI contract gate** to full strength (each check landed with its seam): `celestia_contract.gd` git-diff + protocolVersion/structural-hash equality, `event_type@version` snapshots, closed `ReasonCode` enum, replay-determinism, `allow()`/`resolveResource` routing tests, engine↛game arch-test, cognition conformance suite, `@colyseus/testing` room smoke, and the **cross-client golden-trace guard** (scheduled here, with the colyseus-bridge keeper, so the native-JSON dev/replay path can't silently diverge from the binary schema path). Make it the single required merge check.
- **Deploy the SAME `docker-compose.yml`** (migrate → pg → colyseus + caddy; nestjs-api is at most a health stub, no `/api` logic) to a Hetzner Arm (~€3–4, favor RAM ~1 vCPU/2–4 GB) or Oracle free Arm, with a prod `.env` (real domains + ACME email). Small-RAM Postgres tuning (`shared_buffers ~128MB`, low `max_connections`, swap). Caddy auto-TLS on `play.`.
- **Cloudflare Pages** prod domain + **Telegram Mini App** pointed at it (offloads client bandwidth off the box). Free uptime ping.

**EXIT M5 (= Phase-0 slice shipped):** `docker compose up -d` on a bare box brings the full stack live under TLS; the Godot web build loads from Pages inside the **production Telegram Mini App**; all CI contract gates are the single green required check; testers play several in-game days of the full slice in the real WebView and **ask for "one more day,"** and at least one describes the single villager as feeling like a real person after an unscripted routine moment.

---

## 4. DO NOT BUILD YET (explicit deferred list)

**Spike discipline (pre-GATE):** no real `@colyseus/schema` game state (use `HelloState`); no real Mica in-process in the game (standalone bench only); no `EconomyService`/ledger/`allow()`/dbmate/Kysely/pgvector during the spikes; no per-size recalibration tables or production `calibration_version` pipeline; no full NPC bible; no JEV/System-2/GenerativeProvider path in the spikes; no R2 GGUF cutover-manifest ceremony (just pin the Q5_K_M + sha256).

**Auth / services:** real auth beyond **dev-stub `onAuth`** — no NestJS auth/accounts, Discord OAuth+PKCE, realtime ticket, `/play`, `/internal/reserve` HMAC, `JwtSigningKeyProvider`, `AuthClient` web/telegram adapters. No `apps/nestjs-api` logic (health stub at most) and **no `apps/cognition-gateway`** — cognition stays an in-process module behind the frozen `DecisionFrame`; no `CognitionClient` port, no gRPC/ts-proto/HTTP hop.

**Memory / ML:** no embeddings, nomic model, pgvector ANN/HNSW/IVFFlat index, `EmbeddingProvider`, or `MemoryStore` port — recall is **recency/salience btree only** (store raw `text_enc` for later re-embedding, build nothing on it). No ECE/persona-regression eval harness in the build phase (that's a sibling eval facet fed by `log.oracle_call`). No real llama.cpp on the Mac (mica-mock is DEFAULT; real GGUF only under the compose `gpu` profile on the NVIDIA box). No vLLM self-host, no `base_url` swap of adapters, no JEV escalation / model-routing / batcher / decision cache.

**Economy / web3:** no double-entry / paired postings (single-sided deltas; a transfer is two deltas in one txn); no `hold/capture/release`, `purchase`, `convert`, `payout`, `mint`, `withdraw` (not even signatures); no second asset (no GEM); no `ChainAdapter`/`SignerPort`/`PaymentRail`/`ComplianceGate` (the chokepoint is their future host, built absent); no provenance **enforcement** (tag stored, not validated); no web3/on-chain anything.

**Authz surface:** no staff/admin Actor kinds, 5-role RBAC, `authz.restriction`/sanction records, SoD dual-control, impersonation, admin console (branches exist as closed-union placeholders that deny, unexercised); no `authz.audit@1`/`staff.action@1`.

**Concurrency / data:** no fence-guarded multi-writer append (leave the column, don't enforce); no `log.event` partitioning, snapshot/compaction (replay from genesis); no Valkey/Redis as a hard dep (behind an interface, off until multi-process); no `@colyseus/proxy`/uWS/multiple Colyseus processes/StatefulSet routing; no BullMQ (outbox drained by `setInterval` + `FOR UPDATE SKIP LOCKED`); no `LedgerStore`/`IDatabase`/`IEventBus` generic data-layer ports; no ORM near DDL.

**Infra / ops:** no K8s/Helm, managed Postgres, PgBouncer, read replicas; no Prometheus/Grafana/Tempo/Langfuse-as-infra; no External Secrets/sealed-secrets; no CDN beyond the static web build + backups; no Nx / Turbo remote cache; no everything-in-compose for the daily loop (kills hot-reload — infra-in-compose + app-on-host). **Backups/restore-drill/small-RAM tuning/uptime ping are deferred to end-of-P0/P1** — an offline, no-login, single-NPC sandbox has no accounts or durable user data worth a DR drill on the critical path (cheap to add later).

**Client / content:** no native/desktop/APK Godot client, no native GDScript `@colyseus/schema` binary decoder, no Android TWA/WebView wrapper, no iOS native build (Android TWA is P1); no reconnect/backgrounding UX polish; no full `celestia_contract.gd` codegen beyond the constants + `PROTOCOL_VERSION` during the spike; no OpenAPI→GDScript generator / REST surface; no published `@celestia/*` packages / semver / plugin loader (anti-goal). **No more than ONE villager** — the 4-NPC / 28-day-season / 3-beat-arc content is a *repeat* of M4 authoring over the same mechanism, not a new system; keep it off the skeleton's critical path. No quest/world/event generation, no DSL director/validator (the one festival is hand-authored and calendar-pinned).

---

## 5. THE SINGLE FIRST ACTION

**Stand up Mica-4B served exactly as P0 will serve it** — llama.cpp `llama-server`, the pinned **Q5_K_M** GGUF, a **GBNF** grammar constraining output to index tokens, logprobs on, behind the `/v1/systemone`-shaped request — **and immediately begin authoring the in-domain labeled eval frames** from the Phase-0 villager content (start with ~100 routine + gift-reaction frames).

**Why this and nothing else first:**
1. **Most upstream, most ruinous risk.** A Mica NO-GO forces a decision-layer *redesign* (probs-as-gates → fixed-enum + rankings) that invalidates the room accept-predicate default and the mica-mock emit shape **before a line of either is written**. It must resolve first.
2. **It is the schedule-dominating long pole.** Authoring the ~300–800 labeled instances is days of human labeling — it must start on Day 1 or it serializes everything behind it.
3. **The serving config must mirror P0 exactly** or the ECE numbers don't transfer.
4. **It blocks on nothing** — zero monorepo, zero client, a standalone `ml/` uv harness.

Kick the **transport hello-world in parallel** with a different engineer (bare repo shell + trivial `HelloState` room + `NativeJsonDevTransport`); the two spikes share no people or resources. But Mica serving-plus-authoring is the action that gates the furthest-reaching, most-ruinous-to-retrofit decision.

---

## 6. Exit = Phase 0 proven

Phase 0 is proven when all three hold simultaneously:

- **Fun with the LLM OFF** — with mica-mock forced to abstain (villager on the schedule DSL) and s2-mock templated-only, the farming/energy/day-clock/COIN/festival loop is cozy and testers ask for "one more day." The game stands without the AI.
- **Calibration holds** — Mica's probabilities over dynamic option sets are calibrated as *gates* (or the logged mitigation — rankings-mode — is adopted); mica-mock emits the verdict-shaped distributions from the committed fixture, and a full day replays byte-identically from logged `chosen_idx` without ever re-inferring. The one villager runs a believable typed-decision routine and recalls yesterday's gift via the btree alone.
- **The integration path works** — a server-authoritative round-trip runs through colyseus.js-via-JavaScriptBridge in the single-threaded WebGL2 export **inside the real Telegram WebView on both iOS and Android**, the `<input>` dialogue overlay works there, and the identical netcode iterates in-editor over `NativeJsonDevTransport`; the slice is deployed from the one `docker-compose.yml` to a ~$5 Arm box behind Caddy TLS + Cloudflare Pages.

All bake-in-now seams are in place at minimal shape (one `EconomyService` chokepoint, event-sourced NUMERIC(38,0) ledger with provenance + idempotent replay, one deny-by-default `allow()`, 3 ports + composition root, GameModule boundary, `event_type@version` stamping, dbmate/Kysely split, `celestia_contract.gd` codegen, dev-stub auth), guarded by a single required aggregate CI contract gate — so every Phase-1 addition (a second villager, real auth, embeddings, multi-process, web3) is content poured into a proven mold, not a retrofit.
