<!-- Generated 2026-10-09 by a multi-agent design pass: 4 facets -> privilege-escalation/over-engineering critic -> synthesis. -->
<!-- Game-first authorization. Three layers (entitlement / in-game-TCB / admin-RBAC), one policy chokepoint, deny-by-default. -->

# AUTHZ.md — Celestia Authorization Specification

**Status:** Authoritative. Reconciles AUTH.md (frozen §0/§4.2 token), ARCHITECTURE.md (TCB, scopes, Seam 1/4/5/6), WEB3.md (EconomyService chokepoint, ComplianceGate, SoD), SDK.md (one chokepoint, ports born on second impl), WEB3-READINESS.md (bake-in-vs-defer, event-sourced truth, crypto-shred).
**Posture:** game-first. Bake the three seams that are cheap now and ruinous to retrofit (the one decision point, the staff/play token split, the audit record). Defer every console, engine, and ceremony.

---

## 1. Thesis

Authorization in Celestia is **three layers, three mechanisms** — never conflated:

1. **Access / Entitlement** — *may this account enter, at which tier?* Durable account-level grants riding the JWT `ent[]` claim; checked by one predicate in NestJS and in `onAuth`. ~90% built in AUTH.md.
2. **In-game / Domain** — *may this session act on this entity?* Deterministic TCB code inside the Colyseus room: ownership/scope + the sim's enumerate-membership. Exists implicitly; this doc makes it an **explicit, named, deny-by-default stage**.
3. **Privileged / Admin (RBAC)** — *who is staff and what may they do?* Largely undesigned. A **minimal** fixed-role model enforced in the NestJS Meta API, fully audited.

Five invariants bind all three:

- **One policy chokepoint.** Exactly one deny-by-default decision function `can(actor, action, resource, ctx)` in one package `@celestia/authz`, imported by both the NestJS guards and the room TCB. It is a **MODULE, not a port** (same ruling as `EconomyService`; a second policy engine is the two-divergent-implementations landmine). No scattered `if (user.isAdmin)`.
- **Deny-by-default + fail-closed.** Closed `Action`/`DenyCode` unions; unknown slug → deny; privileged action with unavailable live role data → deny.
- **The LLM is NEVER an authz principal.** It returns an index into a sim-authored option set. It is never assembled into an `Actor`, never passed to `can()`; cognition-svc holds zero `authz`/`ledger` grant (Seam 6). Authz is deterministic TCB/server code.
- **`account_id` is the sole principal.** The JWT `sub`. Discord/wallet/Telegram identities are login-only, never principals (N6/E4 identity wall).
- **Game-first YAGNI.** Seams now, tooling later. The moderation-plane *mechanism* is a launch blocker; its *GUI* is not.

---

## 2. The Three Layers

### Layer 1 — Access / Entitlement

**Governs:** entry + tier/build (`alpha | beta | founder | ga`). **Enforced:** `onAuth` (TCB, offline EdDSA claim check) and NestJS `@RequireEntitlement` guard — both calling the same predicate. **Already built:** `entitlements` table (AUTH §6.1), Discord-guild gate (§5), tester/dev allowlist (§2A.3), `ent:["alpha"]` claim. **New (small):** confirm the shape, name the seams, fence the over-build.

| Item | Label |
|---|---|
| `authz.entitlement` table shape (confirm §6.1; relocate to `authz` Postgres schema — cognition-svc gets zero `authz` grant) | **BAKE-IN-NOW** |
| Freeze enum↔slug map (`alpha_access→'alpha'` …) + `hasEntitlement`/`hasAnyEntitlement` OR-predicate in `@celestia/auth-contract`; **ratify via MUST-13 contract test** (not a silent edit of frozen §0/§6.2 constants) | **BAKE-IN-NOW** |
| `resolveEntitlements(accountId): EntSlug[]` — the sole mint-time + refresh-time resolver computing `ent[]`; recomputed each refresh so an added grant lands ≤1 refresh (10 min) | **BAKE-IN-NOW** |
| `OPEN_TIERS` config (default `['alpha']`) checked via `hasAnyEntitlement` in `onAuth`, replacing the hardcoded `'alpha'` → beta/GA is a config+entitlement change, not code (closes §8.6/§8.8) | **BAKE-IN-NOW** |
| **Source-authority invariant:** each source may emit only its own `source`-tagged grant types (allowed `source→type[]` table); a low-trust source (future wallet) can never mint a high-trust tier ("linking never by itself unlocks P2E") | **BAKE-IN-NOW** |
| `isFeatureEnabled(flag, {tiers, region, accountId})` capability seam over a **static config map**; capabilities derived live server-side, never in the JWT; first consumer = entitlement-gated dialogue/embedding cost control | **BAKE-IN-NOW** |
| Grant/revoke as `authz.entitlement.granted@1` / `.revoked@1` logged events (table is the projection) | **BAKE-IN-NOW** |
| Principle (zero code): geo/jurisdiction/age/KYC are **never** `ent[]` claims and never gate entry — they are ComplianceGate inputs at the money chokepoint, evaluated fresh | **BAKE-IN-NOW** |
| `EntitlementSource` port interface + Stripe/Telegram-Stars/wallet (`leased_onchain`) adapters — today's Discord + tester sources stay inline modules writing the same grant-row shape | **DEFER** |
| Self-serve/billing-sourced tier purchase (needs PaymentRail); region/jurisdiction/KYC gating (ComplianceGate, null-ALLOW stub, enabled per-asset×jurisdiction LAST — **no reserved compliance columns**, D3 anti-pattern); feature-flag service/UI/cohort targeting; per-feature RBAC claims in the token | **DEFER** |

