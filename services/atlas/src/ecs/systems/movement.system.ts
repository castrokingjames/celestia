// ecs/systems/movement.system.ts — authoritative movement, lifted out of ZoneRoom.update() (docs/
// REALTIME.md §3). Drains each entity's queued input commands and integrates its synced transform. Behavior
// is identical to the former in-room loop: the server CLAMPS client dt (never trusted — G1), normalizes the
// direction (no diagonal speed boost), and advances at the SHARED MOVE_SPEED so client prediction reconciles.
import { MOVE_SPEED, INPUT_DT_MAX, isWalkable } from "@celestia/norma";
import type { System, TickContext } from "../types.js";
import type { World } from "../world.js";

export class MovementSystem implements System {
  readonly name = "movement";

  update(world: World, _ctx: TickContext): void {
    world.state.players.forEach((p, id) => {
      const q = world.inputs.get(id);
      if (!q || q.length === 0) return;
      for (const cmd of q) {
        const dt = Math.max(0, Math.min(INPUT_DT_MAX, cmd.dt ?? 0)); // clamp — the server never trusts client dt
        const len = Math.hypot(cmd.dx ?? 0, cmd.dy ?? 0);
        if (len > 0) {
          const nx = p.x + ((cmd.dx ?? 0) / len) * MOVE_SPEED * dt;
          const ny = p.y + ((cmd.dy ?? 0) / len) * MOVE_SPEED * dt;
          // Server-authoritative collision: reject the step if the target tile is a box or out of bounds
          // (point-vs-tile; no sliding/AABB yet — docs/REFACTOR.md S2). No map (unit tests) = no collision.
          if (!world.zoneMap || isWalkable(world.zoneMap, nx, ny)) {
            p.x = nx;
            p.y = ny;
          }
        }
        p.lastSeq = cmd.seq ?? p.lastSeq;
      }
      q.length = 0; // drained
    });
  }
}
