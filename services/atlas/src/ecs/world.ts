// ecs/world.ts — the entity + component store for one zone room. SYNCED components live on the Colyseus
// ZoneState (the engine syncs them to clients — docs/PLATFORM.md §2); SERVER-ONLY components are plain maps
// that never leave the server. The World owns entity lifecycle so the Room class does not. Systems operate
// on this store each tick (see ./systems).
import type { InputCommand } from "@celestia/norma";
import type { ZoneMap } from "@celestia/firmament";
import type { ZoneState, Player } from "../schema/ZoneState.js";
import type { EntityId } from "./types.js";

/** Server-only component: which character/zone a player entity writes back to (the write-behind save ref). */
export interface PlacementRef {
  readonly characterId: string;
  readonly zoneId: string;
}

export class World {
  /** The entity registry. */
  readonly entities = new Set<EntityId>();
  /** Server-only component: input commands queued since the last tick, drained by MovementSystem. */
  readonly inputs = new Map<EntityId, InputCommand[]>();
  /** Server-only component: the placement save ref for a player entity. */
  readonly placement = new Map<EntityId, PlacementRef>();

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

  /** Remove an entity from every component store. */
  despawn(id: EntityId): void {
    this.entities.delete(id);
    this.state.players.delete(id);
    this.inputs.delete(id);
    this.placement.delete(id);
  }
}
