// ecs/types.ts — the minimal server-side ECS vocabulary (docs/PLATFORM.md §2: entities + components +
// systems are ENGINE mechanisms; which components an entity carries and what a system does is MODULE logic
// — for P1 both still live here in Atlas, behind this seam, until a game-module package exists). "Super
// basic" on purpose: an entity is an id, components are stores keyed by that id (synced ones ride the
// Colyseus schema, server-only ones are plain maps), and a System is a unit of per-tick logic run in a
// fixed order. Lifting logic into Systems is what keeps it out of the Room class.
import type { World } from "./world.js";

export type EntityId = string;

/** Per-tick context handed to every System. Fixed-timestep (docs/REALTIME.md §2): `dtMs` is the tick, not
 *  wall-clock, and `tMs` is the authoritative server clock — no `Date.now()` inside systems (G9). */
export interface TickContext {
  readonly dtMs: number; // the fixed step (1000 / tickHz)
  readonly tMs: number; // the authoritative server clock (ZoneState.t)
}

/** A unit of per-tick logic. Systems run in a fixed order; each reads/writes components on the World. */
export interface System {
  readonly name: string;
  update(world: World, ctx: TickContext): void;
}
