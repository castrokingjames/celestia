// ecs/systems/mob-ai.system.ts — the mob brain. Each decision interval it PERCEIVES the world (nearest player,
// level gap, their health, nearby allies) and encodes it into a plain-language SITUATION, asks PALLAS to match
// that situation to a seeded precedent (DECISIONS §2 tier-1), and ACTS on the returned label (flee/attack/wander).
//
// WHERE THE DECISION LIVES: not here. This system only (a) perceives → a sentence and (b) carries out whatever
// Pallas returns. The choice of action comes from the nearest SEEDED precedent (pallas/seed-mob-tactic.ts), never
// from a branch in this file. To change behaviour, edit the seed data — not this code. The perception thresholds
// below translate numbers into the words the seeds use; they describe the world, they do not pick the action.
//
// An attack is NEVER applied here — it is dispatched back through the Fornax combat pipeline (the `attack`
// callback) so the deterministic TCB re-validates and owns the write (G2). Decisions run OFF the hot path
// (fire-and-forget on the mob's own cadence); the mob keeps acting on its last decision until a new one resolves.
import { isBodyWalkable } from "@celestia/norma";
import { findPath, type Vec2 } from "../pathfind.js";
import type { System, TickContext } from "../types.js";
import type { World, MobAgent } from "../world.js";
import type { MobState, Player } from "../../schema/ZoneState.js";
import type { MobKind } from "@celestia/firmament";
import { PLAYER_LEVEL } from "../../content/player.js";
import { describeSituation, type Perception } from "../../content/mob-situations.js";
import type { DecisionFrame, Pallas } from "../../pallas/index.js";

const MOB_TACTIC = "mob.tactic";
const ACTIONS = ["flee", "attack", "wander", "return"]; // MUST match the seed action labels (content/mob-situations.ts)
const HOME_FAR = 128; // world units from the spawn anchor beyond which perception reads "strayed far from home"

export const SPAWN_RADIUS = 96; // world units — mobs respawn at a random walkable point within this of their anchor
const ALLY_RANGE = 128; // world units — another mob this near counts as an "ally" for the perception's ally count
const WANDER_SPEED_FRAC = 0.5; // wander ambles at half move speed
const ARRIVE_EPS = 1; // world units — treat as "arrived" (stop) below this distance
const WAYPOINT_EPS = 10; // world units — advance to the next A* waypoint once this close to the current one
const DECISION_DEADLINE_MS = 50; // abstain budget on the frame (unused by tier-1; set for the model path later)

/** The room wires this to dispatch a mob's attack through the Fornax combat pipeline (re-validated there, G2). */
export type MobAttackFn = (mobId: string, targetId: string) => void;
/** The room wires this to spawn a BRAND-NEW mob entity (unique id) near an anchor — used for respawns (G2: the
 *  room owns entity lifecycle). Respawning is NOT reviving the corpse; it's a fresh entity. `scatter` is the
 *  spawn's zone-configured respawn radius, carried over so the replacement scatters the same way. */
export type MobSpawnFn = (kind: string, homeX: number, homeY: number, scatter: number) => void;
/** Look up a monster kind's definition (sprite + stats). Injected so the system reads the Caelum-loaded roster
 *  (content/mobs.json) rather than importing hardcoded content — stats are config, not code. */
export type MobKindFn = (kind: string) => MobKind | undefined;

export class MobAISystem implements System {
  readonly name = "mob-ai";

  constructor(
    private readonly pallas: Pallas,
    private readonly mobKind: MobKindFn,
    private readonly attack: MobAttackFn,
    private readonly spawn: MobSpawnFn = () => {}, // the room wires the real spawner; default no-op keeps tests terse
  ) {}

  update(world: World, ctx: TickContext): void {
    // Lifecycle changes are COLLECTED here and applied after the walk — mutating state.mobs (despawn/spawn) mid
    // forEach is unsafe. A killed mob stays as a corpse; at deadUntil a fresh UNIQUE mob is spawned near its
    // anchor; at corpseUntil (a beat later) the corpse is flushed — so a new one appears before the body clears.
    const toRespawn: { kind: string; homeX: number; homeY: number; scatter: number }[] = [];
    const toDespawn: string[] = [];
    world.state.mobs.forEach((mob, id) => {
      const agent = world.mobAgents.get(id);
      const kind = this.mobKind(mob.kind);
      if (!agent || !kind) return;

      if (mob.hp <= 0) {
        // Corpse: no AI. Spawn its replacement once (deadUntil), then flush the body shortly after (corpseUntil).
        if (agent.deadUntil > 0 && ctx.tMs >= agent.deadUntil) {
          toRespawn.push({ kind: agent.kind, homeX: agent.homeX, homeY: agent.homeY, scatter: agent.scatter });
          agent.deadUntil = 0;
        }
        if (agent.corpseUntil > 0 && ctx.tMs >= agent.corpseUntil) toDespawn.push(id);
        return;
      }

      // Re-decide on the mob's own cadence (lastDecisionAt === 0 = never decided → decide now). EVERY case goes
      // through Pallas — including "no enemy around": that's a seeded decision too (wander vs return), not a branch.
      if (agent.lastDecisionAt === 0 || ctx.tMs - agent.lastDecisionAt >= kind.decisionIntervalMs) {
        agent.lastDecisionAt = ctx.tMs;
        const target = this.nearestPlayer(world, mob, kind.aggroRange);
        agent.targetId = target?.id ?? null;
        this.decide(mob, agent, kind, target?.player, world, ctx.tMs);
      }

      // Act on the current decision every tick (the label set by the last resolved decision).
      this.act(world, mob, agent, kind, ctx);
    });

    for (const id of toDespawn) world.despawn(id); // flush spent corpses (each mob is single-use — never revived)
    for (const r of toRespawn) this.spawn(r.kind, r.homeX, r.homeY, r.scatter); // a brand-new unique entity near the anchor
  }

