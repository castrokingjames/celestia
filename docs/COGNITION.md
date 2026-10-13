# COGNITION.md — How the LLM Integrates Across Celestia

> Status: architecture-locked. Reconciles PLANNING (role c: world/quest/event generation), ARCHITECTURE (Cognition Gateway + three invariants), WEB3 / WEB3-READINESS (deterministic economy authority; template-based generation; human-in-loop + kill switch for shared mutation), PLATFORM (GameModule declares schemas + content), TECH-STACK (Mica S1 / hosted→vLLM S2; calibration-over-dynamic-option-sets as the unproven keystone). **Companion:** `DECISIONS.md` — the decision *mechanism* underneath every system here (the pgvector→S1→S2 cascade, criteria/calibration, cadence/plan-and-execute, and the seed→record→re-teach→re-seed flywheel).

---

## 1. Thesis — the LLM is cross-cutting intelligence, not a chat feature

Celestia's LLM does not live in a dialogue box. It is a **decision/generation service that every game system calls the same way** — behavior, economy, events, quests, and world reactivity all route through one **Cognition Gateway**. Dialogue is one *minor, strictly one-way* surface (NPCs emit contextual lines; **there is no chat box and no player free-text into any model**), not a privileged feature and not the point.

There is exactly one pattern, used identically everywhere:

- **System-1 (Mercury / Mica-4B):** a typed decision — pick an **index** from a *sim-authored* option set, returned as a calibrated probability per option plus an `abstain_p`. **No free text, no numbers, no new options.** This is the in-the-loop mode: NPC behavior, a vendor's price-*tier*, whether/when to fire an event, whether to escalate to S2, which pre-capped reward-*tier*. Fast (~54ms), batchable, local, same-AZ.
- **System-2 (Calliope / hosted Claude → self-host vLLM):** schema-validated **structured generation over a vetted human-authored DSL/template** — quest/event parameters, one-way NPC lines. Sparing, costly, never on the <100ms path.

And one law binds both modes, in every system, forever:

> **The LLM proposes within sim-authored bounds; the deterministic TCB (the Colyseus room) validates and owns all state. The LLM never writes state** — it never mints currency, never fires an unvalidated event, never grants an arbitrary reward, and is never an authz principal. Its output is UNTRUSTED and re-enters the same intent pipeline a player action takes.

Everything below is this one pattern instantiated five times, hardened against the exploits found in adversarial review.

---

## 2. The Unifying Pattern — the Cognition Gateway contract

### 2.1 The Gateway

A stateless Node service that batches, routes (a **deterministic config table**, never model-chosen), caches, and holds model credentials. It holds **no pgvector credentials** and **never receives a caller-supplied `player_id`**. Game code never opens a socket to a model; it only ever touches cognition through the `CognitionHandle` capability a `GameModule` is granted.

- **Mercury (S1):** Mica-4B GGUF Q5_K_M via llama.cpp + a GBNF grammar that can only emit index tokens + logprobs. vLLM at P2.
- **Calliope (S2):** `claude-haiku-4-5` (routine) / `claude-sonnet-5` (high-stakes) behind a `GenerativeProvider` with persona-prefix prompt caching; self-host vLLM at the ~1–2k CCU crossover.
- **Mnemosyne (RAG):** scoped per-player recall, filtered **inside the TCB** — never by the Gateway.

### 2.2 The S1 contract (`POST /v1/systemone`)

```
req  { cid, schema, question, allowed_answers:[...],   // sim-authored enum; grammar-constrained to 0..n-1
       frame:{npc,clock,needs,mood,loc,sched,nearby[bounded],rel,inv,gameContext}, deadline_ms, route_hint }
resp { cid, options:[{index,p}], argmax_index, abstain_p, seed, calibration_version, model }   // NO text
```

The **accept/threshold policy lives in the room, not the Gateway** — flip probs-as-gates ↔ probs-as-rankings globally by config (this is what makes the calibration fallback a config flip, not a redesign).

