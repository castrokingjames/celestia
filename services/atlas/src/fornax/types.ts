// fornax/types.ts — the vocabulary of FORNAX, the in-game action pipeline (docs/PIPELINE.md, docs/REFACTOR.md
// S3). An untrusted INTENT comes in; Fornax runs enumerate → allow → qualify → execute → event → signal,
// DENY-BY-DEFAULT, short-circuiting on the first failure (G6). Genre-neutral engine mechanism (G3): the pipeline
// knows no concrete actions — WHAT actions exist is content (the ActionDef registry; e.g. actions/lever.ts).
// The three primitives (docs/PIPELINE.md): Intent (untrusted request in) · Event (durable truth / review log) ·
// Signal (live in-memory reactive glue). The stages map to modules: allow/qualify = Astraea (gates);
// execute → event → signal = Orrery (write side).

/** Who is acting — resolved server-side from the seat authData (the badge), NEVER a client claim (G1/G11). */
export type Actor = { accountId: string; characterId: string; role: string };

/** An untrusted action request from the client: an action type + typed arg ids ONLY — never amounts/state (G1).
 *  The server resolves the real resource from authoritative state in `enumerate`. */
export type Intent = { type: string; targetId?: string };

/** A durable fact an action produced — appended to the EventSink (the review log; event-sourcing seam, G4/G7). */
export type GameEvent = { type: string; at: number; actor: Actor; data: Record<string, unknown> };

/** A live, in-memory reactive notification — NOT persisted; distinct from the event log (docs/PIPELINE.md). */
export type Signal = { type: string; data: Record<string, unknown> };

/** The pipeline stages — reported on a denial so the caller/log knows where it stopped. */
export type Stage = "enumerate" | "allow" | "qualify" | "execute";

/** The outcome of dispatching one intent: executed (events appended + signals fired) or denied at a stage. */
export type ActionOutcome =
  | { ok: true; events: GameEvent[]; signals: Signal[] }
  | { ok: false; stage: Stage; reason: string };

/** A resolved action: `enumerate` has already bound the concrete resource, so the gates + execute need only the
 *  actor. The resource type stays INSIDE the closure, keeping the pipeline + registry genre-neutral (no `any`). */
export interface ResolvedAction {
  /** Access gate (Astraea): may this actor's role perform this action on this resource? Deny-by-default. */
  allow(actor: Actor): boolean;
  /** State gate (Astraea): is it legal given current game state? (range, cooldown, not-already-done…) */
  qualify(actor: Actor): boolean;
  /** Execute (Orrery): COMPUTE the events this action records + a `commit` thunk that applies the state
   *  mutation — but do NOT mutate yet. The pipeline persists the events FIRST, then calls `commit()`, so a
   *  failed durable append never leaves authoritative/synced state ahead of the log (G4 completeness). An empty
   *  `events` array ⇒ nothing to persist, and `commit` still runs. Runs only after both gates pass. */
  execute(actor: Actor, at: number): { events: GameEvent[]; commit: () => void };
}

/** One registered action. `enumerate` resolves the target from AUTHORITATIVE state (never the client envelope,
 *  G6); `undefined` ⇒ no such resource. `W` is the per-dispatch world/context the pipeline operates over. */
export interface ActionDef<W> {
  readonly type: string;
  enumerate(intent: Intent, actor: Actor, world: W): ResolvedAction | undefined;
}
