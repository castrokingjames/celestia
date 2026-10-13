<!-- Generated 2026-10-06 by a multi-agent design pass: 5 facets -> YAGNI/refactor-prevention critic -> synthesis. -->
<!-- Game-first. The minimal 'bake in now' seams so later Web3 integration is additive, not a refactor. -->

# Celestia WEB3-READINESS Plan

*Single committable architecture doc. Audience: a team shipping the GAME FIRST, Web3 LATER, with no big refactor at integration. Status: authoritative; supersedes the per-facet drafts where they disagree. Reconciles ARCHITECTURE.md (Seam 6 event-log-as-truth, Risk 2 single-writer, Risk 7 versioning) and WEB3.md (§3.2 `ledger.*`, R0.2 money type, R0.5 one-writer) — it contradicts neither; it ships a strict forward-compatible subset.*

---

## 1. Thesis

**We are not building Web3. We are making the ~8 decisions that are cheap to get right in the first economy commit and ruinous to retrofit onto a live money system, so that the entire WEB3.md stack later arrives as new rows, new nullable columns, new reducer versions, and new event producers — never a migration of immutable history or a cross-codebase rewrite.** The single seam that earns this: **all value moves through one `EconomyService` module (imported by both the Colyseus room-TCB and NestJS, never reimplemented), each move is a typed, versioned, append-only event in `log.event`, and every balance is a pure replay-rebuildable projection — never an authoritative mutable row.** That one property is what makes double-entry, provenance, buckets, holds, and new currencies *addable at all later* (as new reducers over the same event stream) instead of unreconstructable. Everything that is itself replay-rebuildable (the physical `posting` table, system accounts, conservation enforcement, lots, buckets) is therefore **DEFERRED on purpose** — baking it in now is over-engineering a game that today has one non-withdrawable, zero-real-value `COIN` with nothing to taint, reserve, or settle.

---

## 2. BAKE IN NOW

Ranked by leverage (highest first). This is the whole list. If it is not here, it is deferred.

### N1 — One value-write chokepoint; money = typed append-only event; balance = pure projection
**Do:** every faucet/sink/trade/gift/grant goes through a single `EconomyService` in a shared package imported by **both** the room-TCB and NestJS. No other code writes balances — no `UPDATE wallet SET coins = coins + n` anywhere. Each call appends one typed economy event to `log.event` (inside the existing durable-before-ack Seam-6 transaction); `ledger.balance` is a projection the reducer rebuilds by replay.
**Retrofit cost avoided:** scattered balance writes are *the* retrofit-killer — adding double-entry/provenance/assets later means hunting down and rewriting every write site across two codebases, and the un-logged history can never be faithfully reconstructed. Two divergent ledgers (room's own + NestJS's own) must be byte-reconciled before any bridge can trust a balance.
**Cost now:** ≈ the shape the game needs anyway (Risk 2 single-writer, Seam 6 event-truth).

```ts
// @celestia/ledger-contract — imported by room-TCB AND NestJS. No service reimplements this.
// cognition/LLM service does NOT import it (see N6).
type Minor   = bigint;                 // integer minor units, in-process
type AssetId = 'COIN';                 // closed enum, ONE member today (NOT a hardcoded column)
type ReasonCode =                      // closed, VERSIONED taxonomy — never free text (see N7)
  | 'harvest.daily' | 'quest.reward' | 'festival.participate'   // faucets
  | 'shop.buy' | 'craft.sink' | 'market.fee'                    // sinks
  | 'player.gift' | 'market.settle';                            // transfers
interface AccountRef { ownerType: 'player' | 'system'; ownerRef: string; } // system refs internal-only today

interface EconomyService {
  grant   (a: { account: AccountRef; asset: AssetId; amount: Minor; reason: ReasonCode; idemKey: string }): Promise<Receipt>;
  spend   (a: { account: AccountRef; asset: AssetId; amount: Minor; reason: ReasonCode; idemKey: string }): Promise<Receipt>;
  transfer(a: { from: AccountRef; to: AccountRef; asset: AssetId; amount: Minor; reason: ReasonCode; idemKey: string }): Promise<Receipt>;
  balance (account: AccountRef, asset: AssetId): Promise<Minor>;   // = projection read
}
// amount is ALWAYS computed by deterministic TCB code — never from the client or the LLM.
// seq/prev_hash/fence_token/actor are stamped by the write-context, never accepted from the caller.
// DEFERRED (additive, callers unchanged): hold/capture/release, purchase, convert, payout, mint,
//   and the internal credit/debit/post double-entry primitives.
```

