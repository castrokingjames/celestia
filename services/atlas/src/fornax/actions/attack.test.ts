// Unit tests for the FORNAX attack action — pure (no DB, no Colyseus): drive the pipeline with a fake ZoneCombat.
// Proves the server computes the damage + emits the right events, and deny-by-default (unknown/dead/out-of-reach
// target → no write, no event, reports the stage). The same action serves player→mob and mob→player.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionPipeline } from "../pipeline.js";
import { InMemoryEventSink } from "../event-sink.js";
import { SignalBus } from "../signal-bus.js";
import { attackAction, ATTACK, ENTITY_DAMAGED, ENTITY_KILLED, type Combatant, type ZoneCombat } from "./attack.js";
import type { Actor, Signal } from "../types.js";

const AT = 1000; // fixed server-clock stamp (deterministic — G9)
const actor: Actor = { accountId: "a1", characterId: "c1", role: "terra" };

function build(target: Combatant | undefined, reach = true, damage = 3) {
  const sink = new InMemoryEventSink();
  const bus = new SignalBus();
  const fired: Signal[] = [];
  bus.on(ENTITY_DAMAGED, (s) => fired.push(s));
  bus.on(ENTITY_KILLED, (s) => fired.push(s));
  const world: ZoneCombat = { target: () => target, inReach: () => reach, damage };
  const pipeline = new ActionPipeline([attackAction], sink, bus);
  return { pipeline, sink, fired, world };
}

describe("Fornax attack action", () => {
  it("when a target in reach is hit, then it emits entity_damaged with the server-computed hp and loses hp", async () => {
    const mob: Combatant = { x: 0, y: 0, hp: 8, maxHp: 8 };
    const { pipeline, sink, fired, world } = build(mob, true, 3);
    const outcome = await pipeline.dispatch({ type: ATTACK, targetId: "m1" }, actor, world, AT);
    if (!outcome.ok) assert.fail(`denied at ${outcome.stage}`);
    assert.equal(mob.hp, 5);
    assert.equal(outcome.events.length, 1);
    assert.equal(outcome.events[0].type, ENTITY_DAMAGED);
    assert.deepEqual(outcome.events[0].data, { targetId: "m1", damage: 3, hp: 5, maxHp: 8 });
    assert.equal(sink.events.length, 1);
    assert.equal(fired.length, 1);
  });

  it("when the hit is lethal, then it also emits entity_killed and clamps hp to 0", async () => {
    const mob: Combatant = { x: 0, y: 0, hp: 2, maxHp: 8 };
    const { pipeline, sink, fired, world } = build(mob, true, 3);
    const outcome = await pipeline.dispatch({ type: ATTACK, targetId: "m1" }, actor, world, AT);
    if (!outcome.ok) assert.fail("expected ok");
    assert.equal(mob.hp, 0);
    assert.deepEqual(
      outcome.events.map((e) => e.type),
      [ENTITY_DAMAGED, ENTITY_KILLED],
    );
    assert.equal(sink.events.length, 2);
    assert.equal(fired.length, 2);
  });

  it("when the target is out of reach, then it is denied at qualify with no event and no hp change", async () => {
    const mob: Combatant = { x: 0, y: 0, hp: 8, maxHp: 8 };
    const { pipeline, sink, fired, world } = build(mob, false, 3);
    const outcome = await pipeline.dispatch({ type: ATTACK, targetId: "m1" }, actor, world, AT);
    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "qualify");
    assert.equal(mob.hp, 8); // execute never ran
    assert.equal(sink.events.length, 0);
    assert.equal(fired.length, 0);
  });

  it("when the target is already dead, then it is denied at qualify", async () => {
    const mob: Combatant = { x: 0, y: 0, hp: 0, maxHp: 8 };
    const { pipeline, sink, world } = build(mob, true, 3);
    const outcome = await pipeline.dispatch({ type: ATTACK, targetId: "m1" }, actor, world, AT);
    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "qualify");
    assert.equal(sink.events.length, 0);
  });

  it("when the target is unknown, then it is denied at enumerate with no event", async () => {
    const { pipeline, sink, world } = build(undefined);
    const outcome = await pipeline.dispatch({ type: ATTACK, targetId: "ghost" }, actor, world, AT);
    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "enumerate");
    assert.equal(outcome.reason, "unknown_resource");
    assert.equal(sink.events.length, 0);
  });
});
