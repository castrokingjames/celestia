// janus/lobby.room.ts — JANUS, the lobby: the gateway into the game (docs/NAMING.md; docs/REFACTOR.md S1).
// A Colyseus room the client opens with its one-time access badge. onAuth verifies + burns the badge; onJoin
// pushes session.state (your characters + the cap); character.create adds one; enter(characterId) does the
// ownership check (G1/G11) + resolves the zone, then the client joins that zone room (the Atlas-internal
// handoff is J3). Exactly ONE live presence per account is the invariant — enforced here via an in-process
// registry (a new connect displaces the old, code 4409); cross-process enforcement rides Colyseus Presence.
// Adapted from the former Polaris session gateway, now Atlas-native (characters are game data — PIPELINE §3).
import { Room, Client } from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import {
  SESSION_MSG,
  type AccessTicketClaims,
  type CharacterCreateMsg,
  type PlayEnterMsg,
  type PlayEnterResult,
  type SeatReservation,
  type SessionStateMsg,
  type ZoneSeatAuth,
} from "@celestia/norma";
import type { TicketService } from "@celestia/firmament/nest";
import type { Repository } from "@celestia/firmament";
import type { CharactersService } from "../characters/characters.service.js";
import { CharacterLimitError, CharacterNameTakenError } from "../characters/character.service.js";
import { reserveZoneSeat } from "../rooms/seat-reservation.js";
import type { SessionRegistry } from "../themis/session-registry.js";
import { gateAccountStatus } from "../themis/revocation.js";

/** Deps handed to the room by the composition root (main.ts) via Colyseus define options. */
export type LobbyRoomDeps = {
  tickets: Pick<TicketService, "verifyAccessToken">;
  characters: CharactersService;
  repo: Pick<Repository, "getAccountById">; // read account.status at the door (Atlas SELECT grant; no write)
  sessions: SessionRegistry; // shared one-session registry + kick surface (Themis)
  maxCharacters: number | null;
  startingZoneId: string;
  realtimeUrl: string;
};

// The lobby carries no synced state — it's a request/response surface over messages.
class LobbyState extends Schema {}

export class LobbyRoom extends Room<LobbyState> {
  private deps!: LobbyRoomDeps;

  onCreate(options: LobbyRoomDeps) {
    this.deps = options;
    this.setState(new LobbyState());
    this.onMessage(SESSION_MSG.characterCreate, (client, data: CharacterCreateMsg) => {
      this.onCharacterCreate(client, data).catch((err) => console.error("[lobby] characterCreate failed:", err));
    });
    this.onMessage(SESSION_MSG.playEnter, (client, data: PlayEnterMsg) => {
      this.onEnter(client, data).catch((err) => console.error("[lobby] playEnter failed:", err));
    });
  }

  // Gate the lobby on a valid one-time access badge (minted by Polaris, verified offline here — G11). ALSO
  // reject a banned/suspended account HERE (throw, so it is never admitted — no onJoin teardown window in which
  // its message handlers could still fire a character.create). A ban can land after the badge was minted (badge
  // TTL is short but non-zero); status is read from authoritative state (Atlas's SELECT-on-account grant),
  // fail-closed. The claims become client.auth; throwing rejects the join.
  async onAuth(_client: Client, options: { badge?: string }): Promise<AccessTicketClaims> {
    if (!options?.badge) throw new Error("access badge required");
    const claims = await this.deps.tickets.verifyAccessToken(options.badge);
    const account = await this.deps.repo.getAccountById(claims.accountId);
    if (!gateAccountStatus(account?.status).ok) throw new Error("account is not active");
    return claims;
  }

  async onJoin(client: Client) {
    const auth = client.auth as AccessTicketClaims;
    // Status was gated in onAuth (reject-before-admit). Register the connection: a new connect displaces the
    // old (4409) — one session per account.
    this.deps.sessions.register(auth.accountId, client);
    await this.pushState(client);
  }

  onLeave(client: Client) {
    const auth = client.auth as AccessTicketClaims | undefined;
    if (auth) this.deps.sessions.remove(auth.accountId, client);
  }

  private async onCharacterCreate(client: Client, data: CharacterCreateMsg): Promise<void> {
    const auth = client.auth as AccessTicketClaims;
    try {
      await this.deps.characters.create(auth.accountId, data?.name ?? "");
    } catch (err) {
      client.send("error", { of: SESSION_MSG.characterCreate, reason: reasonOf(err) });
      return;
    }
    await this.pushState(client);
  }

  private async onEnter(client: Client, data: PlayEnterMsg): Promise<void> {
    const auth = client.auth as AccessTicketClaims;
    const character = await this.deps.characters.getOwned(auth.accountId, data?.characterId ?? "");
    if (!character) {
      client.send("error", { of: SESSION_MSG.playEnter, reason: "unknown_character" });
      return;
    }
    // Resolve the ENTRY zone: resume where this character was last saved, else the manifest starting zone. Then
    // reserve a seat in that zone room with the VERIFIED identity pre-attached (authData) — `spawn` omitted, so
    // the zone room resumes at the saved position (or its default spawn for a fresh character). Colyseus holds
    // the reservation server-side; the client consumes it to join with that identity as client.auth and onAuth
    // skipped — it can neither forge nor alter who it is (G1/G11). No new ticket; the handoff is Atlas-internal.
    const saved = await this.deps.characters.getSpawn(character.id);
    const zoneId = saved?.zoneId ?? this.deps.startingZoneId;
    const seat: ZoneSeatAuth = { accountId: auth.accountId, role: auth.role, characterId: character.id, zoneId };
    const reservation = await reserveZoneSeat(zoneId, seat);
    const result: PlayEnterResult = {
      zoneId,
      realtimeUrl: this.deps.realtimeUrl,
      // Cross the Colyseus→wire boundary: the reservation is Colyseus-internal; the client passes it straight
      // to consumeSeatReservation, so the contract treats it structurally.
      seatReservation: reservation as unknown as SeatReservation,
    };
    client.send(SESSION_MSG.playEnter, result);
  }

  private async pushState(client: Client): Promise<void> {
    const auth = client.auth as AccessTicketClaims;
    const state: SessionStateMsg = {
      account: { id: auth.accountId, role: auth.role },
      characters: await this.deps.characters.list(auth.accountId),
      maxCharacters: this.deps.maxCharacters,
    };
    client.send(SESSION_MSG.state, state);
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof CharacterLimitError) return "character_limit";
  if (err instanceof CharacterNameTakenError) return "name_taken";
  return "error";
}
