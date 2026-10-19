// jupiter/ganymede/predictor.ts — client-side prediction + server reconciliation for the LOCAL player. Pure
// (no transport, no renderer). Predicts each input immediately (instant feel), keeps un-acked commands, and on
// an authoritative snapshot snaps to it then replays the still-un-acked tail. `applyCmd` is the SHARED
// integrator — identical math to the server's MovementSystem, so prediction and the server agree.
import { MOVE_SPEED, type InputCommand } from "@celestia/norma";

export function applyCmd(
  pos: { x: number; y: number },
  c: InputCommand,
  canWalk?: (x: number, y: number) => boolean,
): void {
  const len = Math.hypot(c.dx, c.dy);
  if (len === 0) return;
  const nx = pos.x + (c.dx / len) * MOVE_SPEED * c.dt;
  const ny = pos.y + (c.dy / len) * MOVE_SPEED * c.dt;
  // All-or-nothing step, mirroring the server's MovementSystem (no sliding). The server re-checks regardless.
  if (!canWalk || canWalk(nx, ny)) {
    pos.x = nx;
    pos.y = ny;
  }
}

export class Predictor {
  #pos = { x: 0, y: 0 };
  #seq = 0;
  #pending: InputCommand[] = [];
  #canWalk?: (x: number, y: number) => boolean;

  /** Mirror the server's collision in prediction (set once the map is known). NOT a trust gate — the server
   *  still re-checks every move; this only keeps the prediction from overshooting into a wall. */
  setCanWalk(fn: (x: number, y: number) => boolean): void {
    this.#canWalk = fn;
  }

  get x(): number {
    return this.#pos.x;
  }
  get y(): number {
    return this.#pos.y;
  }

  /** Seed the predicted position (on spawn); clears any un-acked history. */
  spawn(x: number, y: number): void {
    this.#pos = { x, y };
    this.#pending = [];
    this.#seq = 0;
  }

  /** Build the next command for a direction, predict it locally, and queue it for reconciliation. */
  predict(dx: number, dy: number, dt: number): InputCommand {
    const cmd: InputCommand = { seq: ++this.#seq, dx, dy, dt };
    applyCmd(this.#pos, cmd, this.#canWalk);
    this.#pending.push(cmd);
    return cmd;
  }

  /** Authoritative correction: snap to the server position, drop acked commands, replay the un-acked tail. */
  reconcile(serverX: number, serverY: number, lastSeq: number): void {
    this.#pos = { x: serverX, y: serverY };
    this.#pending = this.#pending.filter((c) => c.seq > lastSeq);
    for (const c of this.#pending) applyCmd(this.#pos, c, this.#canWalk);
  }
}