### 2.3 The S2 contract (`POST /v1/generate`, SSE)

```
req  { cid, spec:{ personaPrefix, constitution_version, recall:MemoryHit[]/*TCB-prefetched, scoped*/,
                   dsl:{templateId,slots,grammar}, allowedIntents:JsonSchema }, deadline_ms, stream:true }
resp  token stream (display only) + final.candidate_intents[]   // UNTRUSTED; re-validated as intents
```

### 2.4 The universal flow (every system, both modes)

```
ANY SYSTEM (behavior · price-tier · event trigger/params · quest draft)
  │ (1) ENUMERATE a finite sanctioned option set   OR   AUTHOR a DSL/template draft   ← sim-authored bounds
  ▼
 buildDecisionFrame() / buildDialogueRequest()  → frozen proto FRAME (+ TCB-scoped MemoryHit[])
  │ (2) cognition.decide(schema,subject,deadline) [S1]  |  cognition.converse(spec) [S2]
  │     dispatch — NO await; off the 250ms tick ─────────────────────────────┐
  ▼                                                                          │ timeout / breaker /
 ╔═══════════ COGNITION GATEWAY (stateless) ═══════════╗                     │ out-of-range idx / stale cid
 ║ batch · deterministic ROUTE table · cache · creds   ║                     │ / abstain_p>thresh
 ║ NO pgvector creds · NO caller player_id             ║─────────────────────┤
 ║  Mercury/S1 → Mica-4B (GBNF→index+logprobs ~54ms)   ║                     ▼
 ║  Calliope/S2 → Claude→vLLM (SSE stream ~6s)         ║            (F) ABSTAIN → SCRIPTED
 ╚═════════════════════════════════════════════════════╝             (deterministic fallback;
  │ (3) PROPOSE {index, calibrated p}  |  typed intents / DSL draft    always degrade toward determinism)
  ▼        └──────────────── UNTRUSTED ────────────────┘
 cognitionInbox mailbox (tick N+k) ─ staleness guard on cid ────────────────┘
  │ (4) VALIDATE via the SAME pipeline as a player intent:
  │     actor={kind:'sim'} · RE-ENUMERATE NOW · can() · (S2: re-validate each intent;
  │     offline gen: Director/Validator = schema-valid + completable + economy-safe + canon-consistent)
  ▼
 (5) EXECUTE & OWN — the sim computes ALL numbers; store/ledger/custody via caps
  ▼
 (6) LOG — fenced log.event + compact log.oracle_call{chosen_idx, seed, logits_hash, model@ver, calib_ver}
  │                                       └─ REPLAY reads chosen_idx; NEVER re-runs inference
  ▼
 ack / rel_delta (per-player) / dialogue.token (per-client)
```

### 2.5 The invariants, made structural

- **enumerate → index.** `enumerate(r,w,actor)` authors the finite legal set; on apply the room **re-enumerates NOW** and drops any index no longer in the current set. A fully prompt-injected model can at most re-weight *sanctioned* options inside its own session.
- **typed-intents-only.** S2 text mutates state solely via re-validated typed intents; raw text never writes state and never promotes to canon.
- **abstain → scripted.** Deadline / breaker / out-of-range / stale `cid` / `abstain_p`>thresh → deterministic fallback. The ladder always lands on determinism.
- **never an authz principal / never writes state.** The engine sets `actor={kind:'sim'}` itself; the model is never assembled into an Actor; cognition holds **zero grant on `ledger.*`** and cannot import `@celestia/ledger-contract`.

### 2.6 Two cross-cutting hardenings from review (apply everywhere)

