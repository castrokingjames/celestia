// pallas — the decision layer (COGNITION/DECISIONS). Public surface for the room/consumers. For BASIC behaviour
// the decider is pure RETRIEVAL: seed the vector store with situation→action precedents and the choice comes from
// the nearest seeded precedent (DECISIONS §2 tier-1), no model call and no hand-weighted formulas. The model
// (Mercury=Mica / Calliope=Opus) implements CognitionGateway later — it GENERATES more precedents and covers
// retrieval misses (tier-2/3), on the same ports. Mnemosyne + the precedent store are in-memory now (→ pgvector).
export * from "./types.js"; // Precedent / PrecedentHit / PrecedentStore + the rest of the ports live here
export { Pallas, type PendingProposal } from "./pallas.js";
export { accept } from "./accept.js";
export { InMemoryMnemosyne, HashEmbedder, cosine } from "./mnemosyne.js";
export { InMemoryPrecedents, decideByPrecedent } from "./precedent.js";
export { PgPrecedents } from "./pg-precedents.js"; // real pgvector backing (behind the Repository port, G7)
// NOTE: game content (mob.tactic seed, perception) lives in content/mob-situations.ts, NOT here — pallas is the
// genre-neutral decision MECHANISM; the seed DATA is game-module content that imports these ports.
