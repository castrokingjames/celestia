<!-- The LLM/vector DECISION MECHANISM: how a decision is served, how confident we are, how the layer learns. Complements COGNITION.md (how the LLM plugs into each game system) and ARCHITECTURE.md (event log / replay). Derived from the design session; written to be reviewed later. -->

# DECISIONS.md — The LLM / Vector Decision Mechanism

> **Scope.** *How* a decision gets served (retrieval → inference cascade), *how sure* we are it's right (confidence & calibration), *where* it runs relative to the tick (cadence), and *how the layer gets better over time* (the seed→record→re-teach→re-seed flywheel). `COGNITION.md` says how the LLM integrates into behavior/economy/events/quests; **this doc says how the decision machinery underneath all of them actually works.** Components referenced: **Mercury** (System-1 calibrated model), **Calliope** (System-2 generative), **Mnemosyne** (the vector memory / retrieval = pgvector).

---

## 1. The model in one line

> **The decision layer is a *seeded, self-improving retrieval+inference cascade* that the deterministic sim consults off-tick. The sim loop is the authority; the decision layer only proposes.**

Three layers, never collapsed into each other:

```
Layer 1  SIM LOOP (deterministic, authored)   — the tick: owns state, rules, time, the authored content SPACE.
                                                 The game is fully playable on this ALONE.   ← this is "the game loop"
Layer 2  DECISION LAYER (this doc)             — consulted OFF-tick to CHOOSE/PARAMETERIZE within Layer 1's space.
                                                 Makes it alive & personal. Fully replaceable by a scripted fallback.   ← pgvector/Mercury/Calliope live here
Layer 3  FLYWHEEL (offline)                    — seeds & improves Layer 2 over time. Never on the hot path.
```

**The game loop is not pgvector.** The loop is deterministic sim code; the decision layer is a service it *asks* for answers, off the tick, through a mailbox. If the decision layer is cold, slow, or down, the loop keeps running on scripted fallbacks — a cache miss never freezes the game. (See `ARCHITECTURE.md` for the tick/mailbox/replay machinery; `COGNITION.md §2` for the gateway contract.)

---

## 2. The three-tier cascade

A decision is served by the **cheapest tier that is confident enough**, escalating only on a miss or low confidence, and **writing the result back** so the next similar decision is cheaper.

| Tier | Mechanism | Latency | When it serves | On miss / low-confidence |
|---|---|---|---|---|
| **0 — Exact** | Postgres **btree/hash** on `sha256(frame + option_set)` | sub-ms, in-DB | *exact* bucketed situation seen before | → tier 1 |
| **1 — Fuzzy** | **pgvector** ANN (cosine, HNSW) over the frame embedding — *"close-to"* | ~ms | a *similar* situation is close enough (similarity ≥ τ_sim) | → tier 2 |
| **2 — System-1** | **Mercury** (Mica-4B) — calibrated pick over the option set | ~54 ms | fresh decision; decision-confidence ≥ τ_dec | → tier 3 |
| **3 — System-2** | **Calliope** (generative over a vetted DSL) | ~seconds | ambiguous / high-stakes / needs generation | → scripted fallback |
| **F — Floor** | deterministic scripted default | instant | timeout / breaker / abstain | — (always lands here) |

Every tier-2/3 result is **cached back** (tier 0/1 + the seed library), so the model-call rate *decays* as coverage fills.

**Two different "confidences" — do not conflate them (they gate different escalations):**
- **Similarity confidence** (tier 1): *"have I seen a situation like this?"* — low ⇒ novel ⇒ decide fresh.
- **Decision confidence** (tier 2): *the calibrated probability on the chosen option* — *"am I sure this is right?"* — low ⇒ ambiguous ⇒ deliberate.

**pgvector, not pg_search.** Matching a *frame* (time/mood/needs/relationship…) is semantic/feature similarity → **pgvector** (already locked in `TECH-STACK.md`). `pg_search`/BM25 is lexical/keyword search — a different tool, not this job. Keep pgvector behind an adapter (as we did for Redis) so it's swappable. **Do not vector-ize the exact tier** — tier 0 is a plain index, faster and deterministic; pgvector is only the *fuzzy* tier.