  // PERCEIVE the world (enemy present → strength/health/company; nobody → distance from spawn) into the situation
  // sentence the seeds are authored in. Description only — no action chosen here.
  private perceive(mob: MobState, agent: MobAgent, kind: MobKind, player: Player | undefined, world: World): Perception {
    const homeFar = Math.hypot(mob.x - agent.homeX, mob.y - agent.homeY) > HOME_FAR;
    if (!player) return { enemyPresent: false, levelGap: 0, playerHpFrac: 1, allyCount: 0, homeFar };
    return {
      enemyPresent: true,
      levelGap: PLAYER_LEVEL - kind.level,
      playerHpFrac: player.hp / Math.max(1, player.maxHp),
      allyCount: this.allyCount(world, mob),
      homeFar,
    };
  }

  // Ask Pallas to match the perceived situation to a seeded precedent, store the chosen label. Fire-and-forget:
  // tier-1 retrieval resolves on the next microtask (in-memory); a miss/abstain → wander floor. When the answer
  // is "wander", pick a fresh loiter target so it actually roams (distinct from "return", which heads home).
  private decide(mob: MobState, agent: MobAgent, kind: MobKind, player: Player | undefined, world: World, at: number): void {
    const frame: DecisionFrame = {
      cid: `${mob.id}@${at}`,
      schema: MOB_TACTIC,
      question: describeSituation(this.perceive(mob, agent, kind, player, world)),
      context: {}, // the sentence carries the perception for the tier-1 embedder; a richer bag feeds the model later
      allowedAnswers: ACTIONS,
      memories: [],
      at,
      deadlineMs: DECISION_DEADLINE_MS,
    };
    this.pallas
      .decideFromPrecedent(frame)
      .then((proposal) => {
        const accepted = proposal ? this.pallas.accept(proposal) : null;
        mob.action = !accepted || accepted.abstained || accepted.chosenIndex == null ? "wander" : ACTIONS[accepted.chosenIndex];
        if (mob.action === "wander") this.pickRoam(agent, kind, world, at);
        this.repath(world, mob, agent, kind, player); // plan a route to the new action's goal (A*)
      })
      .catch(() => {
        mob.action = "wander";
      });
  }

  // Plan an A* route for the chosen goal-seeking action (attack → the player; return → home; wander → the roam
  // point). Falls back to a straight beeline when the goal is unreachable / there's no map (then act() + slide
  // handle it). flee has no goal to route to, so it clears the path and steps directly away.
  private repath(world: World, mob: MobState, agent: MobAgent, kind: MobKind, player: Player | undefined): void {
    let goal: Vec2 | undefined;
    if (mob.action === "attack" && player) goal = { x: player.x, y: player.y };
    else if (mob.action === "return") goal = { x: agent.homeX, y: agent.homeY };
    else if (mob.action === "wander") goal = { x: agent.roamX, y: agent.roamY };
    if (!goal) {
      agent.path = undefined;
      return;
    }
    const found = world.zoneMap ? findPath(world.zoneMap, mob, goal, kind.radius) : null;
    agent.path = found ?? [goal]; // unreachable / no map → beeline to the goal (step-and-slide takes over)
  }

  // Follow the planned path: advance past waypoints we've reached, then step toward the current one (the micro
  // step + wall-slide in moveToward handles sub-tile motion + the body radius). Empty path → nothing to do.
  private followPath(world: World, mob: MobState, agent: MobAgent, speed: number, dt: number, radius: number): void {
    const path = agent.path;
    if (!path || path.length === 0) return;
    while (path.length > 1 && Math.hypot(path[0].x - mob.x, path[0].y - mob.y) < WAYPOINT_EPS) path.shift();
    this.moveToward(world, mob, path[0].x, path[0].y, speed, dt, radius);
  }

