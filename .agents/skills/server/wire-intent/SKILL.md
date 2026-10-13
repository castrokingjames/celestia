---
name: wire-intent
description: Wire a new Colyseus intent end-to-end — client intent → room onMessage handler → authoritative state/schema change → broadcast/patch — plus a round-trip test, stopping at room registration. Triggers — "add an intent", "wire a new action", "let the client do X", "handle a new message in the room".
---

# Wire a Colyseus intent

Add a client→server action the authoritative way. **Copy the canonical example** (the `move` intent in `services/atlas/src/rooms/ZoneRoom.ts` + `ZoneState.ts`) — don't hand-roll a new shape.

## Steps

1. **Declare the type** in `packages/net-contract` (`INTENT_TYPES` / `IntentType`). One source of truth; never hand-type the string in the room or client (`conventions/organization.md`). Bump `PROTOCOL_VERSION` if the wire shape changes.
2. **Payload = ids / indices / typed args ONLY** — never an amount, price, balance, or state (`guardrails.md#G1`). If the action spends/earns, the server computes the number.
3. **Handle in the room** — `this.onMessage("<type>", (client, args) => { … })`:
   - resolve the actor/resource from **authoritative state**, not the envelope (`#G6`);
   - `can()` → `enumerate()` the legal set → validate the requested option is in it (`#G6`);
   - mutate authoritative schema state (or append an event once the event layer exists, `#G4`); value moves go through `EconomyService` (`#G5`).
4. **State out** rides the normal patch — mutate the schema; Colyseus deltas it. Private data → a per-client view / targeted message, not broadcast.
5. **Test the round-trip** — Vitest + `@colyseus/testing`: client sends the intent, assert the authoritative state change (and that an illegal/forbidden variant is rejected with a typed reason, `conventions/error-handling.md`).

## Stop at

room registration — do **not** wire client-side prediction/UI here (that's the Jupiter/client side). Hand back the intent type, the handler, and the test.