**Caching a decision ≠ caching an answer — the staleness trap.** A decision depends on context, so:
- The cache key **must embed the context that actually changes the decision**, or you reuse a decision from a situation that only *looks* similar (the *famine-bread* bug: a vendor's "+10% bread" reused *during a shortage event*). 
- Cached decisions **go stale** when events/economy shift → need TTL or event-driven invalidation.
- **Threshold by stakes.** A loose τ_sim is fine for an idle animation (wrong reuse = cosmetic); for a *money* decision a wrong reuse is **exploitable** → strict τ_sim or skip the cache entirely. The cache must respect the economy-safety boundary (`COGNITION.md §4`).

---

## 3. Criteria — the minimal sufficient set (more is *not* better)

The instinct "throw in as many criteria as possible for a better result" is **wrong**, and it hurts the two things we care most about: **cache hit-rate** and **calibration**.

- **Cache (curse of dimensionality).** More criteria ⇒ every situation is more unique ⇒ fewer near-neighbors ⇒ **hit-rate collapses, the model-call rate never decays, cost stays high forever.** And similarity gets *diluted*: if the decision truly turns on 3 criteria but you embed 20, cosine distance is dominated by the 17 that don't matter — fewer hits *and* wronger hits.
- **Calibration.** More input features ⇒ more variance ⇒ **more labeled data needed** to stay calibrated; irrelevant features degrade calibration specifically — i.e. "more criteria" makes the keystone (§4) *harder*.
- **System-2 context.** More prompt context isn't monotonic either: "lost in the middle," more tokens = more cost/latency, more injection surface. Curated/retrieved-relevant beats a dump.

**The real goal is the *minimal sufficient set per decision type*** — enough to not conflate situations that are *genuinely different* (what stops the famine-bread exploit), not so many that nothing ever repeats. The tension:

- too *few* criteria → over-generalize → reuse a decision that shouldn't apply (correctness bug / exploit);
- too *many* → nothing clusters → no cache hits, bad calibration (cost + accuracy bug).

Consequences:
1. **Different tiers want different criteria.** The **cache key** is *minimal* (maximize reuse); the **model-on-miss** can pull a *richer* retrieved context. You can split them: a small bucketing key for the cache, a fuller context fetched only on a miss.
2. **Criteria are per decision type**, not one universal vector. Pricing: `{item, supply, demand, active_events, rep_tier}`. Routine: `{time, weather, role, mood}`. A giant shared feature blob is the worst of both worlds.
3. **Method:** start with a *small* believed-relevant set, measure (hit-rate + calibration + decision quality), add a criterion only when it demonstrably improves the outcome *and* you can afford its hit-rate cost. Feature selection, empirically — not "everything in."

---

## 4. Calibration — the keystone

Everything in §2's thresholded cascade stands on **calibrated probabilities over *dynamic* option sets**: when Mercury says 70%, it must be right ~70% of the time, across option sets that change size and meaning every call. This is the single unproven primitive under the whole project.

**"More data → higher confidence" is the wrong mental model.** More data makes confidence **more *accurate* (better calibrated)**, not uniformly *higher*:
- A genuinely **clear-cut** situation → confidence *should* be high; data helps it get there *when warranted*.
- A genuinely **ambiguous** situation (two near-equal actions — market *or* tavern) → correct confidence is **~50%, and it should stay there no matter how much data you have.** Forcing it to 90% is *miscalibration* (overconfidence), not improvement.
- Target = *honest*, not *maximal*: confidently high on easy calls, honestly ~50% on coin-flips.

What data **does** boost: **coverage** (how often you've seen something like this → tier-0/1 hit-rate) and **calibration** (the number becomes trustworthy, so the threshold is meaningful). Early on a thin seed is doubly weak — low coverage *and* an untrustworthy number — and data fixes both of *those*.

**"50%" is not a universal number.** For a *binary* choice 50% = max uncertainty; for an **N-way** option set the pure-uncertainty baseline is **1/N**. On a 5-way choice, 50% on the top option is already fairly confident (vs 20% uniform). So thresholds must be set **relative to option-set size** — which is exactly why *calibration over dynamic option sets* (not static) is the hard part.

**Low confidence is information, not a defect.** A situation that stays low-confidence *after* lots of data is *genuinely ambiguous* → treat the top options as a tie (stochastic / cheap deterministic tiebreak) or escalate to Calliope. Don't "collect more data until it goes up." And there's an **irreducible floor**: novel/ambiguous situations (the long tail, adversarial players) stay low-confidence forever — correctly routing to model/fallback. The flywheel *shrinks* that slice; it never zeroes it. Don't chase 100%.

**If calibration is weak** (the Week-1 spike, §9): flip **probs-as-gates → probs-as-rankings** by config (identical code path — the accept policy lives in the room, not the gateway) and lean on scripted priors. **If it fails outright**, each use degrades deterministically (behavior→FSM, economy→fixed tables, events→schedule). Calibration is pinned per `(model_file, quant)` as `calibration_version`; a GGUF→vLLM swap *moves the logits* → requires a shadow-eval of ECE before cutover.

---

## 5. Cadence — where a decision sits relative to the tick

**Never put inference on the control loop.** Even Mercury's ~54 ms is far too slow for per-tick/per-frame control, and Calliope (seconds) is a non-starter. Decisions run **off-tick, async, through a mailbox**; the loop keeps executing the *current* answer while the next one is in flight, and drops to a default if it's slow or missing. Three cadences:

| Cadence | Runs | Who | Decides |
|---|---|---|---|
| **Reflex** — every tick (10–60 Hz) | **pure deterministic** (FSM / steering / nav / behavior tree) | the sim | motion, pathfinding, timing, hitboxes — **no DB, no inference** |
| **Tactic** — ~1 Hz / on-interrupt (off-tick) | **tier 0/1 → Mercury** | decision layer | the *goal/plan* (the seeded policy lives here) |
| **Strategy** — per encounter/phase | **Calliope** (sparing / pre-gen) | decision layer | personality, phase shifts, generated content |

### 5.1 Plan-and-execute (emit a plan, not a single action)

The tactic layer emits a **short *reactive* plan**, not one action — so one decision amortizes over many ticks (deciding at 1 Hz against a 10–60 Hz loop cuts decision volume 10–60×, directly fixing the cost cliff). A plan is a tiny program with its own guards and **interrupts**, re-evaluated by the reflex loop every tick:

```
analyze → plan[ follow x; when in_range: attack ]            ← tier 0/1/Mercury picks the plan (off-tick)
     reflex loop runs it every tick (nav, swing, animate)
     ⚡ x dies | self HP<30% | took damage  → INTERRUPT → analyze NOW (don't finish the sequence)
analyze → plan[ pick target y; follow y; cast_fire ]  …
```

Re-analyze on **plan-complete OR a timer floor OR an interrupt** — the interrupts are what keep 1 Hz from feeling sluggish. A "set of commands with conditions, ticked by the fast loop" **is a behavior tree** — this is standard HTN/behavior-tree game AI, with the decision layer picking *which* tree. Prefer **S1 indexing into an authored plan library** (cheap, calibratable, pre-vetted blast radius); reserve **S2 assembling a plan over a command DSL** for signature cases (and validate it: terminates? legal targets? non-exploit?). Commands (`follow`, `cast_fire`, `cast_heal`) are **authored primitives** — the layer selects/parameterizes, it never invents verbs. Logging the chosen plan (not every action) makes replay *cleaner*.

### 5.2 Applied: creature / combat behavior

- **Ambient/overworld creatures** (wandering slime, farm animal) = *just NPC behavior*: tier 0/1→Mercury `enumerate→index`, scripted fallback. Nothing special.
- **Turn-based combat** = a *great* fit: moves are an enumerated legal set (an index) **and** turn-based means no real-time latency pressure. Two hard constraints: **(a) rules stay deterministic** (damage, type chart, hit/miss, catch/evolution, *reward* — pure reducers; the model picks *which move*, the sim computes *what it does* and *who won*; this is also what makes battle exploit-safe — injection can at most swap *legal* moves); **(b) difficulty is a first-class knob** — "best move" is usually *wrong*; parameterize by encounter (dumb slime vs sharp boss) via restricted option set / sampling temperature.
- **Real-time** = where you LLM the *least*: >95% of the brain is the deterministic reflex layer; the LLM only sets the *tactic* at ~1 Hz. **Swarms** = a cost cliff → decide at the **squad** level, hard **per-zone decision budget**, LOD by threat (only engaged monsters get tactics).
- **Don't LLM what needs no judgment.** A wild slime needs a behavior tree, not a language model; a rival with a grudge who counters your favorite combo might. Same rule as **weather** (cheap deterministic sim; LLM only for *flavor*).

---

## 6. The flywheel — seed → record → re-teach → re-seed

Cold-start problem: an empty cache and an un-calibrated model are useless on day one. The flywheel is a **distillation loop** — pay for intelligence *once, offline*, serve it cheap.

```
OFFLINE (bootstrap)  seed scenarios ─▶ strong teacher ─▶ decisions ─┐ distilled into
                                                                     ▼
                                   { pgvector cache (tier 0/1)  +  calibrated Mercury student }
ONLINE (cheap)       tiers serve most; misses/low-confidence ─▶ model, LOGGED
OFFLINE (periodic)   replay REAL logged situations ─▶ re-decide with a BETTER teacher ─▶ eval-gate ─▶ re-seed ─▶ new version
```

- **Record = the event/oracle log, structured** (`frame`, `option_set`, `chosen_plan/idx`, `outcome`) — not prose. A JSONL file is a perfectly fine lean version for the spike. **Non-negotiable:** log enough to **reconstruct the exact decision context** (frame *and* the option set shown), or you can't re-decide. This is `log.event` + `log.oracle_call` from `ARCHITECTURE.md`, not a new thing.
- **"Re-run" is two different things — don't conflate:**
  - **Pointwise re-decision** (trajectory held *fixed*; re-ask a better teacher per recorded `(frame, option_set)`) → **this is what re-seeding wants**: stable, comparable.
  - **Full re-simulation** (let the better model *drive*; world diverges) → discovers *new* scenarios/coverage, but drifts and isn't a clean label. Use for coverage, not as a training signal.
- **Anchor to a *better* teacher — this is the anti-collapse rule.** Never retrain on your *own* model's past outputs (variance shrinks, it drifts off reality = model collapse). Always distill from something stronger (bigger model / more context / more compute / human review) and/or real outcomes.
- **Eval-gate.** A teacher's answer is a **candidate** seed, promoted only if the new set *beats* the current one on a held-out eval (calibration + decision quality + **no new exploits**). A confident-but-wrong teacher would otherwise poison the library.
- **Re-seeded pairs do double duty:** warm the **pgvector cache** (direct hits, no model call) **and** serve as data to **recalibrate Mercury**. One tape, two uses.
- **Distribution shift.** Content/balance changes stale old data; the flywheel must keep turning against the *current* game.
- **Lean v1:** JSONL log → a hand-run offline re-decide script with a bigger model → eval-gate → promote. Manual crank; no MLOps pipeline until it earns one. (One turn of the crank, by hand.)

---

## 7. What the mechanism does and doesn't buy you (expectation-setting)

**The quality ladder** a player experiences, best → worst:

1. **Precisely matched** — high-confidence fresh decision, or a *high*-similarity cache hit (bespoke-feeling).
2. **"Close to"** — a *low*-similarity neighbor reused: right for a *nearby* situation, approximately.
3. **Generic** — the scripted floor (default routine, reference price, canned bark): safe, correct, undifferentiated.

**More data / more players shifts the *distribution* UP this ladder** — more interactions land as (1), fewer fall to (2)/(3). That is the entire payoff, and it means:

- **"Better matched, not more kinds."** Data upgrades *which* authored outcome you get and how it's personalized — **not the size of the menu.**
- **Variety is authored, navigated by the model.** `felt variety ≈ authored breadth × context differentiation × parameterization × personalization`. The model does the right-hand terms; the *breadth* is authored. **Variety out ≤ variety authored in (× parameterization).** The model is a *selector/combiner/parameterizer over an authored space, not an infinite generator* — a thin authored space + mountains of data = the same few things served reliably, not richness. **Author a generative *space*, not a fixed *script*.**
- **Correctness is never on this ladder.** The deterministic sim guarantees every output is legal and safe *regardless of data* — even the generic floor is *correct*, just plain. So **data improves experience *quality* (generic→bespoke), never correctness/safety** (always guaranteed). At zero data the game is already correct and playable; the flywheel makes it feel tailor-made.

---

## 8. Scale & the moat

**More players → better system — *through the loop*, not automatically:** more players → more real situations → more coverage + better calibration + better personalization → better matching → better experience → more players. A real **moat** (accumulated coverage can't be instantly matched from zero). Honest asterisks:

- **Only if the loop turns well.** Players produce *data*; the record→better-teacher→eval-gate→re-seed loop produces *quality*. A broken pipeline just makes more noise.
- **Diminishing returns.** The common cases fill fast; the 1,000th player in the same zone adds little. Players help most where they explore *new* regions (new areas, strategies, the tail).
- **Double-edged.** More players = more cost (co-presence / S2 cliffs, `COGNITION.md §5`) and more *adversarial* probing. Real-player data is *biased* (metagaming, clustering) — curate + anchor to a better teacher + eval-gate, or you bake their biases and exploits into the seeds.

---

## 9. Lifecycle & versioning (like migrations — with one sharp caveat)

Seeds, calibration, and model weights are **versioned, ordered artifacts** (`seed@v`, `calib@v`, `model@ver`), each **stamped into the event log** so replay is reproducible against whatever was live. Roll *forward* on a passing eval; **roll back to the last-good version** on regression/exploit. Keep old versions for **rollback + audit + an eval baseline**. *That* discipline is exactly like DB migrations.

**The sharp caveat — two different "fallbacks," only one is migration-like:**

| | What it is | Migration-like? |
|---|---|---|
| **Version rollback** | revert to the previous good model/seed if a new one regresses | ✅ operational, one version live at a time |
| **Runtime fallback** (the §7 quality ladder) | within the *current* version, a low-confidence/miss degrades to S2/scripted | ❌ not an old version — the safe path baked into the live version |

**You do not chain old seed versions as live fallback tiers.** A cache miss today drops to the *current* version's scripted floor — not to last month's model. Old versions sit in the archive for revert/compare, never consulted at runtime (delete them all and runtime fallback still works). Also: a migration is a *deterministic reversible transform of structure*; a model version is a *regenerated statistical artifact* (forward = retrain+eval-gate, rollback = repoint) — borrow the *version/pin/rollback* discipline, not the "reversible DDL" picture. The **actual DB** schema still uses literal dbmate migrations (`TECH-STACK.md`); the model-version registry is a *separate, analogous* system.

**Seed lifecycle = scaffolding.** Don't *delete* the seed — let real data **supersede** it where coverage is *proven*: age out/down-weight superseded synthetic entries, but **keep the seed as fallback coverage for the long tail + cold/new regions** real players haven't hit, and as an eval baseline. The **seeding *process* is permanent** — every new zone/quest/monster/mechanic is a fresh local cold-start needing new synthetic seeding. Retirement is **per-entry, coverage-verified, eval-gated** (drop a seed only when real data covers that region at ≥ quality); blind removal opens *silent* quality holes.

---

## 10. The boundary (inherited from COGNITION)

> **The decision mechanism proposes within sim-authored bounds; the sim validates and owns truth.** The layer returns at most an *index into a sim-enumerated option set* or a *typed draft over a vetted DSL*, re-validated through the same pipeline as a player action, against the world as it is **now**. It never writes state, never mints currency, never fires an unvalidated event, is never an authz principal — and **even its generic floor is correct**. Everything irreversible/shared/value-bearing stays in deterministic code behind that boundary. Full "never-touch" list: `COGNITION.md §4`.

This is what makes "offload the whole decision layer to LLM/vector" safe: *the decision is offloaded; the authority is not.*

---

## 11. Risks & the first experiment

Ranked:

1. **Calibration over *dynamic* option sets (the keystone).** If it fails, the thresholded cascade has no trustworthy gates. *Mitigation:* the Week-1 spike gates the architecture; probs-as-rankings config flip; `calibration_version` pinning; shadow-eval before any model swap. An architecture bet, not a tuning knob.
2. **Model collapse.** Retraining on own outputs → drift. *Mitigation:* always a *stronger* teacher and/or real outcomes; eval-gate; keep a stable baseline.
3. **Cache staleness / exploitation.** Reusing a decision whose context moved (famine-bread) → wrong, sometimes exploitable. *Mitigation:* context-complete keys, TTL/event invalidation, stakes-based τ_sim, money decisions skip the cache.
4. **Seed-retirement coverage holes.** Deleting seeds "covered now" without verifying → silent quality regression. *Mitigation:* per-entry, coverage-verified, eval-gated retirement.
5. **Cost — per-decision & swarms.** Dense co-presence / hordes blow the budget. *Mitigation:* plan-and-execute amortization, squad-level decisions, hard per-zone budget, LOD by threat (`COGNITION.md §5`).
6. **Adversarial data poisoning.** Players shape their own recorded behavior to bias seeds. *Mitigation:* teacher-anchor + eval-gate + difficulty-floor validation on bindings; never let recall minimize effort unchecked.

**The first experiment (Week-1 spike).** Pick **one** decision type, a **small** criteria set: seed N scenarios → calibrate Mercury → measure **ECE / reliability** as option-set size & semantics vary (fit against the exact served quant). *This is one small turn of the whole flywheel.* If calibration holds on a bootstrapped corpus, the mechanism works; if it fails, you learned it for a week's effort instead of after building everything. **Nothing else in this doc matters until this passes.**
