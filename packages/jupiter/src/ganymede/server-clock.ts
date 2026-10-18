// jupiter/ganymede/server-clock.ts — a smoothed estimate of the server clock from per-patch (serverT,
// localNow) samples. Pure — no transport, no renderer. Remotes are rendered on THIS timeline (not
// packet-arrival time) so network jitter can't make them hop; a large drift (first sample / reconnect / zone
// change) snaps instead of easing.
export class ServerClock {
  #offset = NaN; // serverT - localNow

  constructor(
    private readonly driftSnapMs = 500,
    private readonly smoothing = 0.05,
  ) {}

  /** Fold in a sample. Snaps on the first sample or a drift beyond driftSnapMs; otherwise EMA-smooths. */
  update(serverT: number, localNow: number): void {
    const target = serverT - localNow;
    this.#offset =
      Number.isNaN(this.#offset) || Math.abs(target - this.#offset) > this.driftSnapMs
        ? target
        : this.#offset + (target - this.#offset) * this.smoothing;
  }

  /** Estimated server time at localNow. NaN until the first sample (callers gate on `ready`). */
  now(localNow: number): number {
    return localNow + this.#offset;
  }

  get ready(): boolean {
    return !Number.isNaN(this.#offset);
  }

  reset(): void {
    this.#offset = NaN;
  }
}
