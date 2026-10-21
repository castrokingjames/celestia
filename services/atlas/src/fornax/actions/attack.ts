// fornax/actions/attack.ts — the combat action, modeled on lever.ts. Strike a target (a mob OR a player):
// enumerate (resolve the target) → allow (baseline access) → qualify (alive + in reach) → execute (the SERVER
// computes the damage and emits entity_damaged, plus entity_killed if it drops to 0; persist-before-commit).
// Bidirectional and symmetric: a player's client sends `attack`, and a mob's brain (Pallas) re-uses this SAME
// action with the mob as the actor — re-validated here, never trusting the proposer (G2). The client never sends
// an amount; the server owns every number (G1).
import { Astraea } from "../astraea.js";
import type { ActionDef, GameEvent } from "../types.js";

export const ATTACK = "attack"; // mirrors norma INTENT_TYPES

export const ENTITY_DAMAGED = "entity_damaged"; // durable event: a target took damage (carries the new hp)
export const ENTITY_KILLED = "entity_killed"; // durable event: a target dropped to 0 (room handles death/respawn)

/** The minimal shape of an attack target the pipeline needs. A mob (MobState) and a player (Player) both satisfy
 *  it structurally (x/y/hp/maxHp), so the action never imports the Colyseus schema — the room adapts both. */
export interface Combatant {
  x: number;
  y: number;
  hp: number;
  readonly maxHp: number;
}

/** The per-dispatch combat view the room builds: resolve the named target, test the attacker's reach, and the
 *  damage the attacker deals — all COMPUTED server-side (the attacker's stats), never taken from the client. */
export interface ZoneCombat {
  target(id: string): Combatant | undefined;
  inReach(target: Combatant): boolean;
  readonly damage: number;
}

export const attackAction: ActionDef<ZoneCombat> = {
  type: ATTACK,
  enumerate(intent, _actor, world) {
    const targetId = intent.targetId ?? "";
    const target = world.target(targetId);
    if (!target) return undefined; // unknown/absent target → denied at enumerate
    return {
      allow: () => Astraea.anyone(), // baseline access gate (role gating per-faction comes later, G6)
      qualify: () => target.hp > 0 && world.inReach(target), // the target must be alive AND within reach
      execute: (actor, at) => {
        const damage = world.damage;
        const hp = Math.max(0, target.hp - damage); // compute the outcome; apply it only in commit (after append)
        const events: GameEvent[] = [
          { type: ENTITY_DAMAGED, at, actor, data: { targetId, damage, hp, maxHp: target.maxHp } },
        ];
        if (hp === 0) events.push({ type: ENTITY_KILLED, at, actor, data: { targetId } });
        return {
          events,
          commit: () => {
            target.hp = hp;
          },
        };
      },
    };
  },
};
