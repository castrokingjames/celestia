// fornax/actions/lever.ts — the FIRST interaction (docs/REFACTOR.md S3 move 6): toggle a lever. This is CONTENT
// (an ActionDef the pipeline runs), not pipeline machinery — a genre-neutral toggle that proves the whole loop
// end-to-end and will move to a game module later (G3). Stages: enumerate = resolve the lever from authoritative
// state (unknown id ⇒ denied); allow = any authenticated actor (Astraea access gate, minimal); qualify = the
// acting player is within reach of the lever (Astraea state gate); execute = flip the synced `on` bit + emit a
// `lever_toggled` event (which becomes a signal).
import { Astraea } from "../astraea.js";
import type { ActionDef, Actor, GameEvent } from "../types.js";

/** The intent type the client sends to toggle a lever (mirrors norma INTENT_TYPES). */
export const INTERACT = "interact";

/** The durable event a toggle produces (appended to the EventSink; also fired as a signal). */
export const LEVER_TOGGLED = "lever_toggled";

/** A lever's authoritative state. In the zone room this is backed by synced Colyseus state so clients see the
 *  flip; `on` is mutated by `execute`. */
export interface Lever {
  readonly id: string;
  on: boolean;
}

/** The slice of zone state Fornax needs for a lever interaction. Backed in the zone room by synced levers + live
 *  player positions; faked in unit tests. Built per-dispatch, so it already knows which player is acting. */
export interface ZoneInteractions {
  /** The lever with this id, or undefined if none (enumerate rejects on undefined). */
  lever(id: string): Lever | undefined;
  /** Is the ACTING player within reach of this lever? (The adapter resolves the actor's position.) */
  withinReach(leverId: string): boolean;
}

export const leverAction: ActionDef<ZoneInteractions> = {
  type: INTERACT,
  enumerate(intent, _actor, world) {
    const lever = world.lever(intent.targetId ?? "");
    if (!lever) return undefined;
    return {
      allow: () => Astraea.anyone(),
      qualify: () => world.withinReach(lever.id),
      execute: (actor: Actor, at: number): { events: GameEvent[]; commit: () => void } => {
        const on = !lever.on; // compute the new state; apply it only in commit (after the durable append)
        return {
          events: [{ type: LEVER_TOGGLED, at, actor, data: { leverId: lever.id, on } }],
          commit: () => {
            lever.on = on;
          },
        };
      },
    };
  },
};
