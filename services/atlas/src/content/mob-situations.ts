// content/mob-situations.ts — GAME CONTENT for the "mob.tactic" decision: (1) PERCEPTION — how a mob's world is
// encoded into a plain-language situation, and (2) the SEEDED precedents over those situations (the "basic stuff"
// we seed the vector store with — DECISIONS §2 tier-1). The encoder and the seeds share ONE vocabulary (the
// clause helpers) so a live situation matches an authored one exactly; Mica/Opus grow the seed set later.
//
// IMPORTANT: `describeSituation` only DESCRIBES the world — it does not pick an action. The action for each
// situation is AUTHORED DATA in MOB_TACTIC_SEED below (retrieved by similarity, never computed by a formula or a
// branch). Even "nothing's happening" is a decision: no enemy + near spawn → WANDER, no enemy + strayed far →
// RETURN. Those are seeded too — NOT hardcoded. To change behaviour, edit/extend the seed rows.
import type { Precedent } from "../pallas/index.js";

export interface Perception {
  enemyPresent: boolean; // is a player inside my aggro range?
  levelGap: number; // playerLevel − mobLevel (+ = the player out-levels the mob)   — only meaningful with an enemy
  playerHpFrac: number; // 0..1                                                      — only meaningful with an enemy
  allyCount: number; // mobs near me                                                 — only meaningful with an enemy
  homeFar: boolean; // am I far from where I spawned?                                — only meaningful with no enemy
}

// Perception thresholds — translate numbers into the words the seeds use (description, NOT decision).
const STRONGER_GAP = 4; // player out-levels me by ≥ this → "far above my level"
const EVEN_GAP = 2; // |gap| within this → "roughly my own level"
const LOW_HP_FRAC = 0.3; // player at/below this → "low on health and almost dead"
const SWARM_ALLIES = 2; // this many allies near me → "swarming"

const strengthClause = (gap: number): string =>
  gap >= STRONGER_GAP
    ? "the enemy is far above my level"
    : Math.abs(gap) <= EVEN_GAP
      ? "the enemy is roughly my own level"
      : "the enemy is weaker than me";

const healthClause = (hpFrac: number): string =>
  hpFrac <= LOW_HP_FRAC ? "the enemy is low on health and almost dead" : "the enemy is at full health";

const companyClause = (allies: number): string =>
  allies >= SWARM_ALLIES ? "many of my allies are swarming the enemy" : "I am alone with no allies nearby";

const homeClause = (far: boolean): string => (far ? "I have strayed far from where I spawned" : "I am near where I spawned");

/** Encode a perceived situation into the sentence the seeds are authored in. Description only (no decision).
 *  Two worlds: an enemy is here (strength/health/company matter) or nobody's around (distance from spawn matters). */
export function describeSituation(p: Perception): string {
  return p.enemyPresent
    ? `an enemy is here, ${strengthClause(p.levelGap)}, ${healthClause(p.playerHpFrac)}, ${companyClause(p.allyCount)}`
    : `no enemy is near, ${homeClause(p.homeFar)}`;
}

// The SEED DATA: one authored precedent per canonical situation. The `situation` is composed through the SAME
// encoder (so it matches perception verbatim); the `action` is authored — the basic policy as examples, not a
// computed score. Grow this with Mica/Opus later.
const flee = "flee";
const attack = "attack";
const wander = "wander"; // roam near my spawn
const returnHome = "return"; // walk back toward my spawn
const sit = describeSituation;
const enemy = (levelGap: number, playerHpFrac: number, allyCount: number): string =>
  sit({ enemyPresent: true, levelGap, playerHpFrac, allyCount, homeFar: false });
const idle = (homeFar: boolean): string => sit({ enemyPresent: false, levelGap: 0, playerHpFrac: 1, allyCount: 0, homeFar });

export const MOB_TACTIC_SEED: Precedent[] = [
  // Nobody around: loiter near my spawn, or walk back if I've strayed far (e.g. after a chase). SEEDED, not a branch.
  { situation: idle(false), action: wander },
  { situation: idle(true), action: returnHome },
  // An enemy is here: flee only when truly outmatched with no edge; otherwise a wounded / even / under-matched
  // target, or safety in numbers, means attack.
  { situation: enemy(8, 1, 0), action: flee }, // overmatched, healthy, alone → run
  { situation: enemy(8, 1, 3), action: attack }, // overmatched but swarming → pile on
  { situation: enemy(8, 0.1, 0), action: attack }, // wounded prey → attack even if it out-levels me
  { situation: enemy(8, 0.1, 3), action: attack },
  { situation: enemy(0, 1, 0), action: attack }, // even fight → engage
  { situation: enemy(0, 1, 3), action: attack },
  { situation: enemy(0, 0.1, 0), action: attack },
  { situation: enemy(0, 0.1, 3), action: attack },
  { situation: enemy(-8, 1, 0), action: attack }, // I'm stronger → attack
  { situation: enemy(-8, 1, 3), action: attack },
  { situation: enemy(-8, 0.1, 0), action: attack },
  { situation: enemy(-8, 0.1, 3), action: attack },
];
