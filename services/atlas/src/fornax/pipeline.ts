// fornax/pipeline.ts — FORNAX, the action pipeline orchestrator (docs/REFACTOR.md S3). Given an untrusted intent
// it runs the stages in order — enumerate → allow → qualify → execute → event → signal — DENY-BY-DEFAULT and
// SHORT-CIRCUITING on the first failure (an unknown action, an unresolved resource, or a failed gate produces no
// write, no event, and no signal). The pipeline is genre-neutral: it holds a registry of ActionDefs (content)
// keyed by type and knows nothing about any specific action. The stages thread two modules — the gates
// (allow/qualify) are Astraea; execute → event → signal is Orrery (the EventSink + SignalBus seams).
import type { ActionDef, ActionOutcome, Actor, Intent } from "./types.js";
import type { EventSink } from "./event-sink.js";
import type { SignalBus } from "./signal-bus.js";

export class ActionPipeline<W> {
  readonly #actions = new Map<string, ActionDef<W>>();

  constructor(
    actions: Iterable<ActionDef<W>>,
    private readonly sink: EventSink,
    private readonly bus: SignalBus,
  ) {
    for (const action of actions) this.#actions.set(action.type, action);
  }

  /** Run one intent through the pipeline against `world` at server-clock `at` (ms; the authoritative tick — no
   *  wall-clock, G9). Returns the executed events + fired signals, or the stage + reason it was denied at. */
  async dispatch(intent: Intent, actor: Actor, world: W, at: number): Promise<ActionOutcome> {
    // enumerate — resolve the action + its target from authoritative state (never the client envelope, G6).
    const action = this.#actions.get(intent.type);
    if (!action) return { ok: false, stage: "enumerate", reason: "unknown_action" };
    const resolved = action.enumerate(intent, actor, world);
    if (!resolved) return { ok: false, stage: "enumerate", reason: "unknown_resource" };

    // allow — the access gate (Astraea): may this role do this at all? (deny-by-default)
    if (!resolved.allow(actor)) return { ok: false, stage: "allow", reason: "forbidden" };

    // qualify — the state gate (Astraea): is it legal given current game state?
    if (!resolved.qualify(actor)) return { ok: false, stage: "qualify", reason: "not_qualified" };

    // execute → event → signal (Orrery). Order matters for G4 completeness: COMPUTE the events + the state
    // mutation, PERSIST the events first, and only THEN commit the mutation + fire signals. If the durable
    // append throws, commit never runs, so the world is never left ahead of the log (and dispatch rejects — the
    // caller must guard it; a crash there would otherwise take down the room).
    const { events, commit } = resolved.execute(actor, at);
    for (const event of events) await this.sink.append(event);
    commit();
    const signals = events.map((event) => ({ type: event.type, data: event.data }));
    for (const signal of signals) this.bus.emit(signal);

    return { ok: true, events, signals };
  }
}