### N2 — `asset_id` discriminator on every money event + balance row (+ a one-row asset registry)
**Do:** no scalar `player.coins` column. Balances are keyed by `(account_id, asset_id)`; `COIN` is one row in `ledger.asset`.
**Retrofit cost avoided:** the cheapest-now / most-expensive-later decision. A dedicated scalar makes adding DEW/GEM/OMG/NFT a schema change across every projection, payload, reducer branch, query and API, plus a full faucet/sink call-site rewrite. With `asset_id`, a new currency is a single `INSERT` — data, not schema.
**Cost now:** one `text` column + a one-row table.

### N3 — `event_type@version` stamp on every economy event payload; keep old reducer versions
**Do:** every economy event payload carries `"type":"economy.posted@1"`. Old reducer versions are preserved so historical events always replay under the code that understands them (ARCHITECTURE Risk 7 / Seam 7).
**Retrofit cost avoided:** this is the under-built item that props up the entire plan. The whole deferral thesis ("write a richer double-entry/provenance reducer later and replay") is **unsound without it** — once millions of un-versioned `v1` money events exist, a `v2` reducer must infer payload shape from context, which is fragile and may be non-deterministic. Lose that and you lose the replay property that justifies every DEFER below.
**Cost now:** one string field + the discipline of a `switch(version)` in the reducer.

### N4 — Integer minor units in `NUMERIC(38,0)`; never float, never `BIGINT`; decimals only at the boundary
**Do:** money at rest is `NUMERIC(38,0)`; in-process it is `bigint`; in any jsonb payload or on the wire it is a **decimal STRING**, never a JS `number`. `decimals` lives only in the asset row and is applied only at the display/chain boundary — never in reducer arithmetic (`COIN` decimals = 0).
**Retrofit cost avoided:** `BIGINT` overflows 18-decimal token amounts (1e9 OMG × 10^18 = 1e27 > 2^63), forcing a replay-breaking column-widen **and re-encode of all immutable history** when OMG lands; float precision loss is irreversible and makes off-chain ≠ on-chain integer, i.e. guaranteed mis-settlement at bridge time. Applying `decimals` in the reducer bakes a per-asset scale assumption into pure replay code that breaks the moment a 9/18-decimal token appears.
**Cost now:** zero — COIN math is small ints; economy writes are durable-before-ack, not the per-tick hot path.

### N5 — One UNIQUE idempotency key per atomic economy ACTION (journal/event level, NOT per leg)
**Do:** the idempotency key is unique per logical action (the event), e.g. `room7:t1234:sid88:seq3`. A multi-account transfer is **one** event with **one** key.
**Retrofit cost avoided:** at-least-once delivery (Colyseus reconnect, outbox relay, NestJS retry) double-credits, and you cannot de-dupe events already applied to immutable history. **Fixes the WEB3 §3.2 bug** where `UNIQUE(idem_key)` sits on the per-leg `posting` row: a balanced 2-leg journal stamping the same key on both legs is rejected on the second leg. Idempotency belongs on the action, not the posting.
**Cost now:** one unique index.

```sql
CREATE UNIQUE INDEX ON ledger.event_idem (idem_key);   -- dedupes retries BEFORE they double-apply
```

### N6 — `account_id` is the sole money + identity principal; cognition/LLM has ZERO grant on the money schema
**Do:** the Celestia account UUID (`sub`) is the only key for balances and identity. Wallet addresses and payment-customer ids are `account_id`-**referencing rows** (their own tables, added later), never a login, never a JWT `sub`, never a join key. The cognition/LLM service does not import `@celestia/ledger-contract` and holds zero grant on `ledger.*` in the Seam-6 grant list — so a fully prompt-injected model structurally cannot move a coin.
**Retrofit cost avoided:** the single worst refactor in the plan — un-fusing a wallet-address-as-principal or payment-customer-as-identity from every FK, query and token. One "log in with wallet" or wallet-keyed balance row and the additive story is dead. Pulling the LLM out of the money path *after* it has crossed the boundary means re-drawing the TCB and re-validating every reward it ever touched.
**Cost now:** a "don't-do" rule.

### N7 — Closed, versioned `reason_code` taxonomy on every money event (never free text)
**Do:** `reason_code` is a closed enum, versioned alongside the event type.
**Retrofit cost avoided:** it is the semantic hook a later reducer uses to derive double-entry counterparties and provenance origin by replay. Intent cannot be mined back out of prose, so if it is free text, counterparty/taint reconstruction becomes guesswork.
**Cost now:** near zero; you want it for faucet/sink analytics regardless.

