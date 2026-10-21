# PALLAS — target architecture + refactor roadmap

> **Status:** roadmap, not a build order. We shipped a seam-complete **v0** (retrieval over pgvector, driving mobs). This records the **target** (compiled local FSM shards from pgvector, confidence-driven flywheel) and the **modular refactors** to get there. Nothing here is urgent: every target piece sits behind a **port that already exists**, so each lands independently when a real need pulls it. See `docs/DECISIONS.md`, `docs/COGNITION.md`.

## Principle

**The AI authors the FSM offline; the FSM runs the monsters online.** Intelligence lives at compile/author time (LLM + pgvector); the runtime is a dumb, fast, **deterministic** FSM. Net: LLM-quality behavior at FSM speed/cost (G9-friendly — the non-determinism stays offline). The decision always comes from **data** (seeded/LLM-authored precedents), never a hand-written branch.

## What we have now (v0 — built + tested)

- **Ports** (`pallas/types.ts`): `PrecedentStore`, `EmbeddingProvider`, `MemoryStore`, `CognitionGateway`, `AcceptMode`.
- **Orchestrator** (`pallas/pallas.ts`): `decideFromPrecedent` (tier-1 1-NN), `accept` (gates/rankings, `SIM_FLOOR`, `abstainP`), `dispatch`/`drain` (off-tick model path; gateway `null`).
- **Store**: `InMemoryPrecedents` (cosine) + `PgPrecedents` (pgvector, behind the port); migration `0005_precedent.sql` → `memory.precedent (vector(16))`.
- **Embedder**: `HashEmbedder` — a **toy** 16-dim char-hash (text-similarity, not semantic).
- **Content**: `content/mob-situations.ts` = `describeSituation` encoder + hand-authored `MOB_TACTIC_SEED`; `content/mobs.ts` = per-kind stats.
- **Consumer**: `MobAISystem` — perceive → situation sentence → `decideFromPrecedent` → `accept` → act (flee/attack/wander + respawn); an `attack` is re-validated through Fornax (G2).
- **Runtime shape**: the decision is **off-tick async, served by a live pgvector roundtrip**; the **action** runs per-tick at 20 Hz.

## Target architecture

1. **Runtime = local in-memory brain shards**, one per **(monster kind × decision schema/event)**, lazy-loaded per active kind, evicted when idle. **No pgvector roundtrip at runtime.** Memory scales with *active* monsters, not with corpus size.
2. **Each shard = the kind's precedents as an in-memory vector set** → live nearest-neighbor **with confidence** (nearest similarity + top-1/top-2 margin + top-k agreement). *Not* a flat key→action table — that goes blind on novelty (can't tell "0.4 similar" from "miss").
3. **Compile step (offline)**: pgvector (source of truth) → brain shards + a **manifest** (scope → file + version/hash); atomic write; Pallas reloads on a version bump.
4. **Decision cadence**: synchronous, local; rate chosen for **behavior quality** (hysteresis/dwell to avoid flip-flop), not latency. Action stays 20 Hz. **LOD / dormancy / stagger** the perceive-decide step at scale (perception, not the lookup, is the cost).
5. **Confidence-driven flywheel**: log **sub-threshold + miss** situations (async, deduped + frequency, **feature-only / no player id**) → offline LLM re-seed → recompile shards.
6. **LLM authoring + gap-fill**: the `CognitionGateway` (null now) **generates precedents offline** and resolves **live misses** off-tick (then caches the answer as a new precedent). Human curates.
7. **Real embedder** behind `EmbeddingProvider` (replace `HashEmbedder`) → larger dim → migration + re-seed. The quality lever (enables true fuzzy generalization).
8. **Stateless vs stateful FSM**: the shard key supports both. Stateless = `situation → action`. Stateful = `(current state, situation) → (next state, action)`, runtime tracks each mob's state. Decide per decision type.

## Refactor increments (modular; each behind an existing port; order is need-driven)

- **R1 — Persist the source.** Add a `situation` (text/features) column to `memory.precedent` + write it on seed. Unlocks re-embed, logging, and compile. *(enabler for most below; small)*
- **R2 — Compile step.** Offline tool: pgvector → brain shards + manifest + versioning. New; zero runtime change.
- **R3 — Shard loader.** Pallas loads a shard per (kind, schema): lazy + cache + evict; runtime serves from the in-memory shard; pgvector becomes fallback + source. Swaps behind `PrecedentStore` — no consumer change. *(kills the runtime roundtrip + the memory worry)*
- **R4 — Live confidence.** Surface nearest-similarity + margin + agreement from `decideFromPrecedent` (we already compute `score`/`abstainP`); expose on the proposal.
- **R5 — Decision log (flywheel intake).** Async sink for sub-threshold/miss situations; dedup + frequency; feature-only. Offline consumer re-seeds. *(needs R1)*
- **R6 — Real embedder.** New `EmbeddingProvider` (local model or API) → dim change → migration + re-seed. *(needs R1 to re-embed existing rows)*
- **R7 — CognitionGateway (LLM).** Offline precedent generation + live-miss gap-fill (tier-2/3). Fills the null slot. *(uses R5's log as input)*
- **R8 — Stateful FSM (optional).** If a decision type wants states + transitions, extend the shard schema + track per-mob current state.

## Why it's safe to defer

v0 runs today. Scale pulls in **R2/R3** (compile + local shards); quality pulls in **R6** (real embedder); learning pulls in **R5/R7** (log + LLM). Because each hides behind an existing port, they're swap-in refactors with no call-site churn — we pour them in when the need is real, not up front. That's the point of the ports.
