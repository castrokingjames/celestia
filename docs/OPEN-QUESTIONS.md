<!-- Parking lot for unresolved / needs-analysis items so they don't block forward motion. Not decisions — questions. Each item: the question · why it matters · how we'd resolve it. Pull items out as they're tackled; link resolutions back to the owning doc. -->

# OPEN-QUESTIONS.md — Parking Lot

> Things that are **not yet clear / need analysis**, captured so we can keep moving and tackle them deliberately later. Grouped by area. Resolving an item = move the answer into its owning doc and strike it here.

---

## A. Decision mechanism (LLM / vector) — see `DECISIONS.md`

| # | Open question | Why it matters | How we'd resolve |
|---|---|---|---|
| A1 | **Calibration over *dynamic* option sets** — does ECE/reliability stay acceptable as option-set size & semantics change every call? | **The keystone.** Blocks the whole thresholded cascade. Nothing else matters until this is known. | **Week-1 spike:** one decision type, measure ECE vs option-set variation, fit against the served quant. |
| A2 | **Frame → vector**: how do we turn a structured game *frame* into the pgvector vector? Hand-engineered normalized feature vector vs an embedding model vs learned? | Determines similarity *quality*, determinism, and whether the cache even clusters. Currently unspecified. | Analysis + prototype; compare hit-rate & stability of a few encodings. |
| A3 | **Real cache hit-rate** under realistic rep/demand/criteria distributions. | COGNITION §5 flags the cache can't be counted as a cost lever until measured. | Measure in the spike with realistic distributions. |
| A4 | **Thresholds** τ_sim (similarity) & τ_dec (decision) per decision type **and per stakes**. | Wrong τ = exploitable reuse (money) or no reuse (cost). | Empirical, after A1/A3. |
| A5 | **Minimal criteria set per decision type** — which features actually move each decision. | More criteria wrecks hit-rate + calibration; need the *sufficient* set. | Empirical feature selection per decision type. |
| A6 | **The teacher model** for offline re-decision — which "better model", at what cost, one tier or escalating? | It's the anti-collapse anchor; its quality caps the whole flywheel. | Decide after A1; price it. |
| A7 | **Eval-gate definition** — exactly what gates a seed/model version (ECE + decision quality + exploit checks) and what the held-out set is. | Promotion/rollback depend on it; a weak gate lets a bad teacher poison seeds. | Define metrics + held-out construction. |
| A8 | **Collapse / drift detection** — how we monitor the flywheel isn't degrading over versions. | Silent model collapse / distribution shift. | Design monitoring (variance, baseline eval each version). |
| A9 | **S1 model choice & the S1.5 (JEV) tier** — Mica-4B specifics; is an escalation tier between S1 and S2 actually needed? | Affects latency/cost/quality of every decision. | Defer to P2; revisit after spike. |
| A10 | **Cost-model validation** — the ~1/90s interaction-rate assumption, GPU fleet at *peak co-presence density*, the S2 budget. | The business case lives or dies here (COGNITION §5). | Measured as a Phase-1 **exit gate**, not an assumption. |
| A11 | **Generated-content replay determinism** — is `canon_version` pinned on *every* draft so the Director's verdict replays? | Load-bearing + currently implicit. | Verify/enforce in the event-log schema. |
| A12 | **First spike decision type** — which single decision type do we prove calibration on first? | Determines the Week-1 experiment. | Pick (candidate: NPC daily-routine action — low stakes, clear option set). |

---

## B. Real-time world / netcode / scaling — see `REALTIME.md`

| # | Open question | Why it matters | How we'd resolve |
|---|---|---|---|
| B1 | **Per-channel CCU cap** (target ~1000) | sets the channel/zone cap + when sharding kicks in | load-test per-client StateView encoding + spatial queries at 20 Hz × N; stress **hub (population)** and a **busy combat field (activity)** separately |
| B2 | **Dungeons: shared (tier-2 zone) vs instanced (Instance/ephemeral)** | changes room model + capacity for dungeon content | gameplay decision; can mix (shared fields, instanced story dungeons) |
| B3 | **Sector shape + size** | must be ≥ interaction/view range for the hub chunk-room scheme to avoid a visible seam | pick with the combat/view-range numbers |
| B4 | **Hub chunk-room seam** | accept cosmetic seam vs hide it | 3×3 neighbor-subscription only if it bothers in practice |

## C. Other areas

*(stub — add as they surface: web3/compliance, auth edge cases, etc.)*
