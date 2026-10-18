// jupiter/ganymede/interpolator.ts — entity interpolation for a REMOTE player. Pure (no transport, no
// renderer). Buffers snapshots stamped on the SERVER clock and samples the position at a render time
// INTERP_DELAY behind, interpolating between the two snapshots that bracket it. On buffer underflow (updates
// stalled past the newest snapshot) it extrapolates the last known velocity for a capped window, then holds —
// so a server-tick hitch glides instead of freezing. Overshoot on a direction change self-corrects once
// snapshots resume.
export type Snap = { t: number; x: number; y: number };
export type Vec2 = { x: number; y: number };

export class RemoteInterpolator {
  readonly #buf: Snap[] = [];

  constructor(
    private readonly maxBuf = 30,
    private readonly extrapMaxMs = 150,
  ) {}

  push(snap: Snap): void {
    this.#buf.push(snap);
    if (this.#buf.length > this.maxBuf) this.#buf.shift();
  }

  get empty(): boolean {
    return this.#buf.length === 0;
  }

  /** Position at renderT (server-clock ms): interpolate between the bracketing snapshots; extrapolate (capped)
   *  on underflow; hold at the oldest until the buffer fills past renderT. */
  sample(renderT: number): Vec2 {
    const buf = this.#buf;
    if (buf.length === 0) return { x: 0, y: 0 };
    if (renderT <= buf[0].t) return { x: buf[0].x, y: buf[0].y };

    const last = buf[buf.length - 1];
    if (renderT >= last.t) {
      const prev = buf.length >= 2 ? buf[buf.length - 2] : undefined;
      if (!prev || last.t <= prev.t) return { x: last.x, y: last.y };
      const ahead = Math.min(renderT - last.t, this.extrapMaxMs);
      return {
        x: last.x + ((last.x - prev.x) / (last.t - prev.t)) * ahead,
        y: last.y + ((last.y - prev.y) / (last.t - prev.t)) * ahead,
      };
    }

    let i = 0;
    while (i < buf.length - 1 && buf[i + 1].t < renderT) i++;
    const a = buf[i];
    const b = buf[i + 1];
    const f = (renderT - a.t) / (b.t - a.t || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  /** Drop snapshots fully behind renderT, keeping one before it (bounded memory). */
  prune(renderT: number): void {
    while (this.#buf.length > 2 && this.#buf[1].t < renderT) this.#buf.shift();
  }
}
