// Celestia netcode POC — Vite + Phaser + colyseus.js against services/atlas.
// Throwaway harness to iron out movement → interactions → interp/sync/reconciliation (docs/REALTIME.md §3),
// then rebuild on Godot. Shares the SAME wire contract as the server (no codegen — TS↔TS).
//
// P1 netcode: SELF is client-predicted + server-reconciled (snap to authoritative + replay un-acked
// commands); OTHERS are entity-interpolated toward their authoritative server positions.
import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { PROTOCOL_VERSION, MOVE_SPEED, type InputCommand } from "@celestia/net-contract";
import { CelestiaAuth } from "./sdk/auth.js";

const ENDPOINT = (import.meta.env.VITE_ENDPOINT as string) ?? "ws://127.0.0.1:2567";
const META_URL = (import.meta.env.VITE_META_URL as string) ?? "http://127.0.0.1:3000";
const DEMO_USER = (import.meta.env.VITE_DEMO_USER as string) ?? "neo";
const DEMO_SECRET = (import.meta.env.VITE_BASIC_SECRET as string) ?? "change-me-dev";
const ORIGIN_X = 400, ORIGIN_Y = 300; // center world (0,0) in the 800x600 view
const DT_MAX = 0.05;

type View = { rect: Phaser.GameObjects.Rectangle; tx: number; ty: number };

function applyCmd(pos: { x: number; y: number }, c: InputCommand): void {
  const len = Math.hypot(c.dx, c.dy);
  if (len > 0) {
    pos.x += (c.dx / len) * MOVE_SPEED * c.dt;
    pos.y += (c.dy / len) * MOVE_SPEED * c.dt;
  }
}

class ZoneScene extends Phaser.Scene {
  private room!: Room;
  private views = new Map<string, View>(); // OTHER players (interpolated)
  private selfId = "";
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private status!: Phaser.GameObjects.Text;

  // self prediction state
  private selfRect?: Phaser.GameObjects.Rectangle;
  private self = { x: 0, y: 0 };      // predicted position
  private seq = 0;
  private pending: InputCommand[] = []; // commands sent but not yet acked by the server

  constructor() { super("zone"); }

  create() {
    this.status = this.add.text(8, 8, "connecting…", { color: "#9ca3af", fontSize: "14px" });
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
    void this.connect();
  }

  private async connect() {
    const client = new Client(ENDPOINT);
    // Auth first (via our SDK, not raw HTTP): log in -> one-time connect-ticket -> join with it.
    // The realtime server rejects joins without a valid ticket. POC uses hardcoded creds here;
    // a real login screen replaces this later.
    const auth = new CelestiaAuth(META_URL);
    await auth.login(DEMO_USER, DEMO_SECRET);
    const ticket = await auth.connectTicket();
    this.room = await client.joinOrCreate("zone", { protocolVersion: PROTOCOL_VERSION, ticket });
    this.selfId = this.room.sessionId;
    this.status.setText(`connected · ${this.selfId}  (green=you, predicted · blue=others, interpolated)`);

    const $ = getStateCallbacks(this.room);
    $(this.room.state).players.onAdd((player: any, id: string) => {
      if (id === this.selfId) {
        this.self = { x: player.x, y: player.y };
        this.selfRect = this.add.rectangle(this.self.x + ORIGIN_X, this.self.y + ORIGIN_Y, 24, 24, 0x4ade80);
        $(player).onChange(() => this.reconcile(player.x, player.y, player.lastSeq));
      } else {
        const rect = this.add.rectangle(player.x + ORIGIN_X, player.y + ORIGIN_Y, 24, 24, 0x60a5fa);
        const v: View = { rect, tx: player.x, ty: player.y };
        this.views.set(id, v);
        $(player).onChange(() => { v.tx = player.x; v.ty = player.y; });
      }
    });
    $(this.room.state).players.onRemove((_p: any, id: string) => {
      this.views.get(id)?.rect.destroy();
      this.views.delete(id);
    });
  }

  /** Server reconciliation: snap to the authoritative position, then re-apply commands it hasn't acked. */
  private reconcile(serverX: number, serverY: number, lastSeq: number): void {
    this.self.x = serverX;
    this.self.y = serverY;
    this.pending = this.pending.filter((c) => c.seq > lastSeq);
    for (const c of this.pending) applyCmd(this.self, c);
  }

  update(_t: number, deltaMs: number): void {
    if (!this.room) return;
    const dt = Math.min(DT_MAX, deltaMs / 1000);
    const dx = (this.held("A", "LEFT") ? -1 : 0) + (this.held("D", "RIGHT") ? 1 : 0);
    const dy = (this.held("W", "UP") ? -1 : 0) + (this.held("S", "DOWN") ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      const cmd: InputCommand = { seq: ++this.seq, dx, dy, dt };
      this.room.send("input", cmd); // send to server (authoritative)
      applyCmd(this.self, cmd);      // PREDICT locally — instant response, no round-trip wait
      this.pending.push(cmd);        // keep for reconciliation until acked
    }

    // self rendered at its PREDICTED position (feels instant); corrected invisibly on reconcile
    if (this.selfRect) { this.selfRect.x = this.self.x + ORIGIN_X; this.selfRect.y = this.self.y + ORIGIN_Y; }

    // others INTERPOLATED toward their authoritative server positions
    this.views.forEach((v) => {
      v.rect.x += (v.tx + ORIGIN_X - v.rect.x) * 0.2;
      v.rect.y += (v.ty + ORIGIN_Y - v.rect.y) * 0.2;
    });
  }

  private held(...names: string[]): boolean { return names.some((n) => this.keys[n]?.isDown); }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  scene: ZoneScene,
});