- **`cid` must disambiguate co-present players.** `cid=(room, tick_epoch, subject, schema)` collides when two players hit the same NPC/schema in one tick, and the Gateway holds no `player_id` to break the tie — exactly the thundering-herd condition we call a known wound. **Fix:** the engine includes an opaque per-session `interaction_token` in `subject` (`subject = npc_id#interaction_token`), minted in the TCB, so each request routes back to its originating interaction without the Gateway ever seeing a real player id.
- **The oracle log is OFF the durable-before-ack path.** Writing a full logits vector synchronously with every behavior decision would put a DB write on the highest-QPS critical path and dwarf inference in storage. **Fix:** `log.oracle_call` records a compact `{chosen_idx, seed, logits_hash}` (+ `model@ver`, `calib_ver`), batched async; the full vector is captured only under a debug/shadow flag. **Only the ledger stays on the strict durable-before-ack path.**

---

## 3. Per-system integration

| System | LLM proposes | Mode | Sim validates & owns | Deterministic fallback |
|---|---|---|---|---|
| **Behavior** | index into `enumerate()` action set | S1 | enumerate-legality, re-enumerate-on-apply, all deltas, per-NPC/day item-grant budget | utility/FSM scripted schedule DSL |
| **Economy (sell/stock)** | price-**tier** idx; restock-intensity idx | S1 | `clamp(ref·tier,floor,ceil)`; floor par; par table; sinks via EconomyService | fixed pricing curve / scheduled restock |
| **Economy (buy-from-player)** | buyInterest idx {NONE,MILD,KEEN} | S1 | **`buy_ceil = sell_floor·(1-min_spread)`**; per-item/day faucet budget | NOT_INTERESTED (no faucet fires) |
| **Events** | fire/don't-fire or event idx; (S2) slot-fill template | S1 + S2 | trigger threshold; **shared economic firing = human/kill-switch or world_clock**; Director validation | scheduled/weighted-random event tables |
| **Quests** | select+parameterize authored template | S2 | Director (schema/completability/economy/canon); **cross-quest loop analysis**; stock reservation; capped reward-tier | hand-authored quest pool |
| **Dialogue (minor)** | line text + optional typed candidate_intents | S2 (S1-gated) | re-validate intents; **give_item under per-player faucet budget, qty default 0, low-value pool** | templated/canned barks |

### 3.1 Behavior — Mercury-driven NPC decisions (P0, the archetype)

**Proposes (S1):** an index into the module's `enumerate()` affordance set — next routine action, gift-reaction performance, approach/avoid, relationship micro-move, world-event reaction, and the dialogue escalation gate — grounded in Mnemosyne per-player recall. No text, no numbers, no new verbs.

**Sim owns:** the finite legal set per decision (pre-filtered by shop hours, weather, reachability, cooldown, arc stage, affection, conversation-slot lock); re-enumerate-on-apply; all affection/movement/needs deltas from authored tables; the accept/abstain policy; Mnemosyne scope (TCB-enforced, no cross-player leak).

**Exploit fix — NPC-gift as an item spigot.** `npc_relationship_move` exposes `give_npc_gift`/`offer_small_favor`; cooldowns bound a single NPC but not aggregate value across *many* NPCs a player shapes toward gifting. **Fix:** a deterministic **per-NPC/day item-grant value budget**, independent of the chosen index; the sum across NPCs is bounded by the sim, not the LLM's frequency nudging.

**Fallback:** timeout / low-confidence / out-of-range → abstain to the scripted schedule DSL; stale moves dropped by re-enumerate-on-apply. Gift-table *tiers* stay deterministic (preserving legibility — players can still learn preferences); Mercury only picks the performance *within* the sim-computed tier.

### 3.2 Economy — Moneta's bounded advisor, never the mint

`@celestia/economy` (**Moneta**) exposes one money API (`grant/spend/transfer/balance`); the cognition service does not import it and holds zero grant on `ledger.*`. The LLM returns a **tier index**; `execute()` computes every amount via `price = clamp(reference_minor · tierMult[idx], floor_minor, ceil_minor)`.

**Exploit fix #1 (ranked risk #1) — buy-from-player arbitrage.** `priceTier` (shop *sells*) and `buyInterest` (shop *buys*) were two independent decisions each clamped to its own band around the same reference; nothing enforced `buy < sell`, so `KEEN` buy + `T_MINUS2` sell = **real COIN mint**, repeatable until the daily faucet drained. **Fix:** compute the buy ceiling as a deterministic function of the *current* sell floor — **`buy_ceil = sell_floor · (1 − min_spread)`** in `execute()`. Arbitrage is now structurally impossible regardless of tier; the per-item/day faucet budget is a backstop, not the primary defense.