### N8 — Money lives in `ledger.*`; add it to the Seam-6 grant boundary now
**Do:** pick `ledger.*` (verbatim WEB3 §3.2 namespace) as the single home for currency balances, today, and register it in the Seam-6 grant list (`global/sim/player/authz/log/memory` → **add `ledger`**) with cognition-svc granted nothing on it. **Resolves the facet split** (`ledger.*` vs `economy.*` vs `player.holding`): currency balances live in exactly `ledger.balance`; stackable *items* and unique instances stay in `player.inventory`/`sim.*` as the architecture already models them. One home for currency, one for items — no two-sources-of-truth.
**Retrofit cost avoided:** a later `SET SCHEMA` move + grant re-scope + rewrite of every reference, plus the grant boundary *is* the structural enforcement of "cognition-svc can never touch money."
**Cost now:** choosing a schema name.

### N9 — DECIDE the launch value-transfer scope NOW (the cross-zone / `econ:lease` gate)
This is a **decision**, not deferred silently. The "transfer routes through the single owning room, atomic" story in N1 **only holds when both players are in the same room.** A life/farming-sim MMO with cross-village gifting almost certainly breaks that: when a gift spans two zones there is no single owning room, the single-writer-per-account invariant fails for a two-account atomic journal, and you need WEB3 R0.5's per-account `econ:lease` + a two-room escrow saga (ARCHITECTURE Open Decision #6, still open).

- **Recommended cheap path (keep `econ:lease` deferred):** constrain the launch slice so no synchronous value transfer spans two live rooms — cross-zone gifting goes through an **async mailbox**: `spend` debits the sender in their room now; a NestJS worker `grant`s the recipient out-of-session (recipient is in no room → no competing writer). Two independent single-writer events, no distributed atomicity, no `econ:lease`. The `transfer(from, to, …)` signature already exists in N1, so promoting a same-room atomic transfer later is additive.
- **If synchronous cross-zone trade/gifting MUST ship in the launch slice:** then `econ:lease:{account_id}` is a **BAKE-IN**, not a defer — retrofitting a per-account economic fence + escrow saga onto live money is exactly the migration this plan exists to avoid.

**Retrofit cost avoided:** mis-scoping here is the one place a "defer" can quietly become a live-money concurrency refactor. Decide it in Phase 0.

---

### The day-one `ledger.*` schema (strict forward-compatible subset of WEB3 §3.2 — no migration when tokens arrive)

```sql
-- Config/registry. ONE row at launch: COIN. Adding DEW/GEM/OMG/LAND later = INSERTs.
ledger.asset (
  asset_id    text PRIMARY KEY,                      -- 'COIN'
  asset_class text    NOT NULL DEFAULT 'fungible',   -- 'fungible'|'nft'|'semi_fungible'
  decimals    smallint NOT NULL DEFAULT 0            -- display/chain exponent ONLY; never in arithmetic
  -- DEFER (cheap ALTER on a tiny config table): is_token, is_withdrawable, cap_minor, chain_binding
);

-- Currency balance PROJECTION — rebuildable by replaying log.event economy events through the reducer.
-- NOT authoritative, NOT mutable truth. Singular PK (no bucket — see DEFER).
ledger.balance (
  account_id     uuid NOT NULL,                      -- Celestia account UUID OR a system ref; NEVER a wallet/payment id
  asset_id       text NOT NULL REFERENCES ledger.asset,
  balance_minor  numeric(38,0) NOT NULL DEFAULT 0,   -- integer minor units
  last_event_seq bigint        NOT NULL DEFAULT 0,   -- double-apply guard / projection cursor
  version        bigint        NOT NULL DEFAULT 0,   -- optimistic concurrency / single-writer fence
  PRIMARY KEY (account_id, asset_id),
  CHECK (balance_minor >= 0)                         -- user accounts never overdraw; reducer rejects first
  -- DEFER (replay-rebuild, not migration): bucket (PK ext), held_minor, lot_id/provenance columns
);
```

The economy event rides the existing `log.event` hash-chain. Payload (decimal strings, PII-free — see landmine L9):
```jsonc
{ "type": "economy.posted@1",
  "account_id": "...", "asset": "COIN", "delta_minor": "+50",   // SIGNED string
  "reason": "harvest.daily",
  "counterparty": null,                                          // or recipient account_id for transfers
  "idem_key": "room7:t1234:sid88:seq3" }
```

