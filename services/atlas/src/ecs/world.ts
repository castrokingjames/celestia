// ecs/world.ts — the entity + component store for one zone room. SYNCED components live on the Colyseus
// ZoneState (the engine syncs them to clients — docs/PLATFORM.md §2); SERVER-ONLY components are plain maps
// that never leave the server. The World owns entity lifecycle so the Room class does not. Systems operate
// on this store each tick (see ./systems).
import type { InputCommand } from "@celestia/norma";
import type { ZoneMap } from "@celestia/firmament";
import type { ZoneState, Player, MobState } from "../schema/ZoneState.js";
import type { EntityId } from "./types.js";

/** Server-only component: which character/zone a player entity writes back to (the write-behind save ref). */
export interface PlacementRef {
  readonly characterId: string;
  readonly zoneId: string;
}

/** Server-only component: a mob's AI/combat bookkeeping — NEVER synced (clients see only MobState). Stats
 *  (damage/ranges/speed) are looked up from the kind table by `kind`; this holds only the per-instance state the
 *  brain + combat mutate. `home` anchors wander/respawn; `targetId` is the current aggro target (a player session
 *  id, or null); `lastDecisionAt`/`attackReadyAt` throttle re-decisions and attacks; `deadUntil` > 0 means the
 *  mob is dead and awaiting respawn at that sim time. All times are sim-clock ms (ZoneState.t), never wall-clock. */
export interface MobAgent {
  readonly kind: string;
  readonly homeX: number; // spawn anchor (respawn scatter centre + "far from home" reference)
  readonly homeY: number;
  readonly scatter: number; // respawn scatter radius (world units) from this spawn's zone config; carried to replacements
  roamX: number; // current wander target (a loiter point); re-picked when a decision resolves to "wander"
  roamY: number;
  path?: { x: number; y: number }[]; // A* waypoints to the current goal (recomputed each decision); followed by act()
  targetId: string | null;
  lastDecisionAt: number;
  attackReadyAt: number;
  deadUntil: number; // sim time to spawn the REPLACEMENT mob (0 once spawned); set on death
  corpseUntil: number; // sim time to flush this corpse (a beat after deadUntil → overlap, no teleport); 0 = alive
}

export class World {
  /** The entity registry. */
  readonly entities = new Set<EntityId>();
  /** Server-only component: input commands queued since the last tick, drained by MovementSystem. */
  readonly inputs = new Map<EntityId, InputCommand[]>();
  /** Server-only component: the placement save ref for a player entity. */
  readonly placement = new Map<EntityId, PlacementRef>();
  /** Server-only component: per-mob AI/combat bookkeeping, keyed by the mob's entity id. */
  readonly mobAgents = new Map<EntityId, MobAgent>();

  /** `state` is the SYNCED component store — positions/names ride it to clients as binary deltas. `zoneMap` is
   *  this zone's collision map (from Caelum); systems read it for server-authoritative collision. Optional so
   *  pure movement unit tests can construct a World without a map. */
  constructor(
    readonly state: ZoneState,
    readonly zoneMap?: ZoneMap,
  ) {}

  /** Spawn a player entity: register it, add its synced transform, init its server-only components. */
  spawnPlayer(id: EntityId, player: Player, placement?: PlacementRef): void {
    this.entities.add(id);
    this.state.players.set(id, player);
    this.inputs.set(id, []);
    if (placement) this.placement.set(id, placement);
  }

  /** Spawn a mob entity: register it, add its synced MobState, and attach its server-only AI/combat agent. */
  spawnMob(id: EntityId, mob: MobState, agent: MobAgent): void {
    this.entities.add(id);
    this.state.mobs.set(id, mob);
    this.mobAgents.set(id, agent);
  }

  /** Remove an entity from every component store (player or mob). */
  despawn(id: EntityId): void {
    this.entities.delete(id);
    this.state.players.delete(id);
    this.inputs.delete(id);
    this.placement.delete(id);
    this.state.mobs.delete(id);
    this.mobAgents.delete(id);
  }
}
