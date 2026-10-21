// Unit tests for FORNAX — pure (no DB, no Colyseus): drive the pipeline directly with a fake ZoneInteractions.
// Proves the full loop (enumerate → allow → qualify → execute → event → signal) AND deny-by-default: an unknown
// action, an unresolved resource, or a failed gate produces NO write, NO event, and NO signal, and reports the
// stage it stopped at.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionPipeline } from "./pipeline.js";
import { InMemoryEventSink } from "./event-sink.js";
import { SignalBus } from "./signal-bus.js";
import { Astraea } from "./astraea.js";
import { leverAction, LEVER_TOGGLED, INTERACT, type Lever, type ZoneInteractions } from "./actions/lever.js";
import type { ActionDef, Actor, Signal } from "./types.js";

const AT = 1000; // fixed server-clock stamp (deterministic — G9)
const actor: Actor = { accountId: "a1", characterId: "c1", role: "terra" };

function fakeWorld(levers: Record<string, Lever>, reach = true): ZoneInteractions {
  return { lever: (id) => levers[id], withinReach: () => reach };
}

function build(reach = true) {
  const sink = new InMemoryEventSink();
  const bus = new SignalBus();
  const fired: Signal[] = [];
  bus.on(LEVER_TOGGLED, (s) => fired.push(s));
  const lever: Lever = { id: "lv1", on: false };
  const pipeline = new ActionPipeline([leverAction], sink, bus);
  return { pipeline, sink, fired, lever, world: fakeWorld({ lv1: lever }, reach) };
}

describe("Fornax action pipeline", () => {
  it("when an interact runs the full loop, then it toggles the lever, appends one event, and fires one signal", async () => {
    const { pipeline, sink, fired, lever, world } = build();
    const outcome = await pipeline.dispatch({ type: INTERACT, targetId: "lv1" }, actor, world, AT);

    if (!outcome.ok) assert.fail(`expected ok, denied at ${outcome.stage}: ${outcome.reason}`);
    assert.equal(lever.on, true); // state flipped
    assert.equal(outcome.events.length, 1);
    assert.equal(outcome.events[0].type, LEVER_TOGGLED);
    assert.deepEqual(outcome.events[0].data, { leverId: "lv1", on: true });
    assert.equal(outcome.events[0].at, AT);
    assert.equal(sink.events.length, 1); // appended to the durable sink
    assert.equal(fired.length, 1); // a signal fired to the subscriber
    assert.deepEqual(fired[0], { type: LEVER_TOGGLED, data: { leverId: "lv1", on: true } });
  });

  it("when a second interact arrives, then the lever toggles back and the sink holds two events", async () => {
    const { pipeline, sink, lever, world } = build();
    await pipeline.dispatch({ type: INTERACT, targetId: "lv1" }, actor, world, AT);
    const outcome = await pipeline.dispatch({ type: INTERACT, targetId: "lv1" }, actor, world, AT + 50);

    if (!outcome.ok) assert.fail("expected ok");
    assert.equal(lever.on, false);
    assert.deepEqual(outcome.events[0].data, { leverId: "lv1", on: false });
    assert.equal(sink.events.length, 2);
  });

  it("when the action is unknown, then it is denied at enumerate with no event and no signal", async () => {
    const { pipeline, sink, fired, world } = build();
    const outcome = await pipeline.dispatch({ type: "fly", targetId: "lv1" }, actor, world, AT);

    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "enumerate");
    assert.equal(outcome.reason, "unknown_action");
    assert.equal(sink.events.length, 0);
    assert.equal(fired.length, 0);
  });

  it("when the resource cannot be resolved, then it is denied at enumerate and the lever is untouched", async () => {
    const { pipeline, sink, lever, world } = build();
    const outcome = await pipeline.dispatch({ type: INTERACT, targetId: "nope" }, actor, world, AT);

    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "enumerate");
    assert.equal(outcome.reason, "unknown_resource");
    assert.equal(lever.on, false);
    assert.equal(sink.events.length, 0);
  });

  it("when the actor is out of reach, then it is denied at qualify with no write and no event", async () => {
    const { pipeline, sink, fired, lever, world } = build(false); // withinReach = false
    const outcome = await pipeline.dispatch({ type: INTERACT, targetId: "lv1" }, actor, world, AT);

    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "qualify");
    assert.equal(outcome.reason, "not_qualified");
    assert.equal(lever.on, false); // execute never ran
    assert.equal(sink.events.length, 0);
    assert.equal(fired.length, 0);
  });

  it("when the actor fails the access gate, then it is denied at allow before execute (deny-by-default role check)", async () => {
    const sink = new InMemoryEventSink();
    const bus = new SignalBus();
    let signalCount = 0;
    bus.on("gated_done", () => signalCount++);
    // A gated action: only the `ignis` role may run it; execute (if reached) would append an event.
    const gated: ActionDef<ZoneInteractions> = {
      type: "gated",
      enumerate: () => ({
        allow: (a) => Astraea.roleIn(a, ["ignis"]),
        qualify: () => true,
        execute: (a, at) => ({ events: [{ type: "gated_done", at, actor: a, data: {} }], commit: () => {} }),
      }),
    };
    const pipeline = new ActionPipeline([leverAction, gated], sink, bus);

    const outcome = await pipeline.dispatch({ type: "gated" }, actor, fakeWorld({}), AT); // actor.role = terra

    if (outcome.ok) assert.fail("expected denial");
    assert.equal(outcome.stage, "allow");
    assert.equal(outcome.reason, "forbidden");
    assert.equal(sink.events.length, 0); // execute never ran
    assert.equal(signalCount, 0);
  });

  it("when the durable append fails, then the mutation is NOT committed and no signal fires", async () => {
    const bus = new SignalBus();
    const fired: Signal[] = [];
    bus.on(LEVER_TOGGLED, (s) => fired.push(s));
    const failingSink = {
      async append() {
        throw new Error("db down");
      },
    };
    const lever: Lever = { id: "lv1", on: false };
    const pipeline = new ActionPipeline([leverAction], failingSink, bus);
    await assert.rejects(() =>
      pipeline.dispatch({ type: INTERACT, targetId: "lv1" }, actor, fakeWorld({ lv1: lever }), AT),
    );
    assert.equal(lever.on, false); // execute computed the flip, but commit never ran (persist-before-commit)
    assert.equal(fired.length, 0); // no signal on a failed append
  });
});