**Write path (reuses the one Seam-6 Postgres txn):** `validate (TCB) → append economy log.event → reducer projects balance update → ack`. The owning room is the sole writer while `presence=active`; NestJS routes through it or refuses (Risk 2, applied to money). Reducer is **pure, integer-only, seeded, no wall-clock**, so replay is deterministic now and reproduces any later-added double-entry/provenance identically.

**LLM-amount replay rule (bake-in):** if any faucet amount is derived from an LLM reward-tier index, the chosen index is captured in the logged event (`log.oracle_call.chosen_idx`, Risk 6) and the economy reducer **reads the logged index on replay, never recomputes it** — otherwise replay diverges. The model returns at most an *index into a sim-authored, pre-capped reward enum*; the amount is always TCB code and pays non-convertible COIN.

**Conservation as a cheap audit, not hot-path infrastructure:** keep `Σ delta_minor per asset = 0` as a periodic replay-based job (freeze asset + page on drift). Do **not** build the physical `posting` table / `SYS_*` accounts to get it — they are replay-derivable (see DEFER D1).

---

### Entitlements (keep only the cheap seams; ratify the AUTH.md deltas)
Three bake-ins; the rest defers to the second grant source.
- **E1 — one check predicate, keyed by a stable text KEY, never by source.** `hasEntitlement(principal, key)` in `@celestia/auth-contract` is the only access check (`'alpha'` is the sole key at launch). Avoids editing every call site when wallet/NFT/Stripe/Stars sources arrive.
- **E2 — relax now, while alpha is the only consumer:** entitlements are grants with OR-semantics (`UNIQUE(account_id, entitlement_key, source, source_ref_key)` instead of `UNIQUE(account_id,type)`), and `entitlement_key` is a `text` slug, not an ENUM. Avoids a live constraint migration + check rewrite the day two sources confer the same capability, and avoids `ALTER TYPE` per new capability.
- **E4 — identity wall:** `account_id` is the sole principal; `idp_provider` is for logins only (`discord` now; never `telegram`, never `wallet`). (Same rule as N6.)
- **Ratification note:** E1/E2 touch the **frozen** `@celestia/auth-contract` (AUTH.md MUST-7, guarded by MUST-13). These are sound but must be explicitly ratified and the MUST-13 contract test updated — not silently adopted.

---

## 3. SAFE TO DEFER

Each is replay-rebuildable, a new nullable column, a new row, or a new event producer — additive by construction.

- **D1 — Physical double-entry `posting` table + `SYS_EMISSION`/`SYS_SINK` system accounts + continuous conservation enforcement.** *Corrected from the drafts (over-built).* The posting table is a replay-rebuildable projection of the signed deltas already in `log.event`; counterparties are derivable from `reason_code` (N7). Build it (and the SYS accounts) when auditable conservation/solvency actually matters (near real value). Until then, conservation is a cheap periodic replay audit, not hot-path machinery.
- **D2 — `owner_type`/`owner_ref` polymorphic account key.** Only needed once system/treasury/escrow accounts exist — which is deferred with D1. The account table is itself a projection, so the column is free to add then. Bare `account_id` suffices now.
- **D3 — Reserved stub columns** (`lot_id`, `instance_id`, `fence_token`, `held_minor`, `bound`, `bucket`). *Corrected (over-built).* Adding a nullable column to a replay-rebuildable projection is instant later; reserving them now cargo-cults WEB3's schema and falsely implies the projection shape is frozen. Drop them — keep the day-one schema honest.
- **D4 — Balance buckets** (`spendable`/`withdrawable`/`escrow`). All launch value is one implicit non-withdrawable bucket. `bucket` becomes a PK extension via drop-and-replay (projection, not live-money migration), so the day-one PK stays singular.
- **D5 — Provenance lots + worst-case-inherited taint propagation.** A single non-withdrawable COIN has nothing to taint, and COIN is never withdrawable even in the final design. Initialize lots as a nullable column + a new reducer when the first convertible source (GEM purchase/deposit) appears. Building propagation now risks baking in a *wrong* taint model.
- **D6 — Holds / reservations** (`hold`/`capture`/`release`, `available = balance − held`). Additive methods; `held` defaults 0 so `grant`/`spend`/`transfer` semantics are unchanged until a cross-session market or in-flight withdrawal needs it.
- **D7 — Additional assets DEW/GEM/OMG + NFT classes LAND/CROP/COSM.** The asset dimension already exists (N2); adding members is config + new reason codes. NFT instances live in `player.inventory`/`sim.*` now; the `ledger.nft` projection is replay-buildable later.
- **D8 — The entire on-chain edge:** chain adapter (TON/BNB behind a hexagonal port, chain = config), wallet linking (a new entitlement source, not a login), deposit path (new reason_code + indexer), withdraw path / signer / HSM / hot-cold custody (debit-first saga, `is_withdrawable` defaults false), Refinery DEW→OMG (scheduled deterministic settlement event over the same journal), reserve + solvency, mint authority + emission caps. The last, legally-gated edge; none of it is caller-facing.
- **D9 — Per-account `econ:lease` generalization** — deferred *only under the N9 async-mailbox decision*. If synchronous cross-zone transfer ships, this moves to BAKE-IN.
- **D10 — ComplianceGate / KYC / AML / 18+ / OFAC / geofence / Travel Rule.** A gate the chokepoint calls that returns ALLOW until wired; enabling is config + vendor.
- **D11 — Governance = soulbound reputation; wallet/NFT-derived entitlements; full event-sourcing of the entitlement projection.** New `source` producers behind the single predicate (E1); grant/revoke become reversible once routed through `log.event`.
- **E-defer — EntitlementService mutation wrapper + `source_ref_key` idempotency digest.** *Corrected (over-built).* With Discord-role-sync as the only grant producer at launch, a mutation-service abstraction and per-source dedup digest are premature. Introduce them when the second source is actually built.

