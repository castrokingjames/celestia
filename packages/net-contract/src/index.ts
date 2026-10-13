// Shared network contract: the single source of truth for wire constants.
// Imported by services (and later codegen'd into client/addons/jupiter/.../celestia_contract.gd — docs/CLIENT-SDK.md §6).

/** Bumped on ANY wire-shape change; the client sends this at connect and the server rejects a mismatch. */
export const PROTOCOL_VERSION = 1;

/** Intent types the client may send (the server re-validates every one — client is never trusted). */
export const INTENT_TYPES = ["input", "attack"] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

/** Movement speed (units/sec). SHARED so client prediction and the server integrate identically —
 *  reconciliation only works if both sides use the same value (docs/REALTIME.md §3). */
export const MOVE_SPEED = 160;

/** Max dt (seconds) the server honors per input command — clamp vs speedhack / long stalls. */
export const INPUT_DT_MAX = 0.05;

/** A client movement command. `seq` lets the client replay un-acked commands during reconciliation. */
export type InputCommand = { seq: number; dx: number; dy: number; dt: number };

/** JWT `aud` on the one-time connect-ticket: meta mints it, realtime verifies it in onAuth. */
export const CONNECT_TICKET_AUD = "realtime";

/** What realtime learns about the player from a verified connect-ticket (attached to client.auth). */
export type ConnectTicketClaims = { accountId: string; role: string };

/** Server→client message channels (all ride the one WSS). */
export const MSG = {
  // dialogue.*, etc. added later
} as const;
