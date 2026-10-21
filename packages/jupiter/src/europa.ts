// jupiter/europa.ts — EUROPA, the transport. The ONLY file in the SDK that imports colyseus.js, so nothing
// above this layer (world/the game) ever sees a Client, a Room, a schema callback, or a wss URL. It owns the
// Atlas connection, runs the Janus lobby flow (badge → character select/create → play.enter), consumes seat
// reservations into zone rooms, and projects each zone Room's messages + synced state into PLAIN-DATA callbacks
// (ZoneHandlers). Everything crossing out of this file is numbers, ids, and strings.
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import {
  MSG,
  NET_MSG,
  SESSION_MSG,
  type AssetManifest,
  type PingMsg,
  type PlayEnterResult,
  type SeatReservation,
  type SessionStateMsg,
  type ZoneMapMsg,
  type ZoneMapWire,
  type ZoneTransferMsg,
} from "@celestia/norma";
import { createLogger } from "@celestia/argus";

const log = createLogger("jupiter:europa");

/** A mob's synced fields, projected as plain data (no colyseus crosses the boundary). `kind` is the client's
 *  asset key; position rides the per-patch snapshot (interpolated), the rest arrive via onMobChange. */
export type MobSnap = { x: number; y: number; kind: string; level: number; hp: number; maxHp: number; action: string };

const mobSnap = (m: any): MobSnap => ({
  x: m.x,
  y: m.y,
  kind: m.kind,
  level: m.level,
  hp: m.hp,
  maxHp: m.maxHp,
  action: m.action,
});

/** Plain-data callbacks a zone connection drives — no colyseus types cross this boundary. */
export interface ZoneHandlers {
  onSelfSpawn(x: number, y: number, name: string, hp: number, maxHp: number): void;
  onSelfChange(x: number, y: number, lastSeq: number, hp: number): void;
  onRemoteAdd(id: string, x: number, y: number, name: string): void;
  onRemoteRemove(id: string): void;
  /** Per server patch: the server clock + a snapshot of every REMOTE player's AND every mob's position. */
  onPatch(
    serverT: number,
    remotes: ReadonlyMap<string, { x: number; y: number }>,
    mobs: ReadonlyMap<string, { x: number; y: number }>,
  ): void;
  onLeverAdd(id: string, x: number, y: number, on: boolean): void;
  onLeverChange(id: string, on: boolean): void;
  onLeverRemove(id: string): void;
  onMobAdd(id: string, mob: MobSnap): void;
  onMobChange(id: string, mob: MobSnap): void;
  onMobRemove(id: string): void;
  onMap(worldId: string, map: ZoneMapWire, assets?: AssetManifest): void;
  onTransfer(zoneId: string, reservation: SeatReservation): void;
  /** Reply to a latency probe: the client timestamp the server echoed back (RTT = clientNow − t). */
  onPong(t: number): void;
}

/** A live connection to ONE zone room: wraps the colyseus Room, projecting it through ZoneHandlers. */
export class ZoneConnection {
  constructor(
    private readonly room: Room,
    h: ZoneHandlers,
  ) {
    const selfId = room.sessionId;
    room.onMessage(MSG.zoneMap, (m: ZoneMapMsg) => h.onMap(m.worldId, m.map, m.assets));
    room.onMessage(MSG.zoneTransfer, (m: ZoneTransferMsg) => h.onTransfer(m.zoneId, m.seatReservation));
    room.onMessage(NET_MSG.pong, (m: PingMsg) => h.onPong(m.t));

    const $ = getStateCallbacks(room);
    $(room.state).players.onAdd((p: any, id: string) => {
      if (id === selfId) {
        h.onSelfSpawn(p.x, p.y, p.name, p.hp, p.maxHp);
        $(p).onChange(() => h.onSelfChange(p.x, p.y, p.lastSeq, p.hp));
      } else {
        h.onRemoteAdd(id, p.x, p.y, p.name);
      }
    });
    $(room.state).players.onRemove((_p: any, id: string) => {
      if (id !== selfId) h.onRemoteRemove(id);
    });
    $(room.state).levers.onAdd((l: any, id: string) => {
      h.onLeverAdd(id, l.x, l.y, l.on);
      $(l).onChange(() => h.onLeverChange(id, l.on));
    });
    $(room.state).levers.onRemove((_l: any, id: string) => h.onLeverRemove(id));
    $(room.state).mobs.onAdd((m: any, id: string) => {
      h.onMobAdd(id, mobSnap(m));
      $(m).onChange(() => h.onMobChange(id, mobSnap(m)));
    });
    $(room.state).mobs.onRemove((_m: any, id: string) => h.onMobRemove(id));

    room.onStateChange((state: any) => {
      const remotes = new Map<string, { x: number; y: number }>();
      state.players.forEach((p: any, id: string) => {
        if (id !== selfId) remotes.set(id, { x: p.x, y: p.y });
      });
      const mobs = new Map<string, { x: number; y: number }>();
      state.mobs.forEach((m: any, id: string) => mobs.set(id, { x: m.x, y: m.y }));
      h.onPatch(state.t, remotes, mobs);
    });
  }

  get sessionId(): string {
    return this.room.sessionId;
  }
  sendInput(cmd: { seq: number; dx: number; dy: number; dt: number }): void {
    this.room.send("input", cmd);
  }
  sendInteract(targetId: string): void {
    this.room.send("interact", { targetId });
  }
  sendAttack(targetId: string): void {
    this.room.send("attack", { targetId });
  }
  /** Send a latency probe carrying a client timestamp; the server echoes it → onPong computes RTT. */
  sendPing(t: number): void {
    this.room.send(NET_MSG.ping, { t });
  }
  leave(): void {
    void this.room.leave();
  }
}

/** The Atlas transport: owns the colyseus Client; opens the lobby and consumes seat reservations into zones. */
export class Transport {
  readonly #client: Client;

  constructor(atlasUrl: string) {
    this.#client = new Client(atlasUrl);
  }

  /** Lobby flow: join with the badge, auto-create a character if none (name from `chooseName`) else take the
   *  first, play.enter → consume the reservation → the first zone connection. */
  async enter(
    badge: string,
    chooseName: () => string,
    handlers: ZoneHandlers,
  ): Promise<{ zone: ZoneConnection; zoneId: string }> {
    const lobby = await this.#client.joinOrCreate("lobby", { badge });
    const result = await new Promise<PlayEnterResult>((resolve) => {
      lobby.onMessage(SESSION_MSG.playEnter, (r: PlayEnterResult) => resolve(r));
      lobby.onMessage(SESSION_MSG.state, (s: SessionStateMsg) => {
        if (s.characters.length === 0) lobby.send(SESSION_MSG.characterCreate, { name: chooseName() });
        else lobby.send(SESSION_MSG.playEnter, { characterId: s.characters[0].id });
      });
      lobby.onMessage("error", (e: { of?: string; reason?: string }) =>
        log.warn("lobby error", { of: e?.of, reason: e?.reason }),
      );
    });
    void lobby.leave();
    return { zone: await this.consume(result.seatReservation, handlers), zoneId: result.zoneId };
  }

  /** Consume a seat reservation (first entry or a portal transfer) → a zone connection. */
  async consume(reservation: SeatReservation, handlers: ZoneHandlers): Promise<ZoneConnection> {
    const room = await this.#client.consumeSeatReservation(
      reservation as unknown as Parameters<Client["consumeSeatReservation"]>[0],
    );
    return new ZoneConnection(room, handlers);
  }
}