**Boundary fix — demand feed-forward.** `buyInterest` must **not** feed the LLM's index into the shared, persistent `reference_minor` (that would permanently contaminate the "removable flavor layer" fallback). **Fix:** the demand signal is driven **purely by deterministic transaction-volume telemetry**; the LLM picks only the per-transaction tier, never the shared reference. With this, abstain → reference-curve is honest: removing the LLM removes all its influence.

**Honest scope note:** inflation is *mostly* out of reach (sell prices only redistribute COIN), but buy-from-player is a genuine **faucet whose rate-tier the LLM selects** — bounded by `buy_ceil` + per-item/day budget, not literally untouchable. We state this plainly rather than claim a clean "relative-value axis only."

**restockPlan — shared inventory.** The intensity index moves shared stock other systems depend on. **Fix:** a **deterministic floor par independent of the chosen tier**, and quest completability proofs model restock variance as worst-case (see 3.4).

**Fallback:** stale/out-of-range → `T_BASE` / `STANDARD` / `NOT_INTERESTED`; off-screen shops run scripted schedules with no LLM. All S1, never S2.

### 3.3 Events — generation under the Director, firing under the gate

**Proposes:** S1 trigger (fire-now index over a director-offered candidate set); S2 slot-fills a vetted `MarketEvent`/event template (`{kind, affectedCategory:enum, magnitudeTier:0..2, durationEpochs:bounded, flavorLineId}`).

