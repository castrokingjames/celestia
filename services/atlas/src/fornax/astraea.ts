// fornax/astraea.ts — ASTRAEA, the in-game authz gates (docs/NAMING.md; docs/REFACTOR.md S3). Reusable gate
// predicates that an ActionDef composes in its `allow`/`qualify`: `allow` is the ACCESS gate (badge role —
// deny-by-default, G6/G11; identity read from the server-assigned Actor, never a client claim), `qualify` is
// the STATE gate (current game state). Minimal now (role membership + a baseline pass); this grows into typed-
// requirement dispatch (checker-per-type → AND) as more actions arrive. Note the role check reads `actor.role`,
// which comes from the verified badge — the client can neither set nor forge it (G11).
import type { Actor } from "./types.js";

export const Astraea = {
  /** Access gate: any authenticated actor passes (baseline — the lowest bar an action can set). */
  anyone(): boolean {
    return true;
  },

  /** Access gate: the actor's server-assigned role is one of the permitted roles (exact membership for now). */
  roleIn(actor: Actor, roles: readonly string[]): boolean {
    return roles.includes(actor.role);
  },
} as const;
