<!-- The in-game action pipeline + the access model: how every in-game action is processed, and the
     Polaris (help-desk) / Atlas (game) split that makes it work. Renames the can()/enumerate() stages of
     PLATFORM.md §3.6. Reconciles with AUTHZ.md, CHARACTERS.md, AUTH.md, WORLDS.md. Codenames per NAMING.md. -->

# PIPELINE.md — the in-game action pipeline & the access model

**Status:** **DESIGN (target) — not built.** Renames the pipeline stages from `PLATFORM.md §3.6` and implies
a refactor of the P1.5 as-built (characters move Polaris→Atlas; two tickets collapse to one — see §8).
**Owners:** Platform / Engine.
**Reads with:** `docs/AUTHZ.md`, `docs/CHARACTERS.md`, `docs/AUTH.md`, `docs/WORLDS.md`,
`.context/architecture/guardrails.md` (G1 / G4 / G6 / G11).

---

## 1. Two tiers — help desk vs game

Plain English: **Polaris is the help desk; Atlas is the game.**

- **Polaris (help desk) — access only.** Authenticates you, assigns your access/clearance, and hands you a
  **signed badge** (a ticket). It touches **no** game data. It decides *who you are* and *what clearance you
  hold* — nothing about the world.
- **Atlas (game) — everything in-world.** Owns the live world and all game data. It verifies the badge at the
  door and runs every in-game action through the pipeline (§4). Characters, zones, items, world state are all
  Atlas's.

