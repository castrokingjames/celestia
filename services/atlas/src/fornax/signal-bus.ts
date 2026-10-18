// fornax/signal-bus.ts — the SIGNAL BUS (Orrery's live reactive glue): in-memory emit/on. After an action's
// events are appended, Fornax emits a signal per event so in-process listeners can react (update derived state,
// trigger follow-on behavior). Signals are NOT persisted and are distinct from the durable event log — "anything
// can trigger; something listens and dispatches" (docs/PIPELINE.md). Cross-process fan-out is a later seam.
import type { Signal } from "./types.js";

export type SignalHandler = (signal: Signal) => void;

export class SignalBus {
  readonly #handlers = new Map<string, Set<SignalHandler>>();

  /** Subscribe to a signal type; returns an unsubscribe fn. */
  on(type: string, handler: SignalHandler): () => void {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /** Fire a signal to every subscriber of its type (synchronous; no-op if none). */
  emit(signal: Signal): void {
    const set = this.#handlers.get(signal.type);
    if (!set) return;
    for (const handler of set) handler(signal);
  }
}
