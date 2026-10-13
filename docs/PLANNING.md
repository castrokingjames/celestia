# Celestia — Starting Plan (LLM-driven life-sim MMO)

*Lead architect's starting plan. Status: proposal for team commit.*
*Guiding stance: **ship a narrow slice first, architect toward the dream.***

A persistent online life/farming sim in the spirit of Harvest Moon / Stardew Valley, where
villagers are driven by language models — a town that **truly knows you**: it remembers, forms
opinions, pursues its own goals, and holds a shared history with you.

---

## 0. Confirmed decisions & stack

**Product decisions (locked):**

| Decision | Choice |
|---|---|
| Scale | Many concurrent players, delivered as **zone-sharded "villages"** — a few hundred per room, thousands across the world (not one monolithic lobby) |
| LLM responsibilities | (a) NPC behavior & decisions · (b) NPC dialogue · (c) world/quest/event generation |
| NPC state model | **Hybrid** — world facts & NPC schedules **shared**; relationships/affection **per-player** |
| Memory | **LLM + vector search (RAG)** |
| Pace | **Cozy, low update rate** — low sim tick (≈2–10 Hz or event-driven), not twitch |

**Tech stack (locked):**

| Layer | Choice | Notes |
|---|---|---|
| Client | **Godot 4** | Thin: render + input + interpolation; sends *intents* only |
| Realtime server | **Colyseus** (Node) | Authoritative rooms; **1 room = 1 zone/village** (~hundreds of players) |
| Meta backend | **NestJS** (Node) | Auth, accounts, inventory, matchmaking, admin/moderation tooling |
| Durable state | **Postgres** | Source of truth; **`pgvector`** for RAG embeddings (no separate vector DB to start) |
| Hot/ephemeral state | **Redis** | Cache, pub/sub, presence, cross-room coordination, rate-limiting |
| Inference | Separate GPU service | **Mica-4B local** (hot path) + **hosted generative** (dialogue/world-gen), via an inference gateway |

**Honest note on the stack:** Colyseus/Node is a fine fit for a low-tick cozy sim at hundreds/room
*because the expensive "thinking" is offloaded to a separate inference service* — the Node event loop
only does orchestration + state sync. The one thing to design around: Node is single-threaded per
room, so there's no free "actor per NPC." A room owns its zone's NPCs cooperatively; **shared NPCs
that must stay consistent across rooms get a designated owner process + Redis coordination.** If a
room ever saturates a core, split zones (scale horizontally) — do **not** reach for a different
runtime first.

---

## 1. Executive summary (honest)

Each pillar — LLM behavior, LLM dialogue, LLM world-gen, shared NPCs with per-player bonds, scale —
is individually tractable in 2026. **Together they make cost, consistency, latency, safety,
determinism, and *coziness* fight each other at once.** The two most dangerous ambitions
(LLM-*generated permanent shared content*, and literal one-world scale) are exactly the ones most of
the analysis says to **defer**.

So this plan does **not** build the dream first. It:

1. Proves a **single-player → tiny-multiplayer vertical slice** that is fun **with the LLM turned off**.
2. Validates the **one unproven primitive the whole architecture rests on**: calibrated typed
   decisions over *dynamic* option sets.
3. Treats "LLM-generated permanent world content" and massive scale as **late, re-litigated phases**,
   not Phase-0 constraints.

**Three conceptual holes to close on paper before writing scaling code:** the shared-world
**time/day-clock model**; whether **farms are instanced**; the **co-presence** model (two players,
opposite affection, one visible NPC — including marriage).

---

## 2. Architecture at a glance

### The three problems

| Problem | What it is | Owner |
|---|---|---|
| **Behavior / decisions** | Routines, chores, reactions, relationship micro-moves | **System 1** (typed decision model) + sim |
| **Dialogue** | Natural-language conversation with players | **System 2** (generative), gated by System 1 |
| **Memory / identity** | What an NPC knows, recalls, and consistently *is* | RAG (System 2 path) + deterministic scalars (System 1 path) |