---

## 4. REFACTOR-LANDMINES (never adopt; cheap correct alternative in italics)

- **L1 — Float money** (`REAL`/`DOUBLE`/JS `number`). Overflow + rounding dust break conservation and replay, and mis-settle every withdrawal — unrecoverable. *→ `NUMERIC(38,0)` integer minor units; decimal strings in jsonb/wire.*
- **L2 — `BIGINT` money.** Overflows 18-decimal token amounts (>2^63); switching after launch migrates every balance **and re-encodes all historical payloads.** *→ `NUMERIC(38,0)`.*
- **L3 — Client-authoritative or client-sent balances/amounts.** Every client becomes a money printer; fixing it is a protocol + anti-cheat rewrite. *→ intents only; TCB computes amounts; no amount/balance field on the wire.*
- **L4 — Scattered ad-hoc balance writes** (`UPDATE … SET amount = amount + N`). No chokepoint to add idempotency/provenance/holds/caps/compliance; the un-logged history is unreconstructable. *→ single `EconomyService` over `log.event` (N1).*
- **L5 — Mutable authoritative balance rows** instead of a projection of events. Kills replay-based introduction of double-entry/provenance/buckets. *→ balance is a pure replay projection.*
- **L6 — Two ledger implementations** (room keeps its own, NestJS keeps its own). Divergent reducers that must be byte-reconciled before any bridge can trust a balance. *→ one shared `@celestia/ledger-contract` package.*
- **L7 — Flat per-currency columns** (`players.coins`, `.gems`, `.omg`). Each asset = live-money migration + query rewrite. *→ tall `(account_id, asset_id, balance_minor)` on a one-row registry (N2).*
- **L8 — Identity coupled to a wallet/payment id** (wallet as JWT `sub`, balances keyed by wallet). The worst refactor in the plan + wallet wrongly becomes an auth principal. *→ `account_id` sole key; wallet/payment reference it (N6).*
- **L9 — PII inside economy payloads.** ARCHITECTURE deletes accounts by destroying the per-account DEK + tombstoning (crypto-shred). If a shredded field is one the economy reducer replays, conservation and balance reconstruction break for every surviving account — unrecoverable. *→ economy payloads are purely structural (`account_id`, `asset_id`, `delta_minor`, `reason`, `idem_key`); state up front what happens to a deleted account's residual COIN in the conservation sum (route it to a system sink via a tombstone event, so the sum stays balanced without replaying the shredded account).*
- **L10 — LLM allowed to mint/grant or name an amount/counterparty "just for the MVP."** A prompt-injectable money printer the instant value is real, and non-deterministic faucets break replay. *→ zero grant on `ledger.*`; model returns an index into a capped enum; TCB computes the amount; replay reads the logged index, never recomputes it.*
- **L11 — Per-leg idempotency** (`UNIQUE(idem_key)` on `posting`). Rejects the second leg of a multi-leg transfer and can't be fixed after double-apply. *→ idempotency on the action/event (N5).*
- **L12 — Free-text `reason`.** Later taint/faucet-sink/counterparty classification can't be mined out of prose. *→ closed versioned enum (N7).*
- **L13 — Un-versioned economy payloads.** A `v2` reducer can't reliably parse `v1` money events; the whole replay-based deferral thesis collapses. *→ `event_type@version` + preserved reducer versions (N3).*
- **L14 — Wall-clock / unseeded RNG in money math.** Diverges on replay once replay is trusted (demurrage, settlement). *→ pure, seeded, integer, no-wall-clock reducer; largest-remainder splits.*
- **L15 — Entitlement `UNIQUE(account_id,type)` / ENUM key / source-branching inline checks.** Blocks two sources granting one capability and forces a live constraint migration + call-site sweep. *→ grant rows + OR-semantics + text slug + one `hasEntitlement` predicate (E1/E2).*
- **L16 — Syncing economy/on-chain/provenance fields over `@colyseus/schema`.** Couples the client to economy internals; any new field forces a `protocolVersion` bump + client redeploy. *→ wire only a minimal holdings/counts projection — and still gate it with the Risk-7 `protocolVersion` the day that projection's shape changes (e.g. multi-currency display).*

