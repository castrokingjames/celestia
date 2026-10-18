// fornax/durable-event-sink.ts — the EventSink adapter that persists to log.event via the one Repository
// (G7: Fornax depends on the EventSink port; only the composition root names THIS class). Appends are
// SERIALIZED through a promise queue so seq/prev_hash chain strictly in order even if dispatches interleave;
// the chain head is cached + lazily loaded (so a process restart continues the stream, not restarts it).
// PK(stream,seq) in the DB is the fail-loud backstop if a second writer ever races the same stream.
import type { EventSink } from "./event-sink.js";
import type { GameEvent } from "./types.js";
import type { EventRow, Repository } from "@celestia/firmament";
import { nextRow } from "./event-chain.js";

type EventStore = Pick<Repository, "appendEvent" | "getEventChainHead">;

export class DurableEventSink implements EventSink {
  #head: { seq: number; hash: string } | null | undefined; // undefined = not yet loaded
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: EventStore,
    private readonly stream: string,
  ) {}

  append(event: GameEvent): Promise<void> {
    const result = this.#queue.then(() => this.#appendOne(event));
    // Keep the queue alive regardless of this append's outcome, so one failure doesn't poison every future
    // append; the caller still observes this append's rejection via `result`.
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #appendOne(event: GameEvent): Promise<void> {
    try {
      if (this.#head === undefined) this.#head = await this.repo.getEventChainHead(this.stream);
      const row: EventRow = nextRow(this.#head, this.stream, event);
      await this.repo.appendEvent(row);
      this.#head = { seq: row.seq, hash: row.hash };
    } catch (err) {
      this.#head = undefined; // force a head reload next time; never chain off a maybe-stale head
      throw err;
    }
  }
}