### The spine: *the LLM proposes, the sim disposes*

```
[Godot 4 client]  — thin: render, input, interpolation; sends INTENTS only
      │  WebSocket (Colyseus) · low tick (~2–10 Hz, cozy)
      ▼
[Colyseus room = ZONE]  — authoritative, deterministic, ~hundreds of players
   enumerate legal options → request decision → VALIDATE → execute → write memory delta
      │  (never blocks on inference)
      ├───────────────► [NestJS services] — auth, accounts, inventory, matchmaking, moderation
      ▼
[Cognition service: scheduler + batcher + inference gateway]   ← game code NEVER calls a model directly
   ├─ System 1  typed decision  (state, question, allowed_answers) → calibrated probs, NO text
   │     Mica-4B local (hot path, llama.cpp/vLLM)   ·   JEV hosted (escalation, NOT the <100ms path)
   └─ System 2  generative text  (dialogue + offline content) — hosted now → self-host vLLM at scale
      ▼
[Postgres = truth · pgvector = RAG · Redis = cache/pubsub/presence/room-coord · append-only event log]
```

**Three invariants that make an un-securable component (an LLM reading hostile player text) safe:**

- **The sim enumerates options.** A model only picks an index into a fixed, sim-authored enum.
  Prompt injection can at most re-weight *sanctioned* actions — it cannot invent one.
- **The sim executes and owns all persistent state.** Generative text mutates state only by emitting
  *typed intents* (`offer_quest(id)`, `give_item(id)`) that re-enter the validated action pipeline.
  Raw text never writes state.
- **The LLM is outside the trusted computing base.** Deterministic validators — not the model — are
  the TCB. Calibrated probabilities become meaningful thresholds (abstain → scripted fallback on low
  confidence/timeout). **Load-bearing and unvalidated — see Risk 1.**

**Cost shape:** System 1 carries per-NPC-per-decision load (cheap, batchable, local). System 2 is
used *sparingly* and scales with player-interaction events. Degradation is always *toward*
deterministic behavior, never toward chaos.

### Two "clean wins" the critique punctured (don't bank on them)

- "**Behavior scales with #NPCs, not #players**" is **overstated**: player-*reactive* decisions
  (reaction + escalation-gate + mood + salience-scoring per interaction) dominate autonomous ticks
  roughly 4:1. The hot path carries a per-player multiplicand. Plan for reactive load as dominant.
- "**Finite NPC attention**" (single-writer per hot NPC) is a sound concurrency fix but a **product
  wound**: if a beloved NPC queues/refuses interactions, most players literally can't be *known* by
  them — gutting the core fantasy. This is evidence *for* intimate shards, not a free scaling win.

---

## 3. Phased roadmap (exit criteria gate each phase)

### Phase 0 — Single-NPC → 4-NPC offline slice: "The Proof"
Pre-multiplayer, pre-scale. **Godot client + a single local server + local Mica (llama.cpp) + hosted
generative API + Postgres/pgvector.** One farm, one village, **1 season (28 days), 4 deep NPCs**,
each with an authored **bible** (personality, voice, backstory, core want, gift table) + a
**constitution** (forbidden lines) + **one ~3-beat relationship arc**. Deterministic systems
(farming, energy, day-clock, money, visible affection hearts, fixed gift tables, one authored
festival) must be **fun with the LLM off**.

*Note:* you can prototype Phase 0 as a single Colyseus room (even single-client) so the netcode path
is exercised early, but multiplayer concerns are explicitly out of scope here.

