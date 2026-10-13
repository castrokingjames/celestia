<!-- Generated 2026-10-06 by a multi-agent design pass: 5 facets -> adversarial fraud/economy/regulatory red-team -> synthesis. -->
<!-- Custodial-first, chain-agnostic. Economy is built & balanced OFF-CHAIN; the on-chain bridge is the LAST, legally-gated step. -->

# Celestia — Web3 & Tokenomics Design

**Status:** Authoritative design, synthesized from five facets and reconciled against the red-team report. **This document supersedes the individual facet drafts wherever they conflict** — §0 records the binding reconciliations. Audience: the core engineering + a to-be-retained compliance/securities counsel. Non-cheerleading by mandate.

---

## 0. Reconciliation decisions (binding — resolves the red-team INCONSISTENCIES)

The five facets disagreed on seven load-bearing points. The red team is correct that divergent implementations of "the same" ledger create exploitable seams. These are now **locked**; the rest of the doc assumes them.

| # | Conflict | **Binding decision** |
|---|---|---|
| R0.1 | Three asset models (COIN/DEW/OMG vs GEM/OMG_SOFT/OMG/vOMG vs single CELESTIA + buckets) | **One model (§1):** `COIN` (base, non-token) · `DEW` (soft, play-to-earn, non-tradeable) · `GEM` (premium, fiat-bought, spend-only, **never a token, never convertible to OMG**) · `OMG` (the single tradeable/bridgeable/governance token; sourced **only** from the Refinery and on-chain deposits) · NFTs `LAND`/`CROP`/`COSM`. **`vOMG` is dropped**; governance rides soulbound reputation (§8). |
| R0.2 | Money type: `BIGINT` vs `NUMERIC(38,0)` vs `numeric(78,0)` | **`NUMERIC(38,0)` everywhere, scale 0, integer minor units.** `BIGINT` is rejected (18-decimal EVM amounts overflow 2^63). `decimals` lives only in the asset registry, applied **only** at the display/chain boundary, never in arithmetic. (ARCHITECTURE line 192 "integer money, no wall-clock" is satisfied; it only mandated *integer*, not the width.) |
| R0.3 | Deposit withdrawability: "spend-only, round-trip flagged" vs "pass-through withdrawable=true" | **DEPOSITED lots are spend-only, OR withdrawable only back to the same source address after a long aging window.** No free pass-through. This closes the mixer/reorg-abuse findings (§6 E-DEP, §10 #10). |
| R0.4 | Relationship/dialogue faucet pays DEW ("not botifiable") vs "never make chat/embedding a faucet" | **The no-chat-faucet rule wins.** Dialogue/affection milestones **never** mint withdrawable-origin value. They pay `COIN` or non-convertible `DEW`, behind the Risk-8 embedding caps (§3). |
| R0.5 | Two fence mechanisms (zone fence vs per-account `econ:lease`) | **One per-account economic fence** (`econ:lease:{account_id}`), layered under the zone fence. The owning room holds it while `presence=active`; NestJS acquires it (or routes through the room) for out-of-session writes. One logical writer per account for money, across rooms and NestJS both (§3). |
| R0.6 | Solvency invariant scope vs provenance | **Bucket/provenance-aware.** Reserve backs **only withdrawable OMG** (`EARNED` + eligible `DEPOSITED`) + in-flight. `PURCHASED`/`GEM`/non-withdrawable lots are **not** liabilities and are **not** reserved (§4). |
| R0.7 | Governance: `sqrt(stake)×rep` vs `vOMG` vs snapshot entitlements | **Soulbound-reputation-dominant, off-chain snapshot, implemented as reversible entitlements (Facet-4 mechanism).** Staking-for-weight is **dropped by default** (securities surface); if ever added it is bounded and rep-gated (§8). |
| R0.8 | Provenance treated as fungible-on-transfer while balances are conserved | **Provenance is a conserved, worst-case-inherited property (§2).** Sale/yield proceeds inherit the **lowest withdrawability / highest taint** of the inputs that funded them. This is the single most important fix in the document — it is the root cause of the #1 ranked risk. |

---

## 1. Overview + governing principle

Celestia's token economy is built as an **off-chain, event-sourced, double-entry, server-authoritative ledger in Postgres first** — all four token roles live here, fully tunable, reversible, and with **zero real value at stake** — and the on-chain bridge (deposit / withdraw / mint) is an **optional edge enabled LAST, per-asset × per-jurisdiction, behind regulatory gating and legal opinions**. The economy is shipped, balanced, and red-teamed with nothing withdrawable before a single token touches a chain. This extends the existing trust spine ("the LLM proposes, the sim disposes; the client is not trusted") with one clause: **the blockchain and the wallet are also not trusted and are NOT the source of truth** — the chain is an untrusted external oracle (logged like `log.oracle_call`), the wallet is an entitlement/ownership source at the edge, never an auth principal, and the deterministic Postgres ledger is the only authority on balances. Faucets, sinks, mint authority, and every currency/affection number are deterministic TCB code — **never the LLM**. The reason the bridge is deferred is asymmetry: off-chain every mistake is reversible with a compensating entry; on-chain nothing is, and the day withdrawal is enabled **every economy bug becomes a theft**.

**The honest headline, stated once:** the maximal-ambition configuration (all four roles + play-to-earn cash-out) converts the known Risk-8 Sybil cost-DoS into a *self-funding, profitable* attack and simultaneously drags in money-transmission, securities, and gambling law. Much of this document is the gauntlet that value must survive before it is withdrawable, and an honest list of what must be deferred or legally cleared.

---

## 2. The dual-token economy at a glance

### 2.1 Three-layer currency stack (dual-token over a non-token base)

The dual-token (SOFT + HARD) sits **above** a base currency that is deliberately *not* a token. Keeping the base non-tradeable is the single most important cozy-vs-extraction firewall.

| Layer | Code | Supply | Tradeable / bridgeable | Bought with fiat? | Withdrawable? | Role |
|---|---|---|---|---|---|---|
| **Base (not a token)** | `COIN` | uncapped, sim-balanced | **Never** | No | No | the cozy loop: seeds, tools, build, shop |
| **Premium (not a token)** | `GEM` | n/a (revenue, not a liability token) | **Never** | **Yes** (Stripe / Telegram Stars) | **Never** | (a) premium/hard currency; cosmetics, convenience, land bids |
| **SOFT token** | `DEW` | uncapped; per-acct daily cap × rep + demurrage | **No** | No (earn-only) | **No** (only exit is the Refinery) | (b) play-to-earn yield; crafting/upgrade sink fuel |
| **HARD token** | `OMG` | hard cap 1,000,000,000, genesis-fixed | **Yes** (the only bridgeable asset) | **No** (see note) | **Yes** (last, gated, `EARNED` lots only) | (b) cash-out, (d) governance, store-of-value |
| **NFT classes** | `LAND`/`CROP`/`COSM` | per-collection caps | Yes (export last) | via `GEM`/`OMG` | per-collection | (c) tradeable assets |

**Why `GEM` and not "buy OMG with fiat" (resolves R0.1 + the app-store/Stars regulatory hole):** routing premium purchases to a **non-tokenized `GEM` that can never convert to `OMG`** keeps fiat→withdrawable value structurally impossible on the default path. This (a) satisfies Apple/Google IAP and Telegram Stars ToS (digital-goods-only, no crypto cash-out — Stars on iOS routes through Apple IAP), (b) makes "buy premium with a stolen card → cash out" impossible by construction, and (c) shrinks the securities surface. **Recommendation: `GEM` is the only fiat rail; `OMG` is earned or deposited, never sold for fiat by us.** If product insists on a fiat→`OMG` path, those lots are `PURCHASED`-tainted, spend-only, non-withdrawable, and carry the full card-maturity window — but the clean posture is to not build it.

### 2.2 The four roles, mapped

- **(a) Premium / hard currency → `GEM`.** Stripe (web), Telegram Stars (Mini-App). Spend-only prepaid digital good; never withdrawable; never converts to `OMG`.
- **(b) Play-to-earn / cash-out → `DEW` earned in-game → refined to `OMG`.** The only `OMG` eligible to bridge out is `EARNED`-tagged, aged, provenance-clean, and KYC/age-cleared (§6, §10).
- **(c) NFT assets → `LAND`/`CROP`/`COSM`.** Minted by deterministic sim events, never the LLM, never the client; off-chain rows first, exportable on-chain last.
- **(d) Governance / utility → soulbound reputation (dominant) + bounded `OMG` snapshot weight.** Advisory, guardian-backstopped, cannot touch the TCB (§8).

### 2.3 Faucet / sink table (illustrative minor-units; all tunable live, all deterministic)

| Flow | Asset | Δ | Rate limit / cap | Botifiable? | Convertible to OMG? | Notes |
|---|---|---|---|---|---|---|
| **FAUCETS** |||||||
| Daily first-harvest | DEW | +50 | 1/day | yes | yes (via Refinery) | small, flat |
| Crop harvest by quality | DEW | +1..+20 | per-acct 500 DEW/day × rep | yes | yes | scaled by reputation |
| Quest / story-beat | DEW | +25..+100 | per quest, idempotent | no | yes | authored content |
| **NPC relationship milestone** | **COIN / non-conv. DEW** | +100 | once/milestone, behind embedding caps | **yes (LLM-driven)** | **NO (R0.4)** | dialogue-driven → cannot mint withdrawable value |
| Festival participation | DEW | +50 | per event | partially | yes | social, timed |
| Land yield accrual | DEW | +tier | **cluster-capped (§7)**, PoH per plot | yes | **inherits land's provenance taint** | rentier risk, flagged §9/§11 |
| **Refinery settlement** | **OMG (`EARNED`)** | pro-rata | **dynamic epoch budget (§6)** | — | is the exit | only player `OMG` source |
| Premium purchase | **GEM** | +paid | KYC tiers | — | **never** | tagged purchase lot, spend-only |
| Alpha airdrop (Discord role) | OMG (`EARNED`, locked) | fixed | one-time | — | after aging | ties to existing entitlement source |
| **SINKS** |||||||
| Seeds/tools/build/shop | COIN/DEW | − | — | — | — | core cozy sink |
| Speed-ups, stamina | DEW | − | diminishing returns | — | — | convenience |
| Gift / cosmetic crafting | DEW+GEM/OMG | − | — | — | — | big sink; feeds NFTs |
| Land upkeep / tax | DEW | −/period | per tier, scales w/ cluster holdings | — | — | anti-hoarding holding cost |
| Market listing fee + trade tax | DEW/OMG | − | % of sale | — | — | burns on every trade |
| NFT mint / export fee | DEW+OMG | − | capped per collection (§7) | — | — | sink + wash-limiter |
| Demurrage (idle decay) | DEW | −1%/day after 7d idle | **event-sourced burn legs (§9)** | — | — | anti-dump |
| Refinery burn | DEW | − (100% committed) | per epoch | — | — | all submitted DEW burned |
| Land primary auction | GEM/OMG | − (burn/treasury) | — | — | — | §7 |
| Bridge-out fee | OMG | − | per withdrawal | — | — | §10 |

### 2.4 Cozy-vs-extraction mitigations (addresses E13 cozy collapse)

The central product danger is the **overjustification effect**: a cash-out token crowds out intrinsic cozy motivation; players stop *inhabiting* the town and start *extracting* from it; mercenaries churn the instant yield dips (Axie, StepN — §6.1). This can kill the game even if the tokenomics are solvent. Mitigations, most structural:

1. **The cozy loop is complete with zero Web3.** `COIN`, relationships, story, affection, festivals are a full game. A player who never links a wallet or earns a token loses nothing core. **KPI: measure intrinsic retention of non-token players as a first-class metric.**
2. **Cap cash-out hard.** Per-account `OMG`→fiat ceiling per period + the fixed Refinery budget → Celestia **cannot** be a full-time income. Removes the quit-your-job extraction class and the bot-farm business case.
3. **Decouple yield from grind (the Refinery).** Grinding harder earns *more `DEW` that dilutes*, not more `OMG`. The optimization treadmill has no payoff.
4. **Reward the un-botifiable with non-convertible value only.** Relationship/story/creative play pays `COIN`/non-convertible `DEW` (R0.4) — satisfying, but not a cash faucet, and never embedding-cost-coupled.
5. **No pay-to-win, ever.** Tokens buy cosmetics, capped-yield land, convenience — never affection, never story outcomes, never competitive power. Affection remains deterministic TCB state and is not purchasable.
6. **Bots can't outcompete humans** (§3, §6): reputation-weighted Refinery + device attestation + PoH + per-account/per-cluster caps.
7. **Demurrage** nudges `DEW` toward cozy sinks rather than hoard-and-dump.

---

## 3. The custodial-first off-chain ledger

### 3.1 Writer boundary (resolves R0.5)

| Actor | Ledger authority |
|---|---|
| **Client (Godot)** | None. Intents only. Never holds a key, never names a trusted amount. |
| **Colyseus room (TCB)** | Sole writer while `presence=active`, for in-session chain-free events (faucet, sink, in-zone market, crafting). Holds the per-account **economic fence**. **Zero chain access, zero keys, cannot initiate a withdrawal or mint.** |
| **NestJS economy svc** | Owns the ledger at rest + all cross-session/edge ops (purchase credit, convert, deposit credit, withdraw authorization, admin adjust). To write a mid-session player it **acquires the economic fence or routes through the owning room, else refuses** (the Risk-2 rule, now applied to money). |
| **Treasury/Bridge svc** | The only component touching a chain or HSM. Builds/broadcasts tx, verifies deposits, reconciles reserves. **Never computes balances** — it is handed already-validated, already-debited authorizations. |
| **Cognition svc / LLM** | **Zero `ledger.*` grant.** The model can at most return an index into a sim-authored, already-capped option set; it can never name a currency amount. |

**One economic fence per account (R0.5).** `SET NX PX` lease + monotonic `INCR` fence token on `econ:lease:{account_id}`, layered beneath the zone fence (Seam 5). Every balance-affecting `log.event` append carries `WHERE fence_token = :token` (Seam-6 fenced append). This guarantees ≤1 writer per account across rooms **and** NestJS — a purchase/withdrawal arriving while the player is active in a zone is serialized against the room's in-session writes rather than racing them. A paused writer that wakes cannot clobber the new owner.

### 3.2 Schema (grant scope `ledger`; cognition svc gets no grant)

The token ledger is a **typed event family inside the existing `log.event` truth log** (same `seq`, `prev_hash` hash-chain, fence-guarded append). `balance`/`lot`/`nft` are **replayable projections**. Movements are **double-entry** against system accounts so conservation is a checkable invariant.

```sql
ledger.asset(
  asset_id        text PRIMARY KEY,         -- 'COIN','DEW','GEM','OMG','LAND','CROP','COSM'
  asset_class     text NOT NULL,            -- 'fungible'|'nft'|'semi_fungible'
  decimals        smallint NOT NULL,        -- display/chain exponent ONLY (TON=9, EVM=18)
  is_token        boolean NOT NULL,         -- COIN/GEM = false; DEW/OMG = true
  is_withdrawable boolean NOT NULL DEFAULT false,  -- GATE: false for EVERY asset at launch
  cap_minor       numeric(38,0),            -- OMG = 1e9 * 10^decimals; NULL = uncapped
  chain_binding   jsonb                     -- NULL until a chain is chosen
);

-- One account per (owner, asset). System singletons give every mint/burn a counterparty:
--   SYS_EMISSION (goes negative = circulating supply), SYS_SINK (burn), SYS_FEE,
--   SYS_TREASURY, SYS_REFINERY_POOL, SYS_BRIDGE_RESERVE, SYS_ESCROW
ledger.account(account_id uuid PK, owner_type text, owner_ref text, asset_id text,
               account_kind text,  -- 'liability'|'issuance'|'sink'|'fee'|'treasury'|'reserve'|'escrow'
               status text DEFAULT 'active', UNIQUE(owner_type,owner_ref,asset_id));

-- APPEND-ONLY journal; one row = one leg. NEVER updated/deleted.
ledger.posting(
  posting_id   bigserial PK,
  journal_id   uuid NOT NULL,              -- legs sharing journal_id are one atomic txn
  account_id   uuid NOT NULL,
  asset_id     text NOT NULL,
  instance_id  text,                       -- NFT token_id; NULL for fungible
  delta_minor  numeric(38,0) NOT NULL,     -- +credit / -debit, integer minor units
  lot_id       bigint,                     -- provenance tranche consumed/created (§2)
  event_seq    bigint NOT NULL REFERENCES log.event(seq),  -- TRUTH LINK
  fence_token  bigint,                     -- economic fence (R0.5)
  reason_code  text NOT NULL,
  idem_key     text,
  UNIQUE(idem_key)
);

ledger.balance(account_id, asset_id, bucket text,  -- 'play_soft'|'spendable'|'withdrawable'|'escrow'
               balance_minor numeric(38,0) DEFAULT 0, held_minor numeric(38,0) DEFAULT 0,
               last_event_seq bigint DEFAULT 0, version bigint DEFAULT 0,
               PRIMARY KEY(account_id,asset_id,bucket),
               CHECK (account_kind NOT IN ('liability','escrow') OR balance_minor - held_minor >= 0));

-- Reservations that reduce available WITHOUT a posting until capture (card auth/capture model).
ledger.hold(hold_id uuid PK, account_id, asset_id, instance_id, amount_minor numeric(38,0),
            reason text, status text, expires_at timestamptz, capture_journal uuid,
            idem_key text, UNIQUE(idem_key));
```

**Invariants (checked continuously; drift → freeze asset + page):**
1. **Conservation:** `SUM(delta_minor) GROUP BY asset_id, instance_id` = 0, forever. `SYS_EMISSION`'s negative balance *is* circulating supply.
2. **Non-negative user balances:** reducer rejects any overdraw before commit, DB `CHECK` is the backstop.
3. **Cap:** `-balance(SYS_EMISSION, OMG) ≤ cap_minor`, enforced at mint. **Post-genesis `OMG` mint path does not exist in code** beyond the pre-funded Refinery pool.
4. **Integer-only, seeded, no wall-clock** in the reducer. Pro-rata splits use **largest-remainder with a seeded tiebreak** (sum of parts == budget, no float dust, deterministic replay).
5. **Projection integrity:** `balance_minor == Σ postings`; `held_minor == Σ active holds`. Rebuild from `log.event` on drift.

**Holds are not postings.** A hold bumps `held` (lowers available) but posts nothing; only *capture* emits the double-entry journal. This cleanly models cross-session marketplace listings and in-flight withdrawals as "intent to spend" distinct from "spent."

### 3.3 Reconciliation with the event-log truth

Balances are projections of `log.event`; dropping and replaying `log.event` through the deterministic reducer reproduces every balance exactly (the `last_event_seq` cursor is the double-apply guard). The chain, when live, is logged as `chain.observed_tx` (external-oracle pattern): **replay reads the logged tx hash/confirmations, never re-broadcasts and never re-queries** — identical to how replay feeds logged LLM outputs (Risk 6).

### 3.4 Custody & hot/cold-wallet model (reserve, not fractional)

Enabled only with the bridge, but designed now:
- **Cold:** bulk reserve in n-of-m multisig (e.g. 3-of-5) on HSM/hardware, offline. Spending from cold requires human multi-party approval.
- **Warm/hot float:** small operational wallet, key in cloud HSM/KMS or MPC/threshold custodian — **never a file, env var, or app memory**. The automated signer draws only from this float under per-tx and per-window caps.
- **Replenishment:** hot below floor → human cold→hot multisig top-up; hot above ceiling → auto-sweep hot→cold (sending *to* cold is safe; only spending *from* cold needs multisig).
- **Signing boundary (hard rule):** the signing key never enters client, room, LLM, or the general economy service. The chain adapter **builds and broadcasts but never signs**; a separate narrow HSM-fronted signer applies its **own independent policy** (velocity, per-tx ceiling, sanity-check against the off-chain debit) so a compromised economy service alone cannot drain the hot wallet.

**Backing model: pre-funded segregated reserve (recommended over mint-on-withdrawal).** A live mint-on-withdrawal key is an unbounded money-printer; if used at all it is cold-multisig + governance-capped + rate-limited, used only to top up the reserve, never per-withdrawal. **Addresses the red-team insolvency finding (#4):** the entire remaining **emittable + circulating withdrawable `OMG`** (the 400M Refinery pool, §5) is **1:1 segregated on-chain in a dedicated reserve wallet**, separate from the treasury/team/liquidity buckets that are meant to be sold or spent on ops. **Transfers out of the reserve are forbidden except settlement, enforced by cold-multisig policy, not by convention.**

**Solvency invariant (bucket/provenance-aware — resolves R0.6, red-team #4):**
```
reserve_onchain(OMG)  ≥  Σ player.balance(OMG, bucket='withdrawable')     -- EARNED + eligible DEPOSITED only
                       + Σ in-flight withdrawals(OMG)
                       − Σ deposits observed-but-not-yet-final(OMG)
```
`GEM`, `COIN`, `DEW`, and `PURCHASED`/non-withdrawable `OMG` lots are **not** liabilities and are **not** reserved. Breach → **halt withdrawals (circuit breaker) + page.**

### 3.5 Mint / withdraw authorization boundary

- **MINT (supply increase):** cold multisig + published governance cap, offline, human multi-party. Never on a request path. **Auto-mint-on-withdrawal is the single highest-severity design choice — recommended against.**
- **WITHDRAW:** debit off-chain first (durable), broadcast second, settle on finality, refund **only on definitive on-chain failure** (§10.2). The room is entirely absent; three-party (NestJS → Signer → chain).

---

## 4. The chain-agnostic bridge

### 4.1 Adapter interface (hexagonal port; builds + broadcasts, never signs)

```ts
type BaseUnits = string;                 // integer base units as decimal string — NEVER a JS number
interface AssetId { chainId: string; kind: 'native'|'jetton'|'bep20'|'nft'; contract?: string; decimals: number; }

interface ChainAdapter {
  readonly chainId: string;
  readonly finality: { confirmations: number; hasDeterministicFinality: boolean };
  isValidAddress(a): boolean;  normalizeAddress(a): string;         // EVM checksum / TON raw workchain:hash
  depositRoutingStrategy(): 'PER_ACCOUNT_ADDRESS' | 'SHARED_ADDRESS_WITH_MEMO';
  // DEPOSIT (pull is authoritative; webhook is an UNTRUSTED hint, re-verified via our own node)
  getChainHead(): Promise<ChainHead>;  getBlockByHeight(h): Promise<BlockRef>;   // reorg: hash-at-height
  scanDeposits(range, watch): Promise<NormalizedDeposit[]>;  parseWebhook?(headers, body): Promise<NormalizedDeposit[]>;
  // WITHDRAW
  estimateFee(a): Promise<FeeQuote>;                                // maxFeeBaseUnits ceiling we authorize
  buildWithdrawal(r: {to, amount, assetId, nonce}): Promise<UnsignedTx>;  // nonce ASSIGNED BY US
  broadcast(signed): Promise<{txHash; acceptedByMempool}>;
  replaceWithHigherFee(a: {withdrawalId, nonce, newFee}): Promise<{txHash}>;  // RBF at SAME nonce
  // STATUS / NFT / RECON
  getTransaction(txHash): Promise<TxStatus>;  getConfirmations(txHash): Promise<number>;
  buildNftMint(r: NftMintReq): Promise<UnsignedTx>;                 // metadataUri: server-authored, immutable, ipfs://
  getOnChainAccountNonce(hotWallet): Promise<number>;              // EVM nonce / TON seqno, startup reconcile
  getReserveBalance(assetId): Promise<BaseUnits>;  decimals(assetId): number;
}
interface SignerPort { hotWalletAddress(asset): Promise<string>; sign(unsigned): Promise<SignedTx>; }  // KMS/HSM/MPC only
interface AddressScreeningProvider { screen(address): Promise<AddressRisk>; }  // OFAC/taint
```

The only genuinely chain-specific knobs: `finality` (TON masterchain ≈ fast/final; BNB probabilistic → high N or `finalizedBlock`), `depositRoutingStrategy` (per-account HD vs shared-address+memo), and nonce semantics (EVM account nonce vs TON seqno). Everything else normalizes. `NUMERIC(38,0)` off-chain ↔ chain decimals at this boundary only.

### 4.2 Deposit sequence (credit only past finality — handles reorg)

```
create bridge.deposit_intent (EVM: HD-derived per-account addr; TON: shared addr + unique memo)
  → player sends → IndexerWorker (self-node pull, webhook = hint only, re-verify via RPC)
  → UPSERT chain_observation PK(chainId,txHash,logIndex) state=pending   [NOT spendable, NOT withdrawable]
  → attribute by (addr) | (addr,memo); no match → state=unattributed → manual recon queue
  → ConfirmationWorker: getBlockByHeight(h).hash == stored?  mismatch/orphan → state=orphaned, DROP (nothing credited)
  → conf ≥ N(final) & canonical: ONE txn → ledger deposit_credit {idempotent on (chainId,txHash,logIndex)}
       lot origin='deposit_onchain', bucket='spendable', is_withdrawable per R0.3 (NOT free pass-through)
```
**Reorg handling is "wait, don't undo":** credit only past finality-equivalent N (treat N as finality, not probability). A deep reorg beyond N is the only path to a `deposit_clawback` compensating debit — which **freezes the account and pages**, because at that point either N was wrong or we're being attacked. **Because DEPOSITED is spend-only / same-address-return-only (R0.3), a reversed deposit is always recoverable from the unspent in-game balance** (closes red-team reorg-abuse #REORG-DEP).

### 4.3 Withdraw saga (the dangerous path — debit first, settle on finality, refund only on definitive failure)

```
POST /bridge/withdraw {asset, amount, to, requestId}   (Bearer + step-up/2FA)
 1. GATE: standing=good; no open fraud case; not mid-handoff
 2. GATE: age ≥ 18 (§7 regulatory); jurisdiction geofence; KYC tier sufficient; OFAC identity screen
 3. GATE: AddressScreeningProvider.screen(dest); destination allow-listed & cooldown elapsed
 4. GATE: velocity (per-tx, 24h/7d, per-destination AGGREGATE), global daily-outflow budget
 5. GATE: LotManager.selectEligibleLots: mature && withdrawable && provenance-clean (EARNED), FIFO
 6. Travel Rule if amount ≥ threshold
 7. ONE PG txn (durable-before-ack): hold(amount) + withdraw_hold event (fenced) → status=held
 8. RISK GATE: amount ≥ review_threshold OR new-dest OR anomaly → ReviewQueue (4-eyes); HOLD STAYS
 9. SignerSvc.assignNonce under SELECT…FOR UPDATE + fence on bridge.hot_wallet; UNIQUE(chainId,nonce)
10. buildWithdrawal{nonce,feeCap} → *** RECORD-BEFORE-BROADCAST (persist rawSigned+txHash, status=broadcasting) ***
11. SignerSvc.sign (key never leaves HSM) → broadcast → status=broadcast
12. SettlementWorker polls getTransaction:
    (a) included & conf ≥ N & canonical → capture hold: debit OMG / credit SYS_BRIDGE_RESERVE → settled
    (b) DEFINITIVELY failed (revert / nonce-too-low observed) → refund hold→available → refunded
    (c) stuck (pending age > T) → replaceWithHigherFee at SAME nonce (NOT a refund)
    (d) reorg before N → do nothing (we only settle at N)
```

**Double-withdraw blocked by four independent gates:** `UNIQUE(account_id,request_id)` idempotency; atomic hold with `available ≥ amount` reducer invariant; `UNIQUE(chainId,nonce)` + RBF reuses the nonce (chain confirms at most one of {original, replacement…}); single-writer serialized nonce assignment.

**Refund rule (resolves red-team DOUBLE-PAY-ON-TIMEOUT #3):** **never refund on timeout.** A broadcast same-nonce tx can still be mined after T. Refund only on a definitively-failed on-chain state (revert / nonce-too-low), **or** after broadcasting a same-nonce no-op canceller that itself confirms. **Refund means "the nonce slot resolved to not-our-payment," never "we waited long enough."**

**Crash recovery:** on startup, every withdrawal in `{broadcasting, broadcast}` is reconciled against `getTransaction` and `getOnChainAccountNonce`; a nonce assigned-but-never-broadcast is a gap resolved by re-broadcasting the recorded `rawSigned` or a no-op nonce-filler self-tx. TON seqno gets identical treatment.

### 4.4 Confirmations / reorg / caps (consolidated)

- **Idempotency keys:** deposit = `(chainId,txHash,logIndex)`; withdrawal = `(account_id,request_id)`; broadcast slot = `(chainId,nonce)`; settle/refund = idempotent on `withdrawal_id`.
- **Nonce authority is a DB counter, never a live chain read** (`eth_getTransactionCount(pending)` races). Reconciled to chain only at startup.
- **Webhooks are hints:** HMAC-verify, then re-verify every datum against our own node before any credit/settle.
- **Indexer-lag guard:** if `head − indexed > threshold`, pause credits/settlements (chain-dependent) but keep accepting holds/debits/refunds (pure off-chain, always safe).
- **Gas float** is a separate monitored native-coin reserve; low float silently halts all token withdrawals → alert.
- **Global daily-outflow circuit breaker** + **hot-float cap**: aggregate outflow ceiling trips an automatic kill switch; withdrawals exceeding hot float queue for a human cold top-up, never auto-drain cold.

### 4.5 TON vs BNB tradeoffs (don't hard-code)

| Dimension | TON | BNB (BSC / opBNB) |
|---|---|---|
| Finality / reorg | fast masterchain finality → low N, `hasDeterministicFinality≈true` | probabilistic → high N or `finalizedBlock`; **the reorg-abuse finding bites harder here** |
| Deposit routing | shared-address + memo (no sweep) — **memo-dropping wallets/CEX → unattributable deposit footgun** | per-account HD + SweepWorker (gas cost) — clean attribution |
| Nonce model | wallet-contract `seqno`, async actor model (jetton transfer = multi-message, parse bounces) | sequential account nonce, synchronous, mature RBF |
| Decimals | 9 (fits bigint, but we use NUMERIC anyway) | 18 → **NUMERIC(38,0) mandatory** |
| Compliance tooling | **materially thinner** address-screening / Travel-Rule coverage — a real OFAC strict-liability risk (§9) | mature Chainalysis/TRM/Elliptic coverage, deep liquidity |
| Distribution | Telegram-native (TON Connect + Stars synergy) → lowest friction for the Telegram-first base | not Telegram-native; MetaMask/WalletConnect clunky in WebView, fragile on iOS |

**Honest weighing:** TON wins distribution; BNB wins engineering maturity **and compliance tooling**. For a *regulated cash-out* bridge the weaker TON screening weighs heavily. The adapter defers the choice to one implementation class + config. **Pick one chain for backed `OMG`** — multi-chain backing multiplies the solvency surface.

---

## 5. Emission & supply

**`OMG` — hard cap 1,000,000,000, minted once at genesis into vesting buckets; no post-genesis mint path in code.** (Splits illustrative; need economic modeling before genesis — Open Decision.)

| Bucket | % | Vesting / handling |
|---|---|---|
| **Play-rewards pool** (`SYS_REFINERY_POOL`, the only player-earned source) | 40% (400M) | released on a decaying schedule (below); **1:1 segregated in the on-chain reserve** |
| Ecosystem / DAO treasury | 20% | timelocked; **never counted as withdrawal backing** |
| Team | 15% | 4-yr vest, 1-yr cliff |
| Investors | 15% | vest |
| Liquidity / exchange | 5% | — |
| Community / alpha airdrop | 5% | one-time, Discord-role gated, `EARNED`-locked |

**Refinery release — dynamic, not a fixed calendar (resolves red-team BOT-TIMING #ECON-1).** The naive fixed Yr1 80M / Yr2 60M… schedule pays the most per-weight exactly when the population is smallest and detection weakest — so Sybil farms concentrate in early epochs. Instead: **per-epoch released budget scales to attested-human participation (a dynamic floor), early-epoch emission is held in escrow until PoH-coverage is proven, and any single reputation-cluster's share of a settled epoch is capped.** The sum of all epoch budgets, forever, remains the absolute ceiling on total player cash-out — a cap you can prove and audit. Honest note: a decaying curve still means early players earn more per unit effort — a mild pyramid characteristic; **disclose it, and keep it modest** because the "early earns more" framing is also a Howey input (§9).

**`DEW`:** no cap, bounded by per-account daily faucet caps × reputation, demurrage, and sinks ≥ 1.2× faucet. No store-of-value guarantee; its only worth is optionality into the fixed Refinery or into sinks.

---

## 6. The Refinery — `DEW → OMG`, the cash-out chokepoint

### 6.1 Why P2E dies without this (the honest lesson)

Axie's `SLP` and StepN's `GST` were *minted by play* and *sunk mainly by onboarding more earners* — a Ponzi dependency; when onboarding stalled, faucet ≫ sink and both collapsed (`SLP` ~$0.35→<$0.004; `GST` ~$8→cents). The Ronin bridge hack ($625M) proved the bridge is the deadliest surface. Both were "jobs, not games" with no intrinsic retention. **Celestia's structural fix: the hard-token faucet is a fixed, decaying budget decoupled from activity.** Grinding more `DEW` only divides a fixed pie into smaller slices → the emission-scales-with-players failure mode **cannot occur for the asset with real value**.

### 6.2 Mechanism (fixed-budget pari-mutuel, provenance-propagating)

```
weight_i      = dew_committed_i × reputation_mult_i        -- rep ∈ [0,1.5], fixed-point, snapshot AT COMMIT
omg_settled_i = floor(epoch_budget × weight_i / Σ weight)  -- largest-remainder → conserves exactly
```
```
During epoch: commit DEW → debit DEW to SYS_SINK (burn); write refinery_claim{epoch,acct,dew,weight,input_lot_taint}
Epoch close:  clock-authority emits refinery.settle(epoch, seed)
  reducer: Σ weight → largest-remainder split → credit each acct OMG
           PROVENANCE: output lot inherits a blended worst-case taint of the DEW inputs (§2 / red-team LAND-LAUNDER)
           debit SYS_REFINERY_POOL; assert pool ≥ 0; assert Σ settled == budget
Anti-gaming:  COMMIT-REVEAL within the epoch window (no last-second ratio front-run);
              reputation snapshot at commit; per-cluster share cap
```

**Consequences:** hard-token faucet decoupled from activity; Sybil `DEW` dilutes everyone *including the bots* while reputation weighting discounts un-attested/young/low-rep accounts; **no price promise** — we control supply and sinks, never demand. **We must never advertise yield** (dishonest + securities exposure).

### 6.3 Provenance propagation into Refinery output (resolves red-team LAND-LAUNDER #2 + R0.8)

The Refinery minting `EARNED` output regardless of what capital seeded the committed `DEW` is a buy→withdraw conduit: buy `GEM`/`OMG` → win a `LAND` auction → land accrues `DEW` → refine → fresh withdrawable `OMG`. **Fix: `DEW` carries the provenance taint of the asset that produced it, and Refinery output inherits the blended worst-case taint of its `DEW` inputs.** `DEW` yielded by a `GEM`-funded (or `PURCHASED`-funded) `LAND` plot is tainted non-withdrawable, and refining it produces non-withdrawable `OMG`. A `PURCHASED`/`GEM`-funded path can only ever yield non-withdrawable proceeds — closing the launder generically rather than per-flow.

---

## 7. NFT assets — mint, price, sink

All NFTs are **off-chain ledger rows first** (`ledger.nft`), exportable on-chain last. **Every mint is a deterministic sim event — never the LLM, never the client.**

```sql
ledger.nft(nft_id PK, collection ENUM('LAND','CROP','COSM'), owner_account_id, minted_event_seq,
           attributes jsonb, bound bool,            -- bind-on-pickup, anti-RMT
           provenance_lot bigint,                   -- the taint it carries (§2)
           on_chain_id text, bridge_state ENUM('offchain','export_locked','importing','onchain'));
sim.land(nft_id FK, zone_instance_id, tier, yield_rate_minor, upkeep_minor, cluster_id);
```

- **Land (`LAND`)** — finite, content-authored supply; primary sale by ascending-clock auction in `GEM`/`OMG` (proceeds burned or treasury); secondary market with royalty + transfer tax (sinks). Land yields `DEW` → it is the rentier asset, explicitly flagged (§9/§11). **Resolves red-team SYBIL-LANDLORD #ECON-3:** cap land/yield at the **reputation-cluster (identity-graph) level, not per account**; require **PoH per yielding plot**; land yield strictly `< active-play yield` and **decays with the count of low-activity plots in a cluster**.
- **Rare crops (`CROP`)** — minted on a **seeded-PRNG rare roll** during normal harvest (seed from `event.seed`, logged; replay reads the logged roll). **Danger: paid RNG minting resembles a loot box.** Keep the roll **earned-only / clearly non-paid**; defer any paid gacha until legal review (§9).
- **Cosmetics (`COSM`)** — minted via crafting sink (burn `DEW` + `GEM`/`OMG`). Cosmetic-only, **zero power** — the pay-to-win firewall and status outlet.

**Export / import lifecycle (resolves red-team NFT-IMPORT-REORG-DUPE #3):**
- **Export (mint):** a withdrawal-class op; the in-game asset moves to `export_locked` (unusable in-game) **before** minting — closes the "usable in-game AND tradeable on-chain" dupe. Metadata is **server-authored, immutable, content-addressed (`ipfs://`)** — a user-controlled metadata field is a permanent public illegal-content vector and must be structurally impossible.
- **Import (deposit):** player sends NFT to intake → **unlock only past the import chain's finality N**; keep the asset in a non-tradeable `importing` limbo until burn finality; **on a deep reorg of the burn tx, re-lock and freeze + page** rather than trusting the unlock (for a 1-unit NFT the deposit-style clawback cannot net it out).
- **Export caps (resolves red-team EXTERNAL-WASH #ECON-6):** rate-limit and cap exports per collection; publish authoritative off-chain floor/provenance so external buyers can detect wash volume; **never let externally-observed NFT prices feed any in-game valuation, perk, or collateral logic** (external royalties are unenforceable — stated honestly).

**Marketplace: off-chain-with-settlement** for the in-game market (instant, gasless, reversible, moderatable, royalty-enforceable). Do **not** build an on-chain orderbook/AMM early. Off-chain trade settlement is one atomic multi-leg journal via the NestJS-escrow saga; the listing is a `hold` on the NFT instance, settle captures it.

---

## 8. Governance — soulbound-reputation-dominant, bounded (resolves R0.7)

```
vote_power_i = reputation_mult_i      -- soulbound, non-transferable; (optional, deferred) × sqrt(bounded staked_OMG)
```

- **Reputation is soulbound** — earned via playtime, account age, achievements, social standing; **not transferable, not buyable**. Blunts plutocracy and Sybil (fresh accounts ≈ 0 rep).
- **Staking-for-weight is dropped by default (R0.7, red-team SECURITIES #4):** `staked OMG for sqrt-weighted governance + decaying emission that admits "early earns more"` reads as an investment contract (profit from others' efforts). Recommend **soulbound-rep-only governance**; if bounded stake is ever added it is rep-gated and legally cleared.
- **Scope is bounded, advisory, off-chain snapshot first** (implemented as reversible entitlements, §Facet-4 mechanism): cosmetic/festival themes, parameter nudges within hard guardrails, DAO-bucket grants. **Governance can NEVER vote to change faucet/sink/emission/mint authority or anything in the TCB.**
- **Guardian backstop:** security-council multisig + timelock on any executed change + the existing kill switch.

**Honest framing:** on-chain token-weighted DAO voting is a large legal + security + plutocracy + Sybil-via-wallets surface and is mostly theater for a live game economy. Keep it advisory, bounded, reversible, and off-chain. **Addresses red-team GOV-CAPTURE #8:** rep-dominant + non-transferable + bounded scope + the RMT-resale controls (§9) prevent purchasable aged-account weight from becoming decisive.

---

## 9. Fraud + regulatory controls matrix (threat → control → when-enforced)

Every red-team item is tagged inline. The off-chain-first mandate *is* a fraud control: while nothing is withdrawable, every fraud is reversible (reverse a `log.event`, re-project, zero real loss). G0–G7 are the value-funnel chokepoints: **account → earn (G1 earn-cap + PoH) → buy GEM (G2 spend-only) → trade (G3 wash-graph + taint) → convert (G4 provenance) → withdraw (G5 KYC/age/OFAC/geo/velocity/lot-maturity) → settle (G6 address screen + Travel Rule + circuit breaker) → deposit (G7 finality + taint + layering).**

| # | Threat (red-team ref) | Control(s) | When enforced | Status |
|---|---|---|---|---|
| E1 | Double-spend / ledger race | single-writer economic fence (R0.5); double-entry conservation; durable-before-ack; fence-guarded append; handoff reads primary | per write | launch-blocking (off-chain) |
| E2 | **Provenance-wash via P2P/marketplace** (RT #1) | **provenance is conserved, worst-case-inherited: proceeds inherit lowest-withdrawability/highest-taint of spent lots (§2), carried through the NestJS-escrow trade saga** | G3 trade, G4 convert | **launch-blocking (off-chain) — the central AML firewall** |
| E3 | **Land-yield launder** (RT #2) | **DEW inherits the funding asset's taint; Refinery output inherits blended worst-case taint of DEW inputs (§6.3)** | continuous | launch-blocking (off-chain) |
| E4 | **Withdrawal double-pay on refund-after-timeout** (RT #3) | **refund only on definitive on-chain failure or confirmed same-nonce canceller — never on timeout (§4.3)** | G6 settle | launch-blocking (bridge) |
| E5 | **NFT import reorg dupe** (RT #3) | unlock only past finality; `importing` limbo; deep-reorg → re-lock + freeze + page (§7) | G7 import | launch-blocking (bridge) |
| E6 | **Reorg-abuse / pass-through deposit mixer** (RT #4) | **DEPOSITED spend-only / same-address-return-only + long aging (R0.3); N at true economic finality (§4.2)** | G7 deposit | launch-blocking (bridge) |
| E7 | **Fractional-reserve insolvency** (RT #5) | segregated 1:1 on-chain reserve = all withdrawable OMG; bucket-aware solvency invariant; reserve wallet spend forbidden except settlement via cold-multisig policy (§3.4) | continuous | launch-blocking (bridge) |
| E8 | **Bot farm timed to early high-budget epochs** (RT ECON-1) | dynamic epoch budget scaled to attested-human participation; early emission escrowed; per-cluster share cap (§5) | per epoch | launch-blocking (off-chain) |
| E9 | **Relationship/dialogue faucet botifiable + cost-DoS fusion** (RT ECON-2, amplified Risk 8) | dialogue/affection rewards pay COIN/non-convertible DEW only (R0.4); behind Risk-8 embedding caps + attestation; **never make chat/embedding a convertible faucet** | G1 earn | launch-blocking (off-chain) |
| E10 | **Sybil landlord fleet** (RT ECON-3) | cluster-level land/yield cap; PoH per yielding plot; yield < active-play; decay with low-activity plots per cluster (§7) | continuous | launch-blocking (off-chain) |
| E11 | **Circuit-breaker as griefing weapon** (RT ECON-4) | **targeted per-cluster/per-reputation-band throttling, not global**; quarantine the anomalous cohort's faucets, not everyone's | continuous | launch-blocking (off-chain) |
| E12 | **Demurrage dodge + conservation/replay bug** (RT ECON-5) | demurrage as explicit scheduled **event-sourced burn legs** (debit user / credit SYS_SINK) by the clock authority — deterministic, conservation-closed, no wall-clock in reducer; applied to committed-then-refunded balances so active farmers aren't exempt | scheduled | launch-blocking (off-chain) |
| E13 | External wash-pump on uncontrolled markets (RT ECON-6) | export caps per collection; publish authoritative floor/provenance; never feed external prices into in-game valuation (§7) | continuous | mitigated |
| E14 | Chargeback-to-withdraw | moot by default (fiat buys only non-withdrawable `GEM`); if fiat→OMG ever enabled: `PURCHASED` lot non-withdrawable or maturity ≥ chargeback window + clawback + rate-scoring; prefer Stars | G2/G5 | launch-blocking (bridge) |
| E15 | RMT / account & KYC-resale (RT REG-6) | bind-on-pickup; non-tradeable DEW; **periodic re-liveness/re-KYC on withdrawal and on device/geo drift; bind payout to a re-proven live person, not a one-time snapshot; freeze on identity-vs-behavior drift** | G5 + continuous | mitigated; residual accepted |
| E16 | Insider / admin ledger fraud | 4-eyes on clawback + admin_adjust + withdrawal approval; admin actions are themselves `log.event`s; separation of duties | at admin action | launch-blocking (bridge) |
| E17 | Hot-wallet drain / key compromise | hot/warm/cold split; bounded hot float; multisig; signer independent-policy; global daily-outflow circuit breaker | G6 + continuous | launch-blocking (bridge) |
| E18 | **Minors cashing out** (RT REG-1) | **hard 18+ (jurisdictional adult) age-gate at IdP/NestJS feeding compliance_tier; `is_withdrawable` stays false for any non-age-verified account; reconcile with the open COPPA spike before the bridge** — age is a withdrawal precondition, not a KYC afterthought | G5 | **launch-blocking (bridge); company-ending if missed** |
| E19 | **App-store / Stars funding of a cash-out token** (RT REG-2) | **fiat buys only `GEM` (non-token, non-withdrawable, never converts); no IAP-funded unit reaches the withdrawable bucket through any path (taint propagation E2/E3 enforces it)** | G2 | launch-blocking (bridge) |
| E20 | **Deposit→withdraw layering = unlicensed exchange/mixer** (RT REG-3) | DEPOSITED spend-only/same-address-return (R0.3); any deposit→withdraw-to-new-address round trip is a blocked high-risk event requiring full Travel Rule + EDD | G7/G5 | launch-blocking (bridge) |
| E21 | **Securities (Howey) on gov + decaying emission** (RT REG-4) | drop staking-for-weight (R0.7); governance strictly non-economic utility; **zero yield/revenue-share/appreciation framing anywhere**; securities opinion a hard bridge gate | design-time + enable | launch-blocking (bridge); legal gate |
| E22 | **Sanctions strict-liability on TON's weak screening** (RT REG-5) | if TON: deny-by-default on screening uncertainty, manual-review all withdrawals above a low threshold; consider restricting the bridge to better-covered chain for regulated jurisdictions until TON screening matures | G5/G6/G7 | launch-blocking (bridge) |
| E23 | Gambling / loot-box | no cashable randomized boxes; `CROP` rare roll earned-only; separate RNG cosmetics from the cashable economy or geofence; gambling opinion per market | design + enable | launch-blocking (bridge); legal gate |
| E24 | MSB / money-transmission licensing | license or licensed custody/off-ramp partner; per-jurisdiction enablement; **US cash-out off at launch** (securities + 50-state MT + NY BitLicense) | at bridge-enable | launch-blocking (bridge); hard legal gate |

---

## 10. Phased rollout (withdrawals/cash-out are LAST and gated)

Each phase is a hard gate; you do not advance until the prior phase's invariants hold in production.

**Phase 0 — Off-chain economy only (no chain, zero real value).** Ship and balance all four roles entirely off-chain: full double-entry ledger; `COIN`/`DEW`/`GEM`/`OMG`/NFTs as off-chain assets; **provenance lots + worst-case taint propagation from event #1** (E2/E3); faucet/sink/P2P/marketplace/holds; the Refinery with dynamic budget; demurrage as event-sourced burns; the economic fence + idempotency + atomic check-and-post; internal reconciliation invariants; replay. Compliance/OFAC/geofence/Travel-Rule/age logic **stubbed behind `ComplianceGate` so enabling is config, not a rebuild**. `is_withdrawable=false` everywhere. **Exit criteria:** faucet/sink ratio stable (sink ≥ 1.2× faucet), intrinsic retention of non-token players proven, the economic model `yield_per_account_per_day < cost_to_create_and_pass_an_account` numerically demonstrated.

**Phase 1 — Wallet linking, read-only ownership (optional edge, still no value out).** Wallet linking as an **ownership-proof ceremony, never a login** (§Facet-5): `POST /wallet/link/*` requires an authenticated session + fresh step-up; nonce single-use + TTL + server-bound + domain-bound; canonical address derived from the proof, not the client string; one-wallet-one-account partial unique index. On-chain holdings become **leased** `trust_tier='leased_onchain'` entitlements with `revalidate_after`, feeding the **same unified `authz.entitlement` projection** as Discord-role/Stripe/Stars (§Facet-5). Flash-loan-gated valuable perks forbidden (stake/time-weight only). **Linking never, by itself, unlocks faucets/airdrops/P2E payout** (keeps linking non-rewarding — Sybil-neutral).

**Phase 2 — Deposits (value in, not out).** Enable the deposit path per chain: HD/per-user addresses (EVM) or shared-address+memo with loud UI warnings (TON); credit only past finality; DEPOSITED lots **spend-only / same-address-return-only** (R0.3). On-chain reconciliation (deposit-matching, indexer-lag guard) live. Still no withdrawal.

**Phase 3 — Withdrawals, behind full controls (LAST, per-asset × per-jurisdiction, defaulted OFF).** Requires, as hard gates: MSB/VASP license or licensed custody/off-ramp partner; full KYC/AML program + SAR + 5y recordkeeping; **18+ age verification**; OFAC identity + address screening; geofencing live (US cash-out off); lot maturity + provenance-clean selection + velocity/cooldown/caps + PoH; segregated 1:1 reserve + hot/warm/cold + circuit breaker + solvency reconciliation; **securities + gambling legal opinions**; Travel Rule. Enable **withdrawal-only first** (one-directional is far lower risk than a two-way exchange). On-chain NFT export/import and on-chain governance remain deferred beyond this.

---

## 11. Top risks (ranked) + Open Decisions

### 11.1 Ranked risks (incorporating the red team)

1. **Provenance that does not propagate through trades/yield** (RT #1/#2). P2P/marketplace and land-yield launder non-withdrawable `GEM`/`PURCHASED`/`DEPOSITED` value into withdrawable `EARNED` cash — reopening buy→withdraw, chargeback-laundering, and insolvency at once, silently voiding the central AML firewall. **Mitigation (now binding, R0.8):** provenance is a conserved, worst-case-inherited property across every transfer and yield event; proceeds inherit the lowest-withdrawability/highest-taint of their inputs.
2. **Amplified Risk 8 made profitable and mistimed** (RT #2). Fixed early-epoch budgets + a botifiable dialogue/affection faucet pay Sybil farms the most to drain GPU/embedding budget exactly when the game is smallest. **Mitigation:** dynamic human-scaled epoch budget + escrowed early emission + per-cluster caps (E8); dialogue/affection pays non-convertible value behind embedding caps (E9); the `yield < cost` inequality is a Phase-0 exit gate.
3. **Bridge double-pay + NFT import reorg dupe** (RT #3). Irreversible real-money/asset loss at the one place reversibility dies. **Mitigation:** refund only on definitive on-chain failure (E4); NFT unlock only past finality with freeze-on-reorg (E5).
4. **Fractional-reserve insolvency** (RT #5). **Mitigation:** segregated 1:1 on-chain reserve, bucket-aware solvency invariant, reserve-wallet spend forbidden except settlement by cold-multisig policy (E7).
5. **Minors cashing out** (RT REG-1). Company-ending COPPA + child-labor + gambling-to-minors exposure, unaddressed in all facets. **Mitigation:** hard 18+ age gate as a withdrawal precondition, reconciled with the open COPPA spike before the bridge (E18).
6. **Spec incoherence across facets** (RT INCONSISTENCIES). Three asset models, BIGINT-vs-NUMERIC overflow, two fences, contradictory deposit policy. **Mitigation:** the §0 reconciliation table — one asset model, `NUMERIC(38,0)` everywhere, one economic fence, DEPOSITED spend-only, bucket-aware solvency, rep-dominant governance.
7. **RMT of KYC'd / high-rep accounts** (RT REG-6). "Soulbound" rep is account-bound and accounts are sellable → money-mule payout mismatch + governance-capture market. **Mitigation:** periodic re-liveness/re-KYC on withdrawal and on device/geo drift; payout bound to a re-proven live person; freeze on identity-vs-behavior drift (E15).
8. **Governance capture via bought weight + bribery** (RT #8). **Mitigation:** soulbound-rep-dominant, non-transferable, bounded scope, staking-for-weight dropped, guardian timelock (§8, E21).

**Said plainly — genuinely dangerous, do not hand-wave:** (a) opening the bridge before `yield_per_account < cost_per_account` is proven = building a profitable attack; (b) any buy→withdraw path = becoming an unlicensed exchange *and* a laundromat (hence `GEM` + taint propagation); (c) cashable randomized drops = online gambling; (d) treating address screening as solved on TON = strict-liability sanctions risk; (e) the hot-wallet/mint key = catastrophic irreversible loss; (f) **never promise yield or price** — we control supply and sinks, not demand, and honest P2E can still go to $0 in fiat terms.

### 11.2 Open Decisions

- **Economic genesis:** exact `OMG` cap/bucket split and the dynamic Refinery budget curve — needs economic modeling + agent-based simulation before genesis.
- **Economy tuning (Phase-0 exit):** `DEW` per-account daily cap, demurrage rate/threshold, target sink:faucet ratio, and the numeric `yield_per_account < cost_per_account` go/no-go model.
- **Reputation formula** (playtime/age/achievements/social) and the cluster-identity-graph definition that gates Refinery weighting, land yield, and governance.
- **Keep `COIN` and `DEW` separate** vs collapse (recommendation: keep separate — the primary cozy-vs-extraction firewall).
- **Premium rail:** confirm `GEM`-only (recommended) vs any gated fiat→`OMG` (tainted, non-withdrawable) — resolves IAP/Stars + securities posture simultaneously.
- **Chain choice (TON vs BNB):** weighed on compliance-tooling maturity (TON screening materially weaker), deposit-attribution model, finality profile, and Telegram-first distribution — deferred behind the adapter.
- **Provenance taint model specifics:** aging period for `EARNED`→withdrawable, blended-taint arithmetic for Refinery output, DEPOSITED same-address-return window, KYC tiers + per-period cash-out ceiling.
- **Backing model + custody operator:** pre-funded reserve (recommended) vs mint-on-withdrawal; self-operated HSM/multisig vs regulated qualified custodian / MPC provider.
- **Age + KYC + PoH vendors:** age-verification mechanism reconciled with the COPPA spike; PoH vendor (biometric liveness lawfulness per jurisdiction vs phone-only); device-attestation vendor (shared with Architecture Open Decision #4, now a hard earn/withdraw prerequisite); KYC PII retention (5y AML legal-hold) vs GDPR crypto-shred reconciliation (legal-hold outranks erasure until retention expiry, same as the Risk-5 moderation hold).
- **Legal gates (bridge blockers):** MSB/VASP license vs licensed partner; securities opinion on governance under Howey; gambling opinion on any randomized tradeable asset; Travel-Rule partner for self-custody withdrawals; which jurisdictions get cash-out (recommend no US cash-out initially).
- **Land:** supply schedule, cluster-level plot/yield cap, upkeep curve, and whether land yield is enabled at all (rentier risk).
- **Fees & reconciliation:** who pays the network fee (user-deducted with quote vs house-absorbed sink); `minConfirmations` per chain/asset; reconciliation cadence and freeze granularity (per-asset vs global); proof-of-reserves posture — published honestly as a solvency *snapshot*, not a proof of complete/honest liabilities (FTX/Mt. Gox caveat), and never oversold.
