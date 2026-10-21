// pallas/types.ts — PALLAS, the TCB-side decision layer (Pallas Athena: the mind that weighs options and
// decides). Aligns to COGNITION.md §2. The model lives behind a stateless **Cognition Gateway** (Mercury = Mica
// S1 / Calliope = Opus S2) that holds MODEL creds only — NO pgvector creds, and it NEVER receives a player id.
// The TCB (Pallas, inside the Colyseus room) does the work: enumerate the sim-authored option set, recall
// Mnemosyne (pgvector) memory scoped per-player INSIDE the TCB (§3.5 — no cross-player leak), build the frame,
// dispatch OFF-tick, apply the ACCEPT POLICY (probs-as-gates | rankings — the room's, §2.2), re-validate the
// chosen option through Fornax (G2), execute, and log. The Gateway only PROPOSES a calibrated distribution over
// sim-enumerated option INDICES — no text, no numbers, no new options (§1). The decider never writes state.

/** A memory recalled from Mnemosyne — fetched TCB-side (per-player scoped) and attached to the frame. The
 *  Gateway never queries pgvector itself (§2.1). */
export interface MemoryHit {
  id: string;
  text: string;
  salience: number; // 0..1
  at: number; // sim time (ms) formed
}

/** The frame the TCB sends to the Gateway. `context` is an OPEN bag — add any scenario-distinguishing feature
 *  (actorLevel, targetLevel, actorHpFrac, targetHpFrac, allyCount, threatCount, biome…); more *distinct*
 *  scenarios ⇒ feed the features that separate them (§3). Carries NO player id — co-present players are
 *  disambiguated by an opaque interaction token folded into `cid` (§2.6), never an id the Gateway can see. */
export interface DecisionFrame {
  cid: string; // (room, tick_epoch, subject#interaction_token, schema) — routes the reply back; staleness guard
  schema: string; // decision type, e.g. "mob.tactic" — scopes the criteria set + the cache key (§3)
  question: string; // human/model-readable situation summary
  context: Record<string, number | string | boolean>; // open; the embedding/cache KEY is a curated subset (§3)
  allowedAnswers: string[]; // sim-authored option labels; the Gateway returns an INDEX 0..n-1 (§2.2/§2.5)
  memories: MemoryHit[]; // TCB-prefetched, per-player scoped
  at: number; // sim time (ms)
  deadlineMs: number; // abstain → scripted floor if the proposal isn't back in time (§2.5)
}

/** What the GATEWAY proposes: a calibrated probability per option INDEX + an abstain probability. NO final
 *  choice (the accept policy is the room's — §2.2). `seed`/`calibrationVersion`/`model` are added when the real
 *  Gateway is wired (§2.2) and stamped into log.oracle_call for replay (§2.4). */
export interface GatewayProposal {
  cid: string;
  options: { index: number; p: number }[];
  argmaxIndex: number;
  abstainP: number;
}

/** The Cognition GATEWAY capability (G7): stateless; batches/routes/caches; holds MODEL creds only — NO pgvector
 *  creds, NEVER a caller player id. Game code only ever touches cognition through this handle (§2.1). Heuristic
 *  floor now; Mercury (Mica, llama.cpp) / Calliope (Opus, API) drop in behind it with no call-site change. */
export interface CognitionGateway {
  decide(frame: DecisionFrame): Promise<GatewayProposal>;
}

/** The ACCEPT POLICY — the room's, not the Gateway's (§2.2). Flip gates↔rankings by config: that is the
 *  calibration fallback (a config flip, not a redesign — §4). Turns the Gateway's distribution into a chosen
 *  option index, or an abstain → the consumer drops to the scripted floor. */
export type AcceptMode = "gates" | "rankings";
export interface Accepted {
  chosenIndex: number | null;
  abstained: boolean;
}

/** Text → embedding vector (G7). Hash-mock now; a real embedding model later — same port. (TCB-side.) */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

/** Mnemosyne (NAMING §8): associative memory, per-actor scoped, TCB-side (never the Gateway). pgvector ANN in
 *  prod; in-memory cosine in tests — same port. */
export interface MemoryStore {
  remember(
    actorId: string,
    rec: { text: string; salience: number; at: number; embedding: number[] },
  ): Promise<void>;
  recall(actorId: string, queryEmbedding: number[], k: number): Promise<MemoryHit[]>;
}

/** A seeded precedent (DECISIONS §2 tier-1): "in a situation like this, THIS action was right." It is DATA, not a
 *  formula — authored to start, then grown by the model (Mica/Opus) as it generalises. `situation` is embedded;
 *  `action` must be one of a decision's sim-authored labels (enumerate→index). Shared across all actors of a
 *  schema (NOT per-player — distinct from Mnemosyne's episodic memory). */
export interface Precedent {
  situation: string;
  action: string;
}

/** One retrieved precedent + its cosine similarity to the live situation. */
export interface PrecedentHit {
  action: string;
  score: number; // cosine similarity, 0..1
}

/** The shared precedent store, keyed by decision schema (G7): seed situation→action rows, retrieve the nearest.
 *  pgvector (CREATE EXTENSION vector + HNSW) in prod; in-memory cosine now — same port, zero call-site change. */
export interface PrecedentStore {
  seed(schema: string, rows: { embedding: number[]; action: string }[]): Promise<void>;
  lookup(schema: string, queryEmbedding: number[], k: number): Promise<PrecedentHit[]>;
}
