// jupiter/ganymede/predictor.ts — client-side prediction + server reconciliation for the LOCAL player. Pure
// (no transport, no renderer). Predicts each input immediately (instant feel), keeps un-acked commands, and on
// an authoritative snapshot snaps to it then replays the still-un-acked tail. `applyCmd` is the SHARED
// integrator — identical math to the server's MovementSystem, so prediction and the server agree.
import { MOVE_SPEED, type InputCommand } from "@celestia/norma";

export function applyCmd(pos: { x: number; y: number }, c: InputCommand): void {
  const len = Math.hypot(c.dx, c.dy);
  if (len > 0) {
    pos.x += (c.dx / len) * MOVE_SPEED * c.dt;
    pos.y += (c.dy / len) * MOVE_SPEED * c.dt;
  }
}

export class Predictor {
  #pos = { x: 0, y: 0 };
  #seq = 0;
  #pending: InputCommand[] = [];

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
    applyCmd(this.#pos, cmd);
    this.#pending.push(cmd);
    return cmd;
  }

  /** Authoritative correction: snap to the server position, drop acked commands, replay the un-acked tail. */
  reconcile(serverX: number, serverY: number, lastSeq: number): void {
    this.#pos = { x: serverX, y: serverY };
    this.#pending = this.#pending.filter((c) => c.seq > lastSeq);
    for (const c of this.#pending) applyCmd(this.#pos, c);
  }
}