Picture: the help desk checks you in and gives you a stamped ID; the doors inside read the ID (and the
building's own records) to let you through. **The desk never runs the doors; the doors never issue IDs.**

The two tiers **never talk to each other** (no RPC). They coordinate only via (a) the client-carried **signed
badge**, and (b) **shared datastores**, each writing only its own lane (§3).

## 2. The signed badge (ticket)

- Polaris **signs** it (private key); Atlas **verifies** it (public key), **offline** — no call back to Polaris.
- Carries **account-level facts only**: `accountId`, `role`/clearance, entitlements — assigned by Polaris from
  authoritative state at issue time.
- **Tamper-proof:** change the role → the signature breaks → Atlas rejects it. The client is just the courier
  (**G11** — Polaris-asserted, never client-asserted). Even a stolen *public* key can't forge one.
- It's a **snapshot** at issue time: the signature proves it's *genuine*, not that it's still *current*. A short
  TTL bounds staleness at the gate; mid-session changes (ban/demote) ride the revocation channel (§6).

## 3. One writer per table

No table is written by both tiers. The only cross-tier access is **reads**; the only live link is the badge.

| Writer | Tables |
|---|---|
| **Polaris** (account/auth) | `account`, `auth_identity`, `refresh_token`, `role` |
| **Atlas** (game) | `game_character`, `character_placement`, `log.event`, all world/entity state |

Enforced by per-service DB roles (least-privilege GRANTs): **Atlas has no write grant on the account/auth
tables** — it physically cannot change a role or a ban. That GRANT *is* the "Atlas never changes access state"
invariant (not a promise in prose — a permission Postgres enforces).

## 4. The in-game action pipeline

Every mutating in-game action (move, use item, open chest, attack, enter zone, trade…) runs the **same four
stages, in order, in Atlas**. Deny-by-default; short-circuit on the first failure.

```
enumerate(resources)  →  allow(accesses)  →  qualify(states)  →  execute  →  event  →  signal
```

| Stage | Plain English | Operates on | Reads from | Kind |
|---|---|---|---|---|
| `enumerate(resources)` | load the target object(s); missing → reject | the targets (chest, mob, item…) | authoritative game state | fetch |
| `allow(accesses)` | are you **allowed** here? | role / clearance / entitlement | the **badge** (Polaris-assigned) | **access** gate (G6 chokepoint) |
| `qualify(states)` | do you **qualify**? | level / class / item / cooldown / ownership | **game state** (Atlas-owned) | **in-game** gate |
| `execute` | do it (compute + mutate) | — | — | the write |
| → `event` | record the durable truth in `log.event` | — | — | event-sourcing (G4) |
| → `signal` | fire a live in-memory signal; listeners react | — | — | reactive glue (not persisted) |

Reads as a sentence: ***enumerate*** the resources → are you ***allowed*** (access) → do you ***qualify***
(state) → ***execute***.

**Constant vs variable:** the four stages never change (the security spine). What varies per action is the
*data* plugged into each — which resource, which access requirements, which state requirements, which mutation.
Adding combat / items / trade = new data in the same stages, never a new path.

**Two spine additions** for special cases: shared-resource writes add a single-writer **fence** before
`execute`; turn-based/PvP adds a sealed-commit **barrier**. **Movement** is write-behind (position is a snapshot,
not an event per tick) but still conceptually passes the gates.

## 5. The two gates = access vs state

The split that resolves "where does authz live":

- **`allow(accesses)` = access authz.** *"May this principal act here at all?"* Reads the **badge**
  (role / clearance / entitlement). The deny-by-default chokepoint every mutating intent passes (G6).
  *(Was `can()`.)*
- **`qualify(states)` = in-game authz.** *"Is this a valid move for this character right now?"* Reads **game
  state** (level / class / item / ownership / cooldown). *(Was `enumerate()`.)*

Both evaluate a **declared set of requirements** — data, not hand-written `if`s. Each requirement is typed; a
checker-per-type reads its source; the gate ANDs them, short-circuits on first failure, and returns *which*
requirement failed (so the client can say "you need the Dragon Key").

```ts
type Requirement =
  | { type: "entitlement"; value: string }  // → allow()    (badge)
  | { type: "role";        value: string }  // → allow()    (badge)
  | { type: "level";       min: number }    // → qualify()  (game state)
  | { type: "class";       value: string }  // → qualify()  (game state)
  | { type: "item";        id: string };    // → qualify()  (inventory)
```

The engine routes each requirement to the gate that owns its data source: **badge requirements → `allow()`;
game-state requirements → `qualify()`.**

**Composite example — a door requiring premium + level 50 + Knight + a key:**

```
allow():   entitlement == premium?     [badge]
qualify(): level ≥ 50?                  [char state]
qualify(): class == Knight?             [char state]
qualify(): has dragon-key?              [inventory]
  all pass → execute (enter) · any fail → reject (with the failed requirement)
```

**The rule for which gate:** decided by **what the requirement checks, not by the action.** Role/entitlement →
`allow()` (badge). Game state (a key item, a level, ownership) → `qualify()` — even for "enter a room," because
the gate reads game state, not the badge.

## 6. Who decides access vs who enforces it

- **Access is DECIDED by Polaris** (role / entitlement / ban), stamped into the badge. Atlas never *decides* or
  *writes* access state.
- **Enforced in Atlas** at the gates: `allow()` reads the badge and compares it to the action's requirement.
  (In-game `qualify()` decisions are *made* by Atlas from its own state — the only place that data lives.)
- **Ban (revoking a live session):** Polaris decides + writes the ban + publishes a one-way `revoke(accountId)`
  on **Valkey**. The Atlas instance holding that socket **kicks it** (`client.leave`). The client never
  self-disconnects — notification is UX; the **server severs the socket**. The durable ban + revoked refresh
  block re-entry at the gate. Atlas writes **no** authz state; it only drops the connection it owns.
- **In-game GM `/ban`:** the GM's *authority* comes from the badge (`allow()` reads it); the ban *write* is
  still Polaris's (via a request/event Polaris consumes). Atlas kicks the socket; it never writes the account
  table.

## 7. Guardrail alignment

- **G1** — the client sends only ids/indices; `enumerate()` loads the real object; the gates and `execute`
  compute everything.
- **G6** — `allow()` is the deny-by-default access chokepoint every mutating intent passes before
  `qualify`/`execute`.
- **G4** — `execute` emits durable events into `log.event`; the signal bus is live-only (never the log).
- **G11** — role/clearance is server-assigned (Polaris → signed badge), never client-asserted; the gates read
  the badge, never a client claim.

## 8. What this changes vs the P1.5 as-built (reconciliation)

This doc is the **target**; the as-built differs and gets reworked. Nothing here is built yet.

- **Naming:** `resolveResource → enumerate` · `can → allow` · `enumerate → qualify`. (Update `PLATFORM.md §3.6`
  and guardrail **G6**'s wording when the code adopts the names.) Reserve a *new* word (`options()`/`choices()`)
  for the LLM's bounded option-set — "enumerate" is now spent on stage 1.
- **Characters move Polaris → Atlas:** `game_character` + character list/create/select (the "lobby") become
  Atlas's (game data). Polaris stops touching any game table.
- **Two tickets → one:** the session ticket + zone ticket collapse into one **access badge**; character-select,
  zone-enter, and transitions all become **Atlas-internal** (room membership).
- **Polaris shrinks to a pure help desk:** REST login → signed badge. The WS session gateway's character/enter
  logic moves into Atlas.
- **One-session-per-account** enforcement moves to the Atlas connection.

Sequencing lives in the refactor/build plan (TBD).
