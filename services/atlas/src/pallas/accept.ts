// pallas/accept.ts — the ACCEPT POLICY (COGNITION §2.2 / DECISIONS §4): it lives in the room/TCB, NOT the
// Gateway. Turns the Gateway's calibrated distribution into a chosen option index — or an abstain, which drops
// the caller to the scripted floor. Flip gates↔rankings by config: THAT is the calibration fallback (a config
// flip, not a redesign). gates = trust the calibrated probability (accept only if argmax clears a bar);
// rankings = trust only the ORDER (top-ranked wins) — the mode you fall back to when calibration (ECE) is weak.
import type { Accepted, AcceptMode, GatewayProposal } from "./types.js";

const ABSTAIN_THRESHOLD = 0.5; // abstainP at/above this → fall back to the scripted floor
const GATE_MIN_P = 0.4; // gates mode only: the argmax must clear this calibrated prob, else abstain

export function accept(proposal: GatewayProposal, mode: AcceptMode): Accepted {
  if (proposal.options.length === 0 || proposal.argmaxIndex < 0) return { chosenIndex: null, abstained: true };
  if (proposal.abstainP >= ABSTAIN_THRESHOLD) return { chosenIndex: null, abstained: true };
  if (mode === "gates") {
    const top = proposal.options.find((o) => o.index === proposal.argmaxIndex);
    if (!top || top.p < GATE_MIN_P) return { chosenIndex: null, abstained: true };
  }
  return { chosenIndex: proposal.argmaxIndex, abstained: false };
}
