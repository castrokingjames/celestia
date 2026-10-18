// Shared network contract: the single source of truth for wire constants.
// Imported by services (and later codegen'd into client/addons/jupiter/.../celestia_contract.gd — docs/CLIENT-SDK.md §6).

/** Bumped on ANY wire-shape change; the client sends this at connect and the server rejects a mismatch. */
export const PROTOCOL_VERSION = 2;

/** Intent types the client may send (the server re-validates every one — client is never trusted). */
export const INTENT_TYPES = ["input", "attack", "interact"] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

/** Movement speed (units/sec). SHARED so client prediction and the server integrate identically —
 *  reconciliation only works if both sides use the same value (docs/REALTIME.md §3). */
export const MOVE_SPEED = 160;

/** Max dt (seconds) the server honors per input command — clamp vs speedhack / long stalls. */
export const INPUT_DT_MAX = 0.05;

/** A client movement command. `seq` lets the client replay un-acked commands during reconciliation. */
export type InputCommand = { seq: number; dx: number; dy: number; dt: number };

/** A client interaction command: which world object to act on. Carries an id ONLY — the server resolves the
 *  real resource from authoritative state and computes the outcome (client never trusted; G1). The zone room
 *  runs this through the Fornax action pipeline (enumerate → allow → qualify → execute → event → signal). */
export type InteractCommand = { targetId: string };

/** JWT `aud` on the one-time ACCESS badge: Polaris (login/refresh) mints it; Atlas verifies + burns it at the
 *  single connection (the Janus lobby). One badge → one bound Atlas connection per account — the ONLY ticket in
 *  the system now that Polaris is a pure help desk (docs/PIPELINE.md §2, docs/REFACTOR.md S1). */
export const ACCESS_TICKET_AUD = "access";

/** Claims on the access badge (opens the one Atlas connection). WHO you are + your server-assigned role —
 *  NO character/zone: character select happens in the Atlas lobby (Janus) after you connect (docs/REFACTOR.md S1). */
export type AccessTicketClaims = { accountId: string; role: string };

/** Identity the server pre-attaches to a zone SEAT RESERVATION (Colyseus authData): WHO + which character +
 *  which zone, all resolved server-side from the verified badge + an owned character. Becomes `client.auth` in
 *  the zone room (onAuth is SKIPPED for a reserved seat), so the client never asserts it (G1/G11). Supersedes
 *  the zone ticket — the handoff is Atlas-internal (docs/REFACTOR.md S1/J3). `spawn` names the arrival spawn:
 *  omitted on enter/resume (the zone room uses saved placement, else its `default` spawn), set to the portal's
 *  target spawn on a zone transfer (docs/REFACTOR.md S2 move 5). */
export type ZoneSeatAuth = {
  accountId: string;
  role: string;
  characterId: string;
  zoneId: string;
  spawn?: string;
};

/** A character as seen on the wire — engine IDENTITY only; game metadata is module-owned (docs/CHARACTERS.md §3). */
export type CharacterSummary = { id: string; name: string };

/** Messages over the one bound session (distinct from the in-zone INTENT_TYPES above). */
export const SESSION_MSG = {
  state: "session.state", // s→c, pushed on connect
  characterCreate: "character.create", // c→s
  playEnter: "play.enter", // c→s
} as const;

/** s→c on connect: who you are + your characters + how many you may have (null = unlimited). */
export type SessionStateMsg = {
  account: { id: string; role: string };
  characters: CharacterSummary[];
  maxCharacters: number | null;
};

/** c→s: create a character (engine knows only the name; the cap is enforced server-side from config). */
export type CharacterCreateMsg = { name: string };

/** c→s: enter the world as a character → server resolves a zone + mints the one-time zone ticket. */
export type PlayEnterMsg = { characterId: string };

/** An opaque Colyseus seat reservation. The Janus lobby reserves a seat in the target zone room (server-side,
 *  with the verified identity pre-attached as authData) and sends this down; the client consumes it
 *  (colyseus.js `client.consumeSeatReservation`) to join the zone WITHOUT re-auth. The shape is Colyseus-
 *  internal — the client passes it straight through, so the contract keeps it structural. */
export type SeatReservation = { sessionId: string; room: { roomId: string; [k: string]: unknown } };

/** s→c reply to enter: which zone + the Atlas-internal handoff. Consume `seatReservation` to join the zone room
 *  (no new ticket; docs/REFACTOR.md S1/J3). `realtimeUrl` is informational (single-process: the reservation
 *  already carries the room's address). */
export type PlayEnterResult = { zoneId: string; realtimeUrl: string; seatReservation: SeatReservation };

/** Server→client message channels on a ZONE room (distinct from SESSION_MSG on the lobby; all ride the WSS). */
export const MSG = {
  zoneMap: "zone.map", // s→c on zone join: the tile grid + portals to render
  zoneTransfer: "zone.transfer", // s→c when a portal fires: a seat reservation into the next zone
  // dialogue.*, etc. added later
} as const;

/** The zone's dummy map on the wire — enough to render floor + boxes + portal markers (no server-only spawn
 *  table). Tiles are [y][x], 0=walkable 1=box; portal coords are TILE units (world = tile * tileSize). */
export type ZoneMapWire = {
  width: number;
  height: number;
  tileSize: number;
  tiles: number[][];
  portals: { at: { x: number; y: number }; to: { zoneId: string; spawn: string } }[];
};

/** s→c on zone join: which zone + its map to render. */
export type ZoneMapMsg = { zoneId: string; map: ZoneMapWire };

/** s→c when you step on a portal: a seat reservation into the next zone — consume it (and leave the current
 *  zone room) to cross. Atlas-internal, the same mechanic as lobby enter (docs/REFACTOR.md S2 move 5). */
export type ZoneTransferMsg = { zoneId: string; seatReservation: SeatReservation };