---

## 5. Mapping to game build phases (kept light — the game is the focus)

- **Phase 0 (first economy commit — the only phase with mandatory Web3-readiness work):** N1–N8 land together, because they are the shape of the economy itself: `EconomyService` chokepoint, `ledger.asset`(1 row) + `ledger.balance` projection, versioned PII-free events in `log.event`, `NUMERIC(38,0)`, action-level idempotency, `account_id`-only principal, closed `reason_code`, `ledger` on the grant list with cognition-svc at zero. **Also decide N9** (async-mailbox vs synchronous cross-zone transfer) before any gifting feature is designed — this is the one decision that can flip an item from DEFER to BAKE-IN. Ratify the E1/E2 AUTH.md deltas + update the MUST-13 test.
- **Throughout game dev:** every economy PR passes **one test** — *"could this line still be correct the day COIN sits next to a withdrawable OMG?"* A float, a client-trusted amount, an ad-hoc `UPDATE`, a per-currency column, a wallet-keyed row, an un-versioned payload, or an LLM-named amount fails it. Reject at one-line-fix cost, not live-money-migration cost.
- **Everything in §3 (DEFER):** not touched until the Web3 track starts. No posting table, no SYS accounts, no buckets, no lots, no holds, no stub columns, no EntitlementService, no chain code.

---

## 6. Integration day — what literally gets added (and why nothing existing is rewritten)

When Web3 is turned on, the diff is **purely additive** because truth is a versioned event stream and balances are projections:

1. **New rows:** `INSERT` DEW/GEM/OMG + NFT classes into `ledger.asset` (N2 made this data, not schema). New `reason_code` enum members + a new `economy.posted@2` reducer version (N3 made old events still replay).
2. **New reducers/projections over the existing event stream (no caller change, no migration):** replay to materialize the physical `posting` table + `SYS_*` accounts (D1), provenance lots/taint (D5), buckets (D4), transfer history. These are *re-projections*, which is why they were safe to defer.
3. **New nullable columns** on `ledger.asset`/`ledger.balance` (`is_token`, `is_withdrawable` default false, `held_minor` default 0, `lot_id`, `bucket`). Non-blocking `ADD COLUMN`.
4. **New methods on `EconomyService`** (`hold`/`capture`/`release`, `purchase`, `convert`, `payout`, `mint`). `grant`/`spend`/`transfer`/`balance` are unchanged, so every existing call site is untouched.
5. **New edge components, bolted onto the module internals and the grant boundary — not into game code:** chain adapter (config-selected TON/BNB), wallet-link ceremony (a new entitlement *source* behind `hasEntitlement`, never a login), deposit indexer, withdraw saga + signer/HSM, Refinery settlement job, ComplianceGate (flip from ALLOW), and — if N9 chose the async mailbox — the `econ:lease` + two-room escrow saga.
6. **New entitlement sources** (wallet-holding, nft-ownership, Stripe, Telegram Stars, governance_rep) + the deferred EntitlementService wrapper, all behind the one `hasEntitlement` predicate. Consumers never change.

**Nothing existing is rewritten** because the four irreversible facts were captured on day one — value flows through one module, every move is a versioned typed append-only event, money is `NUMERIC(38,0)` integer minor units, and `account_id` is the sole principal — and everything else is, by construction, a replay away.