**Exit criteria**
- An NPC runs a believable daily routine chosen by **typed decisions, not scripts**; recalls a prior
  interaction (yesterday's gift) in dialogue.
- Decision p50 < ~100 ms (batched); a full in-game day **replays deterministically from the event
  log** (feeding logged model outputs).
- **Cost-per-NPC-day measured and extrapolated.**
- Testers finish 28 days, want "one more day," and **report fun with the LLM off**.
- Exit interviews: ≥1 NPC described as "a real person" with a recounted *unscripted* moment; players
  **correctly state each NPC's gift preferences** after one season (legibility preserved).
- Calibration validated in-domain over the decision types *with variable option sets* (ECE /
  reliability diagrams).

### Phase 1 — Tiny multiplayer slice (2–20 players, shared NPCs)
Introduce **Colyseus** properly (one room), interpolation, trivial area-of-interest, the **hybrid
state model**, and the **co-presence spike** (two players, opposite affection, one NPC — try
private-instanced / affection-blended / turn-ownership). **NestJS** for auth/accounts. Keep System 2
hosted; add the escalation gate + decision caching.

**Exit criteria**
- Multiple players see **consistent shared NPC behavior/world state**; **per-player relationships
  diverge correctly** and dialogue reflects per-player memory.
- Concurrent interaction with the same NPC is arbitrated with **no races**; server rejects invalid
  moves and restores on reconnect; 20 players stable for a multi-hour session.
- Co-presence model **chosen and defended** (dictates netcode + memory + social fiction).
- **Measured dialogue turns/player-hour** under the real "town that knows you" incentive (not the
  assumed 1/90s) — the generative-budget make-or-break number.

### Phase 2 — Shard / scale (hundreds → thousands, across intimate villages)
Multiple Colyseus rooms = multiple villages; **Redis** for presence + cross-room coordination +
AoI fan-out; horizontal room processes; shared-NPC ownership/handoff on zone boundaries; vLLM
cluster + batched Mica pool with graceful degradation; full observability (OpenTelemetry +
Prometheus/Grafana + an LLM-trace tool like Langfuse + cost dashboards). **"Thousands" = thousands
across many cozy villages, not one 2,000-avatar square.**

**Exit criteria**
- Target concurrency per room at target tick within p99 bounds; inference pool sustains aggregate
  decision QPS **within cost budget**.
- **Degradation verified** under inference overload (NPCs degrade, world does not freeze); chaos
  tests (kill a room process, inference down) pass; zone handoff works.
- **Cost-per-concurrent-player-hour within target** under a *realistic diurnal/weekend peak* model
  (not 24/7 ideal utilization).

### Phase 3 — LLM world/quest/event generation (riskiest, deliberately last)
System 2 drafts quests/festivals/events as **schema-validated structured output** over a vetted DSL;
a deterministic **director/validator** proves schema validity, **completability**, economy safety,
and canon consistency *before* anything goes live; moderation + versioned canon + rollback;
human-in-the-loop + kill switch for anything that mutates shared world state.

**Exit criteria**
- Generated quests are schema-valid, **provably completable**, non-contradictory with canon,
  consistent across all players who see them, economy-safe.
- A bad event is **reverted without corrupting persistent state**; adversarial
  prompt-injection/offensive content blocked at an agreed rate.

---

## 4. First 30 days (concrete)

**Week 1 — kill the project cheaply if it's dead.**
1. **Calibration spike** (highest leverage, 1 GPU, days): feed real Mica-4B and JEV the concrete
   decision types with realistic state frames and **variable option sets**; measure ECE/reliability
   as option-set size and semantics change. *If probabilities aren't calibrated over dynamic enums,
   the whole safety/quality architecture is rethought before we build anything.*
2. **Day-clock / time-model paper spike** (whiteboard): shared real-time calendar vs per-player time;
   how sleep/day-advance reconciles with thousands sharing one NPC schedule; **are farms instanced?**
3. **GDPR-erasure + event-log paper spike:** tombstoning / crypto-shredding for the append-only log
   and vector store; minor/COPPA posture (can a minor's chat hit a hosted LLM at all?).

**Week 2 — freeze the contracts.**
4. Freeze the **context-frame schema** (needs/mood/inventory/location/nearby/relationship, within
   Mica's 8K as a *schema, not prose*) and the `/v1/systemone` request/response contract.
5. Define the **dialogue state-write contract**: the exact typed intents System 2 may emit + validators.
6. Stand up the **inference gateway** (game code never calls a model directly) with Mica-local behind
   it and a hosted generative API.

**Week 3 — the loop.**
7. Build the **two-rate loop**: deterministic low-Hz sim + event-triggered cognition; affordance
   enumerator → decision → validate → execute → memory delta.
8. Build the memory write/retrieve cycle in **pgvector** (event log = truth; scalars synchronous;
   embeddings async).
9. Author bible + constitution + gift table + one 3-beat arc for **NPC #1**.

**Week 4 — prove and instrument.**
10. One NPC runs a believable **typed-decision** daily routine; player converses; NPC recalls
    yesterday's gift.
11. **Decision-service load microbenchmark** (one 3090, synthetic trace): real batched throughput,
    p99 tail, degradation ladder.
12. Stand up the **minimal NPC-coherence/red-team eval harness now** (cheap at 1 NPC; mandatory at
    scale): scripted persona-consistency probes + a prompt-injection pass against the
    typed-decision + validator boundary.

---

## 5. Top risks (ranked, with mitigations)

| # | Risk | Mitigation |
|---|---|---|
| **1** | **Calibration unvalidated over dynamic option sets** — the whole thresholding / abstain-to-fallback / "propose-dispose" quality story rests on a months-old primitive, and option sets change size/semantics every call. | **Calibration spike Week 1** (gates the architecture). Per-deployment validation + periodic recalibration. Fallback: fixed-enum decisions + heavier scripted priors; treat probs as rankings not gates. |
| **2** | **Scale shape** — intimacy comes from *scarcity* of social attention; a huge shared square is a lobby. | **Resolved by your room/zone choice:** deliver scale as **many intimate villages (~hundreds each)**, not one monolith. Keep this as the explicit topology. |
| **3** | **Generative economics on a razor's edge** — self-hosted generative is the only viable dialogue path (~$300–500/day vs ~$23k/day hosted-frontier at ~5k CCU), and it only closes if chat is *gated* — but the headline feature *incentivizes constant chatting*. | **Measure real turns/player-hour on the slice (Phase 1 exit)** before sizing. Escalation gate (templated lines for routine taps; generate only novel/high-stakes turns). RAG discipline + prefix caching on the *dialogue* path. Model *peak* capacity. Per-player token budgets. |
| **4** | **Shared-world LLM generation (responsibility c)** — permanent global content, provably-winnable/economy-safe quests at scale is research-grade; one injection into shared canon = mass griefing. | **Defer to Phase 3.** In the slice, "LLM-generated quests" = LLM selects/parameterizes/flavors a **human-authored template library** over a vetted DSL. **Players write only their own per-player memory; never shared canon.** Scoped RAG store (GLOBAL / SHARED-sim / PER-PLAYER). Human-in-loop + kill switch for shared-state mutation. |
| **5** | **Co-presence / per-player bond to a shared NPC** — two players, opposite affection, one visible NPC; **marriage** ("can 500 players marry Marnie?") is this at its most acute. | **Co-presence spike in Phase 1** (3 models). Recommend **private/instanced conversation** for the slice. Decide marriage/romance semantics (per-shard exclusivity vs instanced "your-version") before any romance content. |
| **6** | **Non-determinism vs persistent-world integrity vs GDPR** — immutable replayable "truth" log, anti-cheat re-simulation (impossible given GPU logit drift), and right-to-erasure can't all hold. | Treat the LLM as a **logged external oracle**: log inputs + outputs (logit vector, model+version, seed); **replay feeds logged outputs**, not re-run inference. Anti-cheat = audit/forensics, not re-simulation. Design **tombstoning/crypto-shredding** from day one. |
| **7** | **No live-ops eval harness for a non-deterministic cast** — coherence/hallucination is a kill criterion with no measurement; model upgrades silently change a beloved NPC's voice; authoring bibles/constitutions/beats is a large uncosted writers'-room burden. | **Build the coherence + red-team harness in Phase 0.** Treat model upgrades as content deploys: canary + shadow-eval persona regression before promotion. **Scope and cost the authoring pipeline** as a first-class deliverable. |
| **8** | **Latency tail — hosted JEV can't meet the <100 ms active-tier budget** (network RTT + queueing). | **Active/hero hot path = local Mica only.** Reserve JEV for escalated, non-<100 ms, multimodal decisions. Async decision service decoupled from the tick; strict per-call timeouts → deterministic fallback; priority queue so one slow batch never stalls foreground NPCs. |

---

## 6. Key open decisions

- **Time model:** shared real-time calendar vs per-player time; sleep/day-advance against shared NPC
  schedules; crop growth while offline.
- **Farming at scale:** instanced per-player farms vs shared/griefable land; offline progression.
- **Shared economy:** crop demand/inflation with many sellers; player-to-player trade; faucet/sink
  authority (must live in deterministic server code, **never** the LLM).
- **Marriage/romance** semantics against a shared NPC (exclusivity vs instanced relationships).
- **Co-presence** reconciliation model (private-instanced / affection-blended / turn-ownership);
  conversation visibility (recommend **private** for the slice).
- **Dialogue frequency & gating** target (sets the entire generative budget).
- **Model routing:** exact Mica-local vs JEV-9B vs JEV-27B rule; local GPU fleet vs hosted spend.
- **Per-room per-tick decision budget** + degradation ladder (which NPCs drop to scripted first).
- **Memory:** salience filter (rules vs System-1 scoring); compaction that **preserves
  callback-worthy facts** ("hates thunderstorms" must survive rollup); inactive-player archival
  window; pgvector → dedicated vector DB migration trigger metric.
- **Shared-NPC ownership** across Colyseus rooms (which process ticks a shared NPC; handoff on zone
  crossing) — the Node-specific version of "actor per NPC."
- **Player-to-player social layer:** chat, trade, co-op, blocking, griefing, guilds — currently
  undesigned.
- **New-player onboarding (FTUE)** into a town with pre-existing NPC history.
- **Localization:** multi-language dialogue → per-language moderation, per-language calibration,
  multiplied generative cost.
- **Vendor maturity fallback:** architecture if the typed-decision/calibration paradigm underperforms
  or JEV pricing/API changes.

---

## 7. What to NOT build yourself

- **No custom game engine** — Godot 4. ✅ (locked)
- **No custom netcode / room framework** — Colyseus gives you authoritative rooms + state sync. ✅
- **No custom inference server** — vLLM / llama.cpp / TGI. Use Mica/JEV as-is; no from-scratch
  finetune (LoRA much later).
- **No custom vector DB** — `pgvector` first; dedicated vector DB only if a metric forces it.
- **No bespoke wire serialization** — use Colyseus schema / Protobuf, not hand-rolled.
- **No custom auth/payments** early — managed identity provider; NestJS orchestrates.
- **No custom observability** — OpenTelemetry + Prometheus/Grafana + an LLM-trace tool.
- **No self-hosting the biggest generative models in Phase 0/1** — hosted API until volume justifies
  vLLM (crossover ~1–2k CCU).
- **No LLM-owned economy, progression, or affection numbers** — deterministic, legible, server-side.
- **No seamless "everyone in one space"** — zone/room it (already your plan).
- **No fully generative main story, no randomized calendar** — author the spine, peaks, festivals;
  generate the flesh.

---

## 8. The single recommended immediate next step

**Run the calibration spike (Week 1, one GPU, a few days):** feed real Mica-4B and JEV the concrete
decision types with realistic state frames and **variable, per-call affordance option sets**, and
measure in-domain calibration (ECE, reliability diagrams) as option-set size and semantics change.

Every downstream guarantee — thresholded gates, abstain-to-fallback safety, "the LLM proposes, the
sim disposes" quality — assumes these probabilities are calibrated over *dynamic* enums, which is
**unproven**. If calibration holds, build the Phase-0 loop with confidence. If it doesn't, redesign
the decision layer *before* writing a line of scaling code. **Nothing else is worth starting until we
know this.**