  // Pick a random walkable loiter point within SPAWN_RADIUS of the spawn anchor (seeded → deterministic). This is
  // what "wander" heads toward — so wandering roams the spawn area, which is NOT the same as "return" (go home).
  private pickRoam(agent: MobAgent, kind: MobKind, world: World, at: number): void {
    const map = world.zoneMap;
    const rand = mulberry32((hashStr(agent.kind) ^ Math.floor(at) ^ Math.imul(agent.homeY | 0, 0x85ebca6b)) >>> 0);
    for (let i = 0; i < 8; i++) {
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * SPAWN_RADIUS;
      const x = agent.homeX + Math.cos(ang) * r;
      const y = agent.homeY + Math.sin(ang) * r;
      if (!map || isBodyWalkable(map, x, y, kind.radius)) {
        agent.roamX = x;
        agent.roamY = y;
        return;
      }
    }
    agent.roamX = agent.homeX; // boxed in → loiter at the anchor
    agent.roamY = agent.homeY;
  }

  // ACT on the stored label. Attack dispatches through Fornax (never applied here); flee/wander move the mob.
  private act(world: World, mob: MobState, agent: MobAgent, kind: MobKind, ctx: TickContext): void {
    const target = agent.targetId ? world.state.players.get(agent.targetId) : undefined;
    const dt = ctx.dtMs / 1000;
    if (mob.action === "attack" && target && target.hp > 0) {
      const dist = Math.hypot(target.x - mob.x, target.y - mob.y);
      if (dist <= kind.attackRange) {
        if (ctx.tMs >= agent.attackReadyAt) {
          agent.attackReadyAt = ctx.tMs + kind.attackCooldownMs;
          this.attack(mob.id, agent.targetId!); // re-validated + applied by the Fornax combat pipeline (G2)
        }
      } else {
        this.followPath(world, mob, agent, kind.moveSpeed, dt, kind.radius); // close the distance along the A* route
      }
    } else if (mob.action === "flee" && target) {
      // away = step in the opposite direction from the target (mirror the target through the mob). No pathing —
      // fleeing has no goal tile, it just wants distance; step-and-slide is right here.
      this.moveToward(world, mob, 2 * mob.x - target.x, 2 * mob.y - target.y, kind.moveSpeed, dt, kind.radius);
    } else if (mob.action === "return") {
      this.followPath(world, mob, agent, kind.moveSpeed, dt, kind.radius); // route back to spawn (around obstacles)
    } else if (mob.action === "wander") {
      this.followPath(world, mob, agent, kind.moveSpeed * WANDER_SPEED_FRAC, dt, kind.radius); // loiter via the route
    }
  }

  private moveToward(world: World, mob: MobState, tx: number, ty: number, speed: number, dt: number, r: number): void {
    const dx = tx - mob.x;
    const dy = ty - mob.y;
    const len = Math.hypot(dx, dy);
    if (len < ARRIVE_EPS) return;
    const stepX = (dx / len) * speed * dt;
    const stepY = (dy / len) * speed * dt;
    const map = world.zoneMap;
    // Radius-aware collision (isBodyWalkable = the whole r-half-extent body, not just the center) with a SLIDE
    // fallback: if the diagonal step is blocked, try moving on one axis only (hug the wall instead of freezing).
    // Boxed in on both → hold this tick. The body check is why the mob can't lap into a wall or off the map edge.
    if (!map || isBodyWalkable(map, mob.x + stepX, mob.y + stepY, r)) {
      mob.x += stepX;
      mob.y += stepY;
    } else if (isBodyWalkable(map, mob.x + stepX, mob.y, r)) {
      mob.x += stepX; // slide along the wall horizontally
    } else if (isBodyWalkable(map, mob.x, mob.y + stepY, r)) {
      mob.y += stepY; // slide along the wall vertically
    }
  }

  private nearestPlayer(world: World, mob: MobState, range: number): { id: string; player: Player } | undefined {
    let best: { id: string; player: Player } | undefined;
    let bestD = range;
    world.state.players.forEach((p, id) => {
      if (p.hp <= 0) return;
      const d = Math.hypot(p.x - mob.x, p.y - mob.y);
      if (d <= bestD) {
        bestD = d;
        best = { id, player: p };
      }
    });
    return best;
  }

  private allyCount(world: World, mob: MobState): number {
    let n = 0;
    world.state.mobs.forEach((m, id) => {
      if (id === mob.id || m.hp <= 0) return;
      if (Math.hypot(m.x - mob.x, m.y - mob.y) <= ALLY_RANGE) n++;
    });
    return n;
  }

}

// Tiny seeded PRNG (mulberry32) + a string hash for seeding. Deterministic given the seed — used for respawn
// scatter so the sim stays replayable (no Math.random, no wall-clock; the seed is sim time + identity).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