**Boundary fix (ranked risk #6) — LLM-timed shared economic events.** Deciding *when* a shared festival_demand/shortage fires is a shared-world state transition, not "just a trigger" — a player who crowds a zone or drives `town_event_log` could induce favorable markets on demand. **Fix:** shared, economy-affecting event firing is **reclassified as a shared-world mutation** under human-in-loop + kill switch; or firing is a **deterministic `world_clock` schedule** and the LLM selects only *flavor*. The LLM never owns the timing of a shared economic shift gated by the room threshold alone.

**Sim owns:** the Director's economy-safety (magnitude/duration caps, category exists) before go-live; the kill switch + versioned canon with immediate invalidation on `ch:admin`.

**Fallback:** abstain → no event / scripted festival schedule.

### 3.4 Quests — select & parameterize over a vetted DSL (Phase 3, riskiest)

**Proposes:** S1 WHEN/WHICH (eligible-template index + "do nothing"); S2 a `QuestDraft` filling an authored template's typed slots — entity refs by id, items from a declared pool with `max_market_value`, int/clock domains, a `rewardTier` **index** into a capped faucet table, flavor-line slots. Never objective structure, never amounts, never new entities.

**The Director/Validator (deterministic, blocking, pre-publish):** schema-valid → canon-resolves → **completability reachability proof** → economy-safety → idempotency/non-duplication → flavor-line moderation → canon-version pin → scope gate. Reward amount is TCB code reading the logged tier index; `idemKey = quest_instance_id`.

**Exploit fix (ranked risk #2) — cross-quest positive-EV loops.** Per-quest-in-isolation safety lets two individually-safe per-player quests compose into a drain (A yields item X cheaply; B requires X and pays COIN > X's cost). Per-player auto-publish removed the human backstop exactly where the validator is admittedly incomplete. **Fix:** run loop analysis over the player's **full active+recent quest set and the generated-pool graph**, and gate auto-publish on a **per-player net-faucet-delta budget** evaluated against live quests. Plus (boundary): a **per-template canary/shadow budget and a conservation tripwire that auto-freezes a template on anomalous faucet draw.**

**Exploit fix — completability falsified by shared-stock depletion.** A griefer clearing zone stock can break every outstanding fetch quest for that item. **Fix:** **reserve stock against the quest instance at publish**, restrict generated objectives to per-player-forageable/craftable items, and make the abandon path a **full input refund audited as a faucet**.

**Exploit fix — self-memory poisoning.** A player can shape their own (per-player-scoped) memory to bias Calliope's slot fills toward the easiest NPC + cheapest item, minimizing effort-per-reward within bounds. Bounded (no mint) but it guts difficulty. **Fix:** validate binding selection against a **difficulty floor** / randomize within domain, rather than letting recall always minimize effort.

**Fallback:** Calliope timeout → pre-validated pool → authored static quest → none. Director fail → never publish.

### 3.5 Dialogue — the minor one-way surface

**Proposes:** contextual line text (display only, streamed as `dialogue.token`) + optional typed `candidate_intents`. One-way: no chat box, no player free-text. An S1 escalation gate decides generate-vs-bark.

**Exploit fix (ranked risk #7) — give_item as a faucet.** Dialogue-carried `give_item(id,qty)`/`offer_quest(id)` had no faucet budget and, being interaction-driven, could out-harvest any quest path. **Fix:** route every dialogue grant through the **same per-player/day item-faucet budget and reason_code cap as quest rewards**; **default qty to 0**; restrict to a **declared low-value pool**.

**Sim owns:** re-validation of every intent through the player pipeline; Mnemosyne scope in the TCB (an NPC cannot recite Player A's memories to Player B); per-player-only summary writeback (**no dialogue → shared-canon path exists**). Thundering herd is bounded (conversation slot + queue + S1 fast path + templated lines + abstain), not eliminated.

---

## 4. The Boundary

**The one law:** *The LLM proposes within sim-authored bounds; the sim owns truth.* The model returns only an index into a sim-enumerated option set, or a typed draft over a vetted DSL — and that output re-enters the same deterministic pipeline (`auth → can() → enumerate → reserve → commit → fenced append → ack`) as any client action, re-validated against the world as it is NOW. Everything irreversible, shared, or value-bearing stays in deterministic code behind that boundary, forever.

**The LLM must NEVER touch:**

- **Ledger / faucets / sinks / balances** — all value moves through the single `EconomyService` chokepoint; the model returns at most an index into a pre-capped reward enum; the amount is TCB code; cognition has zero `ledger.*` grant. (An injected model structurally cannot mint a coin.)
- **Authz / entitlements** — `can()` is deny-by-default engine code; legality (`enumerate()`) is a different question from authority, and the model is never an authz principal.
- **Shared-canon writes** — permanent global content, **and the timing of shared economy-affecting events**, change only via a validated typed event through the Director with **human-in-loop + kill switch**. Never a dialogue summary, never a raw generation, never a lone room-threshold trigger.
- **Progression / win numbers** — XP, drop/growth/catch/evolution, affection tiers, type charts: pure deterministic reducers.
- **Safety-critical** — moderation verdicts, anti-cheat, matchmaking fairness, the economy conservation audit.

**The director/validator gate for generated content.** All quest/event generation is "select + parameterize a human-authored template over a vetted DSL," proven by the deterministic Director for schema-validity + completability + economy-safety (incl. cross-quest loop analysis) + canon-consistency **before go-live**. **Per-player drafts** auto-publish on a passing checklist *plus* the per-player net-faucet-delta budget + canary/tripwire (blast radius: one player). **Shared / global** mutations are human-in-loop + kill-switch + versioned-canon + rollback.

> **WEB3-READINESS reconciliation (made explicit):** "shared-world mutation needs human-in-loop + kill switch" is honored by (a) narrowing *auto-publish* to **per-player** scope with a hard faucet-delta budget and a conservation tripwire, and (b) **reclassifying shared economic event *timing* as a shared-world mutation** under the human gate. Per-player auto-publish is not a shared-canon write; shared event firing no longer slips through as "just a trigger."

---

## 5. Cost & Routing

Routing is a deterministic config table (never model-chosen): `routine → Mica`, `high-stakes → JEV (S1.5, deferred P2)`, `generate → Calliope`. Every row carries an AI-LOD gate, a batch/cache strategy, a budget, and a scripted fallback.

| System | Proposes | Mode | Volume | Batch | Cache | Budget | Fallback |
|---|---|---|---|---|---|---|---|
| Behavior | action index | S1 | **HIGH (#1 QPS)** | yes (dense cross-NPC) | sha256(frame+optionset) | per-**zone** per-tick decision budget | utility/FSM scripted |
| Economy sell/stock | price/restock tier idx | S1 | MED | yes | partial (see note) | soft | fixed curve / scheduled |
| Economy reward | reward-tier idx | S1 | LOW | yes | partial | soft | default tier |
| Event trigger | fire/idx | S1 | LOW | yes | partial | soft | scheduled/weighted-random |
| Dialogue gate | generate-vs-bark | S1 | per interaction | yes | yes | the gate IS the throttle | always bark |
| NPC line | text + typed intents | S2 | SPARING | no (stream) | prefix + line cache | **HARD (Redis buckets, per-player AND per-NPC)** | templated barks |
| Quest/event gen | DSL template fill | S2 | VERY SPARING | no | **pre-validated pool** | **HARD + human-in-loop** | authored pool |

**Resolved inconsistency — who is #1 QPS.** Behavior is the dominant S1 driver and the capacity-planning anchor: its reactive multiplicand scales with **players-in-AoI × NPCs-in-AoI** (reaction + escalation-gate + mood + salience ≈ 4:1 over autonomous ticks). Economy is high-*frequency* but low-*cardinality* and heavily Ambient-shed, so it is a cacheable second, not the sizing driver.

**S1 cost at co-presence density (ranked risk #4).** S1 is **not** "marginally free" in a crowded square where every NPC is Foreground and the "shed Ambient first" ladder has nothing to shed. One warm Mica at ~54ms serves ~18 sequential decisions/sec; a 5k-CCU region needs a **GPU fleet sized to peak co-presence density, not CCU average**. Levers: a **hard per-zone decision budget with explicit Foreground degradation** (round-robin S1 across Foreground NPCs, scripted priors between turns); micro-batcher (P2); a **warm floor ≥1 Mica/region, never scale-to-zero** (cold weight-load = minutes = mass fallback).

**Decision-cache honesty.** The economy sha256 cache keys on a frame including `playerRepBucket` and a moving `demandBucket`, which fragment the key per-player and over time. **Do not count the cache as a cost lever until the Week-1 spike measures real hit-rate** under realistic rep/demand distributions.

**S2 generative — the razor's edge (ranked risk #5).** ~$300–500/day self-hosted vLLM vs **~$23k/day hosted-frontier at ~5k CCU**, and the gap closes only if generation stays gated — while "living NPC" + thundering herd push interaction *up*. Levers: (1) the S1 escalation gate (routine taps never hit a GPU); (2) **hard Redis token buckets per player AND per NPC**, short-circuiting to templated lines; (3) **pre-generated, pre-validated pools for popular NPCs and quests**; (4) persona-prefix prompt caching; (5) treat the **1/90s interaction rate as a measured Phase-1 exit gate, not an assumption** — the business case lives or dies on it.

**Pre-gen "overnight trough" (fixed).** A global MMO is always at peak somewhere, so trough GPU won't align with where content is needed. **Decouple pre-gen region from serving region** (generate in any trough, **validate + store centrally**) and **over-provision the pool** so the online path never falls back to live S2.

**The calibration keystone.** Every S1 gate across every system depends on **calibrated probabilities over DYNAMIC option sets** — the one unproven primitive the whole propose/dispose-with-thresholds story rests on. The **Week-1 spike** measures ECE/reliability as option-set size and semantics vary, fit against the *exact served quant*, with `calibration_version` stamped per `(model_file, quant)` and shadow-eval ECE required before any GGUF→vLLM cutover (which moves logits). If calibration is weak, the room flips **probs-as-gates → probs-as-rankings** by config (identical code path) + heavier scripted priors. If it fails outright, each S1 use degrades deterministically (behavior→FSM; economy→fixed tables; events→schedule; dialogue gate→always-templated). S2 generation itself survives (it is schema-validated, not threshold-dependent) but loses its gating signal and falls to rule-based triggers + the pre-validated pool.

---

## 6. Top risks (ranked) and phasing

1. **Buy-from-player faucet arbitrage** — the one place "the LLM can't inflate" actually broke: independent sell/buy clamp bands minted real COIN. **Mitigation (now structural):** `buy_ceil = sell_floor·(1-min_spread)` in `execute()`; faucet budget as backstop.
2. **Cross-quest positive-EV loops, auto-published per-player** — per-quest validation composes into a drain. **Mitigation:** whole-portfolio + pool-graph loop analysis; per-player net-faucet-delta budget gating auto-publish; per-template canary + conservation tripwire auto-freeze; EconomyService hard per-reason_code caps + conservation audit as defense-in-depth.
3. **Calibration-over-dynamic-option-sets (keystone, unproven)** — if the Week-1 ECE spike fails, every S1 gate loses trustworthy thresholds. **Mitigation:** the spike gates the architecture; probs-as-rankings config flip; `calibration_version` pinning; shadow-eval before any engine swap. This is an architecture bet, not a tuning knob.
4. **S1 cost at co-presence density + log-write placement** — behavior scales with players×NPCs-in-AoI with nothing to shed in hubs. **Mitigation:** hard per-zone budget + Foreground round-robin; fleet sized to peak density; compact async oracle log off the durable path (ledger only on it).
5. **S2 generative razor's edge vs the product's own incentives** — the cost case hinges on an interaction rate "living NPC" is designed to raise. **Mitigation:** per-player AND per-NPC token buckets; pre-gen pools; 1/90s as a measured Phase-1 exit gate.
6. **LLM soft authority over the shared economy** — timing shared events + feeding demand into shared reference were shared mutations gated only by a room threshold. **Mitigation:** demand signal from deterministic telemetry only; shared economic event firing under human/kill-switch or `world_clock` schedule.
7. **Dialogue/behavior-originated item grants as spigots** — `give_item`/`give_npc_gift` lacked faucet budgets. **Mitigation:** shared per-player/day item-faucet budget + reason_code cap; qty default 0; low-value pool; per-NPC/day grant value budget.
8. **`cid` collision on a beloved NPC** — cross-player misrouting under herd conditions. **Mitigation:** opaque per-session `interaction_token` folded into `subject` (Gateway still sees no `player_id`).

**Also tracked:** stale/raced apply (staleness guard + re-enumerate-on-apply); prompt injection (bounded to re-weighting sanctioned options; no mint, no new fields, no shared-canon path); thundering herd (bounded, real fix = intimate shards); **replay determinism for generated content** — note that `log.oracle_call.chosen_idx` secures *model* outputs but the Director's accept/reject verdict is pure code replayed against canon; this silently depends on **complete `canon_version` pinning on every draft**, which is therefore a load-bearing requirement, logged alongside the draft.

### Phasing

- **P0 — Behavior (S1 only).** The archetype; proves enumerate→index, abstain→scripted, the calibration keystone, AI-LOD, and the warm-floor/per-zone-budget cost model. No economy writes, no generation.
- **P1 — Dialogue + economy tiers (S1, + gated S2 lines).** Introduces the escalation gate, token buckets, the `buy_ceil` invariant, deterministic demand telemetry, and the 1/90s measured exit gate.
- **P2 — Events + routing/perf.** Micro-batcher, decision cache (only if the spike proved hit-rate), JEV/S1.5 escalation, vLLM crossover with shadow-eval.
- **P3 — Quest/event generation (S2 over DSL).** Last and riskiest: Director/Validator, cross-quest loop analysis, stock reservation, canary/tripwire, central pre-gen pools, human-in-loop + kill switch for all shared mutation.
