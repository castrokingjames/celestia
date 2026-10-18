// fornax/event-sink.ts — the EventSink PORT (G7): where executed actions append their durable events (the
// review log / event-sourced truth, G4). Fornax depends on this interface, never a concrete store. The in-memory
// adapter is the NOW implementation (POC + unit tests); the durable `log.event` adapter (seq + prev_hash, replay)
// drops in later behind the SAME port with no call-site change (docs/REFACTOR.md S3 move 4).
import type { GameEvent } from "./types.js";

export interface EventSink {
  append(event: GameEvent): Promise<void>;
}

/** In-memory sink: keeps every appended event in order. Enough to prove the loop + assert in tests. */
export class InMemoryEventSink implements EventSink {
  readonly events: GameEvent[] = [];

  async append(event: GameEvent): Promise<void> {
    this.events.push(event);
  }
}