**Token impact:** none beyond frozen. `ent[]` stays tier slugs only (1–3). Features/geo/KYC never ride the JWT (a 10-min token would keep a feature on past a kill switch and make jurisdiction stale at the strict-liability moment — a compliance-bypass bug).

**Footgun fix (from critique):** the `gate:<account_id>` Redis cache (AUTH §0) carries Discord `roles`. Assert explicitly: **`gate.roles` are entitlement-source Discord roles, NEVER staff RBAC roles.** CI/boot assertion prevents a dev sourcing staff authority from the gate cache.

### Layer 2 — In-Game / Domain

**Governs:** may this session perform this intent / act on this entity. **Enforced:** the room TCB, as a **named deny-by-default stage before enumerate-membership** in the existing `auth → legality → enumerate → reserve → execute` pipeline; re-run on NPC/System-2 apply. See §3. **Already built (implicitly):** "session owns avatar" clause, the three scopes (Seam 5), the DAL hard-scope (Seam 4). **New:** make it explicit and typed; add the co-presence prompt-scope rule.

| Item | Label |
|---|---|
| The explicit typed `Resource{scope, ownerAccountId}` ownership model + the ownership→action table | **BAKE-IN-NOW** |
| DAL hard-scope: every PER_PLAYER repo method REQUIRES a `SessionScope`; no runtime path accepts a caller-/model-supplied id | **BAKE-IN-NOW** |
| Co-presence rule: a shared NPC utterance to a group draws only on SHARED facts; a player's PER_PLAYER context influences only output rendered to that player's own session; never merge two owners' PER_PLAYER rows into one prompt | **BAKE-IN-NOW** |
| Deny-only low-cardinality metric + security event; ALLOW audit rides the existing domain `log.event` | **BAKE-IN-NOW** |
| ACL / co-ownership / delegation (shared housing, tend-a-friend's-farm, guild land) — additive later as an `ownerAccountId→ACL` lookup inside the one rule | **DEFER** |
| Per-account `econ:lease` + two-room escrow saga for synchronous cross-zone transfer (WEB3-READINESS N9 async-mailbox decision; flips to bake-in only if synchronous cross-zone trade ships at launch) | **DEFER** |
| Postgres RLS as a second mandatory layer (DAL `SessionScope` + GRANT boundary suffice; RLS is additive defense-in-depth) | **DEFER** |

### Layer 3 — Privileged / Admin (RBAC)

**Governs:** moderation plane, kill switches, canon edit, economy approvals, ban/kick, impersonation. **Enforced:** NestJS Meta API `StaffGuard` → `can()`. The room TCB **never makes staff authz decisions** — it only consumes already-authorized `ch:admin` commands and already-minted impersonation tokens via `onAuth`. See §4.

| Item | Label |
|---|---|
| 5 fixed roles + closed permission enum, seeded into `authz.role_binding`; `can()` is a plain switch | **BAKE-IN-NOW** |
| Staff/play token split (see §4); `StaffGuard` fail-closed on `scope`+`aud`+`amr` BEFORE role lookup | **BAKE-IN-NOW** |
| `ch:admin` publisher authorization (Redis ACL → Meta API credential only; see §4.5) | **BAKE-IN-NOW** |
| `staff.action@1` hash-chained audit event (see §6); SoD predicate (see §4.4); impersonation claims end-to-end (see §4.3) | **BAKE-IN-NOW** |
| `audit.read` permission gating the raw audit log (target_account_id + justification are PII-sensitive) | **BAKE-IN-NOW** |
| Rate-limit/lockout on `POST /staff/elevate` + `/staff/impersonate` (MUST-11 covers `/auth/*` only) | **BAKE-IN-NOW** |
| Admin/moderation/approval-queue/impersonation **consoles**; fine-grained/custom permissions, role hierarchy, delegation, time-bound grants; policy DSL/engine, ABAC; staff IdP/SSO/SCIM; full mint/withdraw ceremony (cold-multisig, HSM, emission cap); SIEM/external tamper-anchoring; DEK-encrypted shreddable audit payload (see §6) | **DEFER** |

---

## 3. The Ownership / Scope Model (Layer 2)

### 3.1 Resource → scope → owner → allowed actions

| Resource (kind) | Scope | Owner | Owner-player actions | Non-owner player | Sim/NPC | Authoritative writer |
|---|---|---|---|---|---|---|
| `avatar` | PER_PLAYER | account_id | read, move, equip, use | — (`PlayerPublic` projection only) | — | owning room |
| `inventory` | PER_PLAYER | account_id | read, use, consume, gift (debits self) | — | credit/debit via EconomyService, scoped to owner | owning room (sole writer while `presence=active`) |
| `farm_plot`/land | PER_PLAYER (instanced) | account_id | read, plant, water, harvest, build | — | scheduled growth on owner's plot | owning room |
| `npc_relationship` (affection/opinion/quest) | PER_PLAYER | account_id, keyed `(account_id, npc_id)` | read own, converse | — cannot read or mutate A's row | write ITS row, scoped to one owner | owning room / sim |
| `ledger_balance` (COIN…) | PER_PLAYER (money) | account_id | read own, spend own (via EconomyService) | — | faucet/sink on own account | EconomyService + `econ:lease` |
| `npc_body` (public pose/location) | SHARED | room lease (no player) | read projection, converse/interact (enumerated request) | read projection | move/act under fence | lease-holding room |
| `shop` inventory/prices | SHARED | room lease (no player) | read, purchase (request → EconomyService) | read | restock under fence | lease-holding room; money per-account |
| `town_event_log` | SHARED | room lease | read | read | append typed event under fence | lease-holding room |
| `canon`/constitution/forbidden-lines | GLOBAL | content pipeline (Layer 3) | read (via sim) | read | read-only at runtime | Layer-3 canon-edit path, not runtime |

Rules: **GLOBAL** is read-only at runtime for both player and sim (`can(_, write, GLOBAL) = deny` always; writes only via the Layer-3 canon path with `ch:admin` invalidation). **SHARED** has **no per-player owner** — mutation is only the lease-holding sim under the fence; players may *interact* (presence + enumeration + fence), and any value movement debits the actor's **own** ledger account via EconomyService (never shared-balance ownership). **PER_PLAYER** reduces to `actor.accountId === resource.ownerAccountId` — simultaneously the authz rule and the privacy guarantee.

### 3.2 The TCB check in the intent pipeline

```ts
// VillageRoom tick — drain in deterministic (recvTick, sid, seq) order
for (const env of drainIntents()) {
  const actor: Actor = { kind: 'player', accountId: env.client.auth.accountId, ... }; // principal from onAuth, NOT the payload
  const r = resolveResource(env.intent);        // id → typed Resource{scope,ownerAccountId} from ROOM STATE — never client-sent scope/owner
  if (!r) { reject(env, 'unknown_resource'); continue; }

  const d = can(actor, env.intent.action, r, ctx);  // (1) OWNERSHIP/SCOPE — explicit, deny-by-default, BEFORE enumerate
  if (d.effect === 'deny') { auditDeny(actor, env.intent, r, d.reason); reject(env, d.reason); continue; }

  const opts = enumerate(r, world);             // (2) legality / enumerate-membership — STAYS in the sim; can() does NOT re-enumerate
  if (!opts.has(env.intent.optionIndex)) { reject(env, 'not_enumerated'); continue; }
  if (r.scope === 'SHARED' && !holdsFence(r)) { reject(env, 'no_fence'); continue; } // (3) single-writer reservation (Seam 5)
  execute(actor, env.intent, r);                // (4) TCB computes numbers; money → EconomyService; append log.event(actor.accountId)
}

// NPC / System-2 apply — the LLM-is-never-a-principal invariant, structurally:
onInbox(cid, { argmaxIndex }) {
  const opt = options[argmaxIndex]; if (!opt) return abstain();   // out-of-range index → abstain
  const actor: Actor = { kind: 'sim' };                           // ACTOR IS THE SIM, set by TCB code, never derived from model text
  if (can(actor, opt.action, opt.resource, ctx).effect !== 'allow') return;  // re-validate NOW (world moved); fully-injected model cannot override
  execute(actor, opt, opt.resource);                              // writes the NPC's PER_PLAYER row scoped to one owner
}
```

**Escalation fixes baked here:**
- **Client-asserted scope/owner forgery:** `resolveResource()` reads `scope`+`ownerAccountId` **exclusively from authoritative room/DB state**; the payload carries bare ids only. **CI test asserts `resolveResource` never reads scope/owner from the envelope.**
- **Missing-`can()` bypass:** one chokepoint shares `resolveResource()` with the enumerate path; **CI test asserts every mutating intent type routes through `can()` before `execute`.**
- **Co-presence leak (alice/bob, AUTH §2A.3):** a group DialogueRequest must never merge two owners' PER_PLAYER rows into one prompt; shared utterances draw on SHARED facts only; per-player context renders only to its own session. The DAL hard-scope (`WHERE account_id = session.accountId`, no model-supplied id) + cognition-svc's zero `authz`/`ledger`/`pgvector` grant is the structural backstop.
- **NestJS out-of-session PER_PLAYER writes** (async gift mailbox, grants, GDPR) route through the owning room or acquire the fence/`econ:lease` and reuse the same `can()` + `SessionScope` DAL — never a second looser writer. The N9 mailbox worker uses a **narrow `system` actor scoped to exactly one action AND to the target `ownerAccountId` derived from the triggering event**, never an arbitrary account.

---

## 4. Minimal Staff RBAC (Layer 3)

### 4.1 Roles × permissions

| Permission KEY | admin | moderator | support | designer/GM | analyst |
|---|:--:|:--:|:--:|:--:|:--:|
| `report.view` | Y | Y | Y | – | – |
| `report.triage` | Y | Y | – | – | – |
| `chat.decrypt_reported` | Y¹ | Y | – | – | – |
| `player.mute` / `player.kick` | Y | Y | – | – | – |
| `player.ban` (temp) | Y | Y | – | – | – |
| `player.ban_permanent` / `player.unban` | Y | – | – | – | – |
| `canon.edit` | Y | – | – | Y | – |
| `canon.publish` (prod → admin co-sign) | Y | – | – | Y² | – |
| `killswitch.canon_hotfix` | Y | – | – | Y² | – |
| `killswitch.economy_halt` | Y | – | – | – | – |
| `killswitch.event_rollback` (dual-control) | Y | – | – | – | – |
| `economy.request` (adjust/refund) | Y | – | Y | – | – |
| `economy.approve` (**SoD: requester≠approver**) | Y | – | – | – | – |
| `impersonate.start` | Y | – | Y³ | – | – |
| `staff.grant_role` / `staff.revoke_role` | Y | – | – | – | – |
| `audit.read` | Y | Y⁴ | – | – | – |
| `analytics.read` | Y | – | – | – | Y |

¹ admin only via break-glass dual-control. ² prod publish/hotfix needs admin co-sign; staging self-serve. ³ non-consented prod access needs break-glass dual-control. ⁴ scoped to own reports.

### 4.2 How staff auth differs from players — the token split (resolves the roles-on-token inconsistency)

**Decision: roles are kept OFF the token and resolved LIVE.** Rationale: players ≫ staff; staff privilege is high-blast-radius and must be instantly revocable, never trusted from a cached claim.

- **Play token: UNCHANGED (byte-for-byte frozen §4.2).** No `roles` claim. Baking roles into the `scope:"play"`, Discord-gated, 10-min token would turn the MUST-15 XSS minting-oracle into admin escalation.
- **NEW staff token** (additive, same EdDSA signer/JWKS, same revocation overlay): `{iss, sub:account_id, aud:["celestia-admin"], scope:"staff", amr:["mfa"], staffSid, exp≈15min, jti}` — **no `roles` claim**; roles are resolved live. Minted only by `POST /staff/elevate` after **step-up MFA** (WebAuthn/TOTP) against a server-side `staff_grants`/`role_binding` row. `aud` is **never** `celestia-realtime` (staff cannot open a room as staff) and **never** `celestia-api` alone. This is NOT the dev-tester bypass: staff are real humans, MFA-gated; a `provider:'dev'` identity can **never** hold a staff grant (fail-closed boot assertion). Staff grants are **never** a Discord role and **never** the dev/tester allowlist.

**StaffGuard order (the critical escalation fix):**
```ts
// Fail-closed, in THIS order, BEFORE any role lookup:
assert(token.scope === 'staff');            // 1
assert(token.aud.includes('celestia-admin'));  // 2  (a play token carries celestia-api — insufficient, by design)
assert(token.amr.includes('mfa'));          // 3
const roles = await resolveStaffRoles(sub); // 4  live from authz.role_binding + Redis staff:roles:<id>
return can({kind:'staff', accountId:sub, roles, ...}, action, resource, ctx);
```
A stolen/XSS'd **play** token of a human who also holds a `role_binding` is **never sufficient** for a privileged action — steps 1–3 reject it before any role is read.

### 4.3 Impersonation (support/debug) — enforced in code, not prose

`POST /staff/impersonate` mints a **play-scoped** token: `scope:"play"`, `aud:["celestia-realtime"]`, `sub:<target>`, `act:{sub:<staff_account_id>}` (RFC 8693), `imp:true`, short TTL. **`onAuth` MUST be extended** (ratified like E1/E2; update MUST-13) to **read `imp`/`act` and surface them in `client.auth`** — the frozen onAuth today reads only `aud`+`alpha` and drops these claims, so without this the guardrail does not exist. Then: the **EconomyService chokepoint denies all value movement AND destructive intents when `imp===true`**; impersonation confers zero staff power; presence is flagged; `impersonation.start`/`.end` audit events are mandatory; non-consented prod access requires break-glass dual-control. The mint path + claims are baked; the per-session consent UX is deferred (launch = break-glass + blanket ToS).

### 4.4 Separation of duties on economy ops

The SoD **predicate** is baked inside `can()`: for `econ.adjust | econ.refund | econ.mint | econ.withdraw.approve` and `mod.ban_permanent`/clawback, `can()` requires `ctx.dualControl.approvalId` and enforces `approverAccountId !== actor.accountId` **even for admins** (`same_approver → deny`). The approval is itself an audited event, and the capture routes through EconomyService (no second money-write path). At launch the only live money op is `admin_adjust`/`refund` (no mint/withdraw code path exists); the full ceremony (cold-multisig, ReviewQueue 4-eyes UI, HSM, emission cap) is **DEFERRED to the bridge phase**.

**Residual (accepted, per WEB3 E16):** with a 1–2-person launch team, 4-eyes is theater — one human can self-grant a second account and self-approve. We bake the cheap predicate, **add correlation alerting on grant-role-then-approve by the same operator**, and explicitly accept logged single-admin money ops when staffing cannot satisfy 4-eyes. We do **not** build an approval-queue/workflow engine.

### 4.5 `ch:admin` publisher authorization (the single biggest in-band escalation path)

Kill switches (`canon_hotfix`, `economy_halt`, `event_rollback`) are honored by live rooms off `ch:admin` with no publisher authz today — any component holding Redis `PUBLISH` (cognition-svc, Gateway, a worker) could bump canon or halt the economy and the TCB executes blindly. **Fix:** Redis ACL so **only the Meta API credential may `PUBLISH ch:admin`**; every command carries `actor_account_id` + a `staff.action@1` ref; the room **ignores commands lacking the Meta API's authority**. Every switch routes through `StaffGuard` + emits `staff.action@1` (dual-control on `event_rollback`). The gates are baked; operator tooling stays a runbook (DEFER the GUI).

### 4.6 In-room mute enforcement

`player.ban` maps to `ban:<account_id>` + revoke-kick. A **chat-only mute** needs an in-room enforcement point: `can('player.mute')` in the Meta API writes a `mute:<account_id>` overlay; the room TCB consults it at chat-intent admission (deny-by-default on expiry read). Baked as the enforcement seam; TTL management is config.

### 4.7 Per-user sanctions & restrictions (deny-rules) — generalizes mute/ban

`player.mute` (§4.6) and `player.ban` are two cases of a general **sanction** model: a *specific* account is denied an action others may perform (e.g. "block this griefer from this village"). Model all of them as **first-class, time-boxed restriction records**, not scattered flags — so they are reviewable, reversible, and audited.

```jsonc
// authz.restriction — projection of authz.restriction.applied@1 / .lifted@1 logged events (Seam-6 truth)
{ "account_id":"…", "type":"zone_ban|mute|trade_block|jail|interaction_ban",
  "target":"<zoneId|npcId|null>",      // scope of the restriction (null = global for that type)
  "until":"<ts|null>",                  // null = until lifted
  "reason":"…", "issued_by":"<staff_account_id>", "ref":"<staff.action@1 seq>" }
```

**Decision (in `can()`):** restrictions are consumed as **explicit denies with precedence** — grants (roles / entitlements / ownership) say what an actor *may* do; a matching active restriction **overrides to `deny:'restricted'`** (added to the §5 `DenyCode` union). Deny-by-default still governs grants; sanctions are a small, explicit deny-set layered on top. `can()` stays pure/no-IO: the active restriction set is resolved onto the player `Actor` by the one `ActorResolver` **before** the call (same discipline as live staff roles).

**Enforcement points (type → where):**

| Type | Denied action | Enforced at |
|---|---|---|
| `zone_ban` | enter / move into `target` zone | **matchmaking / seat-reservation** (refuse the zone-room — can't even connect) **AND** room TCB (reject the cross-zone move intent) |
| `mute` | chat intent | room TCB chat-intent admission (the §4.6 `mute:` overlay) |
| `trade_block` | trade / gift / marketplace | room TCB + EconomyService (anti-RMT) |
| `jail` | most world actions except a confined set | room TCB (enumerate shrinks to the confined set) |
| `interaction_ban` | converse / interact with `target` | room TCB |

A `zone_ban` is enforced **twice** — at connect (matchmaking won't seat them in that room) and at move (the TCB rejects the cross-zone intent) — so neither path is a hole; the server owns position, so a restricted client cannot bypass by moving locally.

**Authz vs moderation (the split):** the *decision* (`can()` → `deny:'restricted'`) and the *record shape* above are **authz** (this doc). *Issuing* a restriction is a privileged Layer-3 action — a `player.restrict` capability (moderator) that writes the record + a mandatory `staff.action@1` audit (§6). *Management* (appeals, review, lift, escalation ladder) belongs to the **moderation plane** (mechanism = launch-blocker, GUI = deferred). The restriction record is where the two meet.

| Item | Label |
|---|---|
| First-class `authz.restriction` record (logged-event projection) + `type` enum + `can()` explicit-deny-`restricted` precedence + resolve-onto-Actor | **BAKE-IN-NOW** |
| `zone_ban` enforced at BOTH matchmaking and the TCB move intent; `trade_block` at EconomyService; `mute` reuses the §4.6 overlay | **BAKE-IN-NOW** |
| `player.restrict` RBAC capability (moderator) + `staff.action@1` audit on apply/lift | **BAKE-IN-NOW** |
| Appeals/review workflow + escalation ladder + mod console; shadow-restrictions; auto-moderation heuristics that issue restrictions | **DEFER** |

---

## 5. The Policy Chokepoint — `can()`

**One package, one Actor union, one signature** (collapses the Layer-2 `@celestia/core/authz`, the Layer-3 `StaffPolicy`, and the cross-cutting `PolicyService` into exactly one — a wrapper over two separate `can()`s would itself violate "ONE decision point").

```ts
// @celestia/authz — pure, synchronous, NO IO, deterministic, deny-by-default. Safe in the single-threaded room tick.
type DenyCode = 'no_matching_grant' | 'not_owner' | 'wrong_scope' | 'global_write_forbidden'
  | 'shared_direct_write_forbidden' | 'role_required' | 'wrong_scope_token' | 'mfa_required'
  | 'dual_control_required' | 'same_approver' | 'impersonation_forbidden' | 'unknown_actor' | 'revoked'
  | 'restricted';  // §4.7 — a matching active per-user sanction overrides grants
type Decision = { effect: 'allow'; reason: string } | { effect: 'deny'; reason: DenyCode };

type Action =                                  // CLOSED union; CI bans unknown slugs
  // in-game — PRESERVES the SHARED interaction-vs-direct-write distinction (isInteraction)
  | 'read' | 'move' | 'use' | 'equip' | 'plant' | 'harvest' | 'build' | 'gift'
  | 'converse' | 'purchase' | 'trade' | 'write_relationship'
  // moderation / admin
  | 'report.view' | 'report.triage' | 'chat.decrypt_reported'
  | 'player.mute' | 'player.kick' | 'player.ban' | 'player.ban_permanent' | 'player.unban'
  | 'canon.edit' | 'canon.publish' | 'killswitch.canon_hotfix' | 'killswitch.economy_halt' | 'killswitch.event_rollback'
  | 'impersonate.start' | 'staff.grant_role' | 'staff.revoke_role' | 'audit.read' | 'analytics.read'
  // money plane
  | 'econ.adjust' | 'econ.refund' | 'econ.withdraw.approve' | 'econ.mint';

type Actor =                                   // assembled ONLY by the one ActorResolver; NEVER from LLM output
  | { kind: 'player'; accountId: string; entitlements: readonly string[]; scope: readonly string[]; sid: string; ver: number;
      imp?: { onBehalfOf: string } }           // impersonation surfaced from onAuth (act/imp)
  | { kind: 'sim' }                            // the room's deterministic/NPC writer; holds the Seam-5 zone fence
  | { kind: 'staff'; accountId: string; roles: readonly StaffRole[]; scope: 'staff'; amr: readonly string[]; staffSid: string }
  | { kind: 'system'; system: string; scopedToOwnerAccountId?: string }; // narrow single-action worker (e.g. N9 mailbox)

interface Resource { kind: string; scope: 'GLOBAL'|'SHARED'|'PER_PLAYER'; ownerAccountId?: string; npcId?: string; id?: string; }
interface Ctx { now: number; surface: 'room'|'nest-rest'|'nest-worker'; justification?: string;
                dualControl?: { approvalId: string; approverAccountId: string }; requestId?: string; traceparent?: string; }

function can(actor: Actor, action: Action, r: Resource, ctx: Ctx): Decision;  // default branch → deny
```

**Properties:** no IO inside `can()` — the Actor (incl. live-resolved roles + revocation state) is assembled **before** the call by the one `ActorResolver`, so it is safe in the room hot loop and callable from the NestJS guard. Called by **both** guards and the room (§3.2, §4). Legality/enumerate-membership stays in the sim — `can()` checks *principal authority & ownership*, not the legal option set.

| Decision | `can()` called at | Failure |
|---|---|---|
| Access tier | `onAuth` via `hasAnyEntitlement(c, OPEN_TIERS)` | WS 4030 |
| In-game ownership/scope | room intent pipeline `auth` step (before enumerate) | reject intent |
| In-game legality | the **sim** (not `can()`) | reject intent |
| Privileged REST | NestJS `StaffGuard` → `can()` | HTTP 403 |
| Money / destructive | `EconomyService` calls `can()` + SoD **before** posting | refuse + audit |

**Confused-deputy rule:** the Actor is **always** derived from the end-caller's verified token + live overlay; the gateway/room/worker never act with more authority than the requesting session. The LLM/gateway hold zero `authz` grant and are never Actors.

---

## 6. Audit

Audit is **not a separate store** — it is a typed event family (`authz.audit@1`, `staff.action@1`, `econ.approval@1`) in the existing Seam-6 `log.event` truth: same `seq`, `prev_hash` hash-chain, fence-guarded, **durable-before-ack**. Append-only + tamper-evident + replayable for free; makes WEB3 E16 ("admin actions are themselves `log.event`s") literal.

```jsonc
{ "type":"staff.action@1", "seq":N, "prev_hash":"…", "at":…, "surface":"nest-rest",
  "actor_account_id":"…", "actor_roles":["moderator"], "staff_sid":"…", "on_behalf_of":null,  // WHO (+impersonation trail)
  "action":"chat.decrypt_reported", "decision":"allow", "deny_reason":null,                     // WHAT (audit BOTH grant & deny)
  "target":{ "type":"report", "id":"#123", "target_account_id":"…", "message_seqs":[…] },        // TARGET (ids only, not content)
  "justification":"report #123 harassment", "justification_digest":"sha256:…",                   // operator-authored text (NOT subject PII)
  "dual_control":null, "amr":["mfa"], "ip":"…", "ua":"…", "legal_hold_ref":"…" }
```

**Crypto-shred reconciliation (the key invariant, simplified per critique).** Audit records are **PII-FREE by construction**: structural fields (who / action / when / target-**id** / decision / approval-ref / justification-digest) are what the hash chain covers and **survive crypto-shred forever** (tombstone). **Decrypted personal payloads (chat plaintext, memory snapshots) are NEVER copied into the audit record** — they are referenced by `target.id`/`message_seqs`; any subject PII lives only in the per-subject-DEK rows and becomes noise when that subject's DEK is destroyed. Because we **never persist PII in audit**, the DEK-encrypted-shreddable audit *payload* machinery is **unnecessary — DEFER it entirely.** Moderator justification is operator-authored text about a report (not subject PII) and is kept structural.

**Legal-hold ⇄ erasure.** `chat.decrypt_reported` is scope-limited to the exact `message_seqs` named by the report (never whole-account history); plaintext shown ephemerally, never re-persisted; each decrypt audited. A `legal_hold` flag gates per-account-DEK destruction: a hold **defers** shred for held material; **when the hold expires, shred wins after retention** (ARCHITECTURE Risk-5, WEB3 §11.2). The DEK-hold seam is baked; the hold-management workflow + e-discovery export are DEFER (ties to ARCHITECTURE Open Decision #12, backup residue).

**In-game audit (Layer 2):** deny-only, low-cardinality metric `authz_denied_total{action,scope,reason}` (no per-player labels — Seam 7) + a rate-limited security event on cross-owner denies (anomalous because the client is enumerated → flag to moderation). ALLOW audit rides the existing domain `log.event` carrying the acting `account_id` — no separate allow-log.

**`audit.read`:** reading the raw audit log is itself PII-sensitive (target_account_id, justification) and is gated by the `audit.read` permission (§4.1).

**Availability tradeoff (accepted):** a privileged/money/mod action **fails closed if its durable-before-ack audit write fails** — no action without its audit. Privileged actions are rare; this is a deliberate liveness-for-accountability trade.

---

## 7. Top Authz Risks (ranked)

1. **Staff REST confused-deputy via live role resolution.** A stolen/XSS'd **play** token of a human who also holds a `role_binding` calls staff endpoints. **Mitigation:** `StaffGuard` asserts `scope=='staff'` AND `aud=='celestia-admin'` AND `amr⊇mfa` **FIRST, fail-closed, before any role lookup** (§4.2). Only the step-up token carries staff authority; the play token is never sufficient regardless of `role_binding`.
2. **`ch:admin` unauthenticated command channel → room as confused deputy.** Any Redis-`PUBLISH` holder could halt the economy or bump canon. **Mitigation:** Redis ACL → Meta API credential only; commands attributed to `staff.action@1`; room ignores unauthorized commands (§4.5).
3. **Impersonation value-movement unenforced** because frozen `onAuth` drops `imp`/`act`. **Mitigation:** extend `onAuth` to read+surface them; EconomyService denies all value movement + destructive intents under `imp===true`; presence flagged; start/end audited (§4.3).
4. **Client-asserted scope/owner forgery.** `{resourceId:A_plot, ownerAccountId:self}` → `can()` returns owner. **Mitigation:** scope+owner resolved exclusively from authoritative room/DB state; payload carries bare ids; CI test on `resolveResource` (§3.2).
5. **Co-presence cross-player leak** (alice/bob). **Mitigation:** shared NPC utterances draw only on SHARED facts; never merge two owners' PER_PLAYER rows into one prompt; per-session DAL hard-scope; cognition-svc zero grant (§3.2).
6. **Missing-`can()` bypass** — a handler forgets the ownership gate. **Mitigation:** one chokepoint sharing `resolveResource()` with enumerate; CI test asserts every mutating intent routes through `can()` before `execute` (§3.2).
7. **Roles-on-token creep** — a `roles` claim added "for convenience" creates a 10-min stale-privilege window and makes any stolen play token an escalation vector. **Mitigation:** freeze "no roles on the play token" in the contract; assert in MUST-13; roles are live-resolved (§4.2).
8. **SoD self-approval residual** at launch team size. **Mitigation:** bake the `requester≠approver` predicate; add correlation alerting on grant-role-then-approve by the same operator; accept the residual explicitly — do not pretend 4-eyes holds with one human (§4.4).
9. **NestJS out-of-session PER_PLAYER writes** as a second looser writer. **Mitigation:** route through the owning room/fence/`econ:lease`, reuse the same `can()` + `SessionScope` DAL; N9 worker uses a narrow `system` actor scoped to one action + the event-derived `ownerAccountId` (§3.2).
10. **Audit PII contamination** — stuffing decrypted chat into a hash-chained (un-shreddable) field = permanent GDPR breach. **Mitigation:** structural audit fields are PII-free by schema; PII referenced by id only; schema/CI guard (§6).
11. **Dev/tester source → staff or universal-alpha leak into prod.** **Mitigation:** AUTH §2A.3 env-gating + fail-closed boot assertion + CI manifest check; `provider:'dev'` can never hold a staff grant; `gate.roles` are entitlement-source only, never staff RBAC.
12. **Source privilege-escalation** — a low-trust source mints a high-trust tier. **Mitigation:** source-authority invariant (allowed `source→type[]`); "linking never by itself unlocks P2E."
13. **Over-building** — RBAC engine/console/policy DSL pre-launch burns the game-first budget and ossifies the wrong shape (D3). **Mitigation:** plain switch + 5 seeded roles + one predicate + one audit event; defer every engine and GUI.

---

## 8. BAKE-IN-NOW vs SAFE-TO-DEFER + Open Decisions

### BAKE-IN-NOW
- **One `can(actor, action, resource, ctx)` chokepoint** in one package `@celestia/authz` — one Actor union (`player|sim|staff|system`), one signature, imported by NestJS guards AND the room TCB; pure/sync/no-IO; deny-by-default; closed `Action`/`DenyCode` unions with CI slug-ban; fail-closed on unavailable live role data.
- **Explicit Layer-2 ownership/scope model** (typed `Resource{scope, ownerAccountId}`), scope+owner resolved only from authoritative state, inserted as a named stage before enumerate-membership, re-run on NPC/System-2 apply; `account_id` the sole principal; **LLM never an Actor**; CI tests for forgery + missing-`can()`.
- **DAL hard-scope** (`SessionScope` required, no model/caller-supplied id), extended to multi-party co-presence prompt assembly; cognition-svc zero `authz`/`ledger`/`pgvector` grant.
- **Staff/play token split**: separate short-TTL `scope:'staff'`, `aud:['celestia-admin']`, `amr:['mfa']` token minted only after step-up MFA against server-side `staff_grants`; `StaffGuard` fail-closed on scope+aud+amr before role lookup; play token byte-for-byte frozen (no roles claim); roles live-resolved from `authz.role_binding` + Redis overlay.
- **5 fixed roles + closed permission enum** seeded in `authz.role_binding`; `can()` a plain switch.
- **`ch:admin` publisher authorization** (Redis ACL → Meta API credential; room ignores unauthorized commands); auth gate + audit on every kill switch.
- **`staff.action@1` hash-chained audit** in Seam-6 `log.event`, PII-free structural fields + id references only, durable-before-ack; `audit.read` permission; deny-only low-cardinality in-game metric.
- **SoD predicate** inside the chokepoint (`approver≠requester` even for admins) + correlation alerting; **impersonation claims end-to-end** (onAuth reads/surfaces `imp`/`act`; EconomyService denies value movement + destructive under `imp`).
- **Entitlement seams**: `resolveEntitlements()` sole mint+refresh resolver; `OPEN_TIERS` config replacing hardcoded `'alpha'`; source-authority invariant; `isFeatureEnabled()` over a static config map; grant/revoke as logged events; geo/KYC never in `ent[]`.
- **Staff revocation** via the live-role path (`DEL staff:roles:<id>` + `PUBLISH celestia:auth:revoke {account_id, sid, scope:'staff'}`) — **independent of the play-session uversion bump**, short-TTL staff token backstop.
- **Per-user sanctions/restrictions** (§4.7): first-class `authz.restriction` records (logged-event projection) consumed by `can()` as explicit `deny:'restricted'` with precedence over grants; `zone_ban` enforced at BOTH matchmaking and the TCB move intent; issued via a `player.restrict` RBAC capability + `staff.action@1` audit.
- **Legal-hold DEK flag** gating crypto-shred (hold defers, shred wins after retention).
- **Rate-limit/lockout** on `/staff/elevate` + `/staff/impersonate`.
- **Ratification:** generalizing `hasEntitlement`→`hasAnyEntitlement(c, OPEN_TIERS)` / `hasEntitlement(principal, key)`, and adding `imp`/`act` to onAuth, touch frozen AUTH constants and MUST go through the **MUST-13 contract-test ratification** — not silent edits.

### SAFE-TO-DEFER
- Admin/moderation/approval-queue/impersonation **consoles** (mechanism baked; launch runs the moderation plane via authenticated endpoints + CLI + runbooks).
- Policy DSL/engine, OPA-style externalized policy, ABAC conditions; fine-grained/custom permissions, role hierarchy, delegation, time-bound grants, role-management UI.
- Full mint/withdraw ceremony (cold-multisig, ReviewQueue 4-eyes UI, HSM/signer policy, published emission cap) — bridge phase; the SoD predicate is baked now.
- `EntitlementSource` port + Stripe/Telegram-Stars/wallet (`leased_onchain`) adapters; self-serve/billing tiers; feature-flag service/UI/cohort targeting.
- Region/jurisdiction/age/KYC gating in ComplianceGate (null-ALLOW stub, per-asset×jurisdiction, enabled LAST — no reserved compliance columns now).
- Postgres RLS as a second mandatory layer; per-account `econ:lease` + two-room escrow saga (unless synchronous cross-zone trade ships at launch — N9).
- DEK-encrypted-shreddable audit **payload** (removed by the "never persist PII in audit" rule); SIEM/alerting; external tamper-anchoring beyond the `prev_hash` chain.
- Staff IdP/SSO/SCIM/directory sync; per-session impersonation-consent UX; automated legal-hold/e-discovery workflow; full event-sourcing of the staff-grant projection (D11).

### Open Decisions
1. **DSAR / self-service erasure (crypto-shred) initiation authz** — who triggers erasure (player-self vs admin), the step-up required, and how it composes with legal-hold. High-impact privileged action, currently ungated. *Proposed:* player-self initiates via authenticated `scope:'play'` request on their own `account_id`; admin override needs `staff` + dual-control under hold; shred deferred while any `legal_hold_ref` is active. Ratify before GA.
2. **Backup residue vs crypto-shred** (ARCHITECTURE Open Decision #12) — shredded DEKs vs snapshot/WAL copies; retention window and tombstone handling.
3. **N9 synchronous cross-zone trade/gifting** — if it enters the launch slice, the per-account `econ:lease` + escrow saga flips from DEFER to BAKE-IN.
4. **Staff elevation hardware** — WebAuthn vs TOTP as the launch step-up factor, and whether a dedicated staff signer is warranted before the money bridge.
5. **Mute overlay TTL semantics** — default durations, escalation ladder, and whether mute state is a `log.event` projection or a plain Redis overlay.
