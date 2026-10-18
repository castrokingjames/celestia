// Celestia netcode POC — Vite + Phaser + colyseus.js against services/atlas.
// Throwaway harness to iron out the flow + movement/interp/reconciliation (docs/REALTIME.md §3), then rebuild
// on Godot. Shares the SAME wire contract as the server (no codegen — TS↔TS).
//
// Flow (badge-first, docs/REFACTOR.md S1): login (Polaris REST) → one access badge → ONE Colyseus connection to
// Atlas → Janus lobby (character select/create) → play.enter → consume the seat reservation to join the zone
// room. P1 netcode: SELF is client-predicted + server-reconciled; OTHERS are entity-interpolated on the server
// clock. The zone hands its Caelum map (floor + boxes + portals) on join; a lever is the first interaction.
import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { MOVE_SPEED, MSG, type InputCommand, type ZoneMapMsg, type ZoneTransferMsg } from "@celestia/norma";
import { login, Lobby, type PlayEnterResult } from "./sdk/session.js";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const ATLAS_URL = (import.meta.env.VITE_ATLAS_URL as string) ?? "ws://127.0.0.1:2567";
const DEMO_USER = (import.meta.env.VITE_DEMO_USER as string) ?? "neo";
const DEMO_SECRET = (import.meta.env.VITE_BASIC_SECRET as string) ?? "change-me-dev";
const VIEW_W = 800, VIEW_H = 600;
const DT_MAX = 0.05;
const INTERP_DELAY_MS = 300; // render remotes this far behind the SERVER clock, between two snapshots (jitter buffer)
const EXTRAP_MAX_MS = 150;   // on buffer underflow (server stalled), extrapolate last velocity up to this, then hold
const INTERACT_REACH = 48;   // match the server's Fornax qualify reach gate

type Snap = { t: number; x: number; y: number };
type View = { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; buf: Snap[] };
type LeverView = { rect: Phaser.GameObjects.Rectangle; x: number; y: number };

function applyCmd(pos: { x: number; y: number }, c: InputCommand): void {
  const len = Math.hypot(c.dx, c.dy);
  if (len > 0) {
    pos.x += (c.dx / len) * MOVE_SPEED * c.dt;
    pos.y += (c.dy / len) * MOVE_SPEED * c.dt;
  }
}

class ZoneScene extends Phaser.Scene {
  private client!: Client;
  private room?: Room;
  private views = new Map<string, View>(); // OTHER players (interpolated)
  private levers = new Map<string, LeverView>();
  private mapGfx?: Phaser.GameObjects.Graphics;
  private offX = VIEW_W / 2; // world (0,0) screen offset — recomputed to centre each zone's map
  private offY = VIEW_H / 2;
  private clockOffset = NaN;
  private selfId = "";
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private status!: Phaser.GameObjects.Text;

  // self prediction state
  private selfRect?: Phaser.GameObjects.Rectangle;
  private selfLabel?: Phaser.GameObjects.Text;
  private self = { x: 0, y: 0 };
  private seq = 0;
  private pending: InputCommand[] = [];

  constructor() { super("zone"); }

  create() {
    this.status = this.add.text(8, 8, "logging in…", { color: "#9ca3af", fontSize: "14px" });
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,E") as Record<string, Phaser.Input.Keyboard.Key>;
    void this.connect();
  }

  private label(name: string, color: string): Phaser.GameObjects.Text {
    return this.add.text(0, 0, name || "…", { color, fontSize: "11px" }).setOrigin(0.5, 1);
  }

  // login → badge → ONE Atlas connection → Janus lobby → select/create → play.enter → consume the reservation.
  private async connect() {
    const { accessBadge } = await login(POLARIS_URL, DEMO_USER, DEMO_SECRET);
    this.client = new Client(ATLAS_URL);
    const lobby = await Lobby.open(this.client, accessBadge);
    this.status.setText("choosing character…");
    const enter: PlayEnterResult = await new Promise((resolve) => {
      lobby.onState((state) => {
        if (state.characters.length === 0) lobby.create(`Hero_${Math.random().toString(36).slice(2, 7)}`);
        else void lobby.enter(state.characters[0].id).then(resolve);
      });
    });
    lobby.leave(); // drop the lobby presence before the zone registers (avoids a spurious one-session displace)
    const room = await this.client.consumeSeatReservation(
      enter.seatReservation as unknown as Parameters<Client["consumeSeatReservation"]>[0],
    );
    this.enterZone(room, enter.zoneId);
  }

  // Wire up a freshly-joined zone room (first entry AND after a portal transfer).
  private enterZone(room: Room, zoneId: string): void {
    this.resetScene();
    this.room = room;
    this.selfId = room.sessionId;
    this.status.setText(`in ${zoneId} · ${this.selfId}  (green=you · blue=others · E=interact)`);

    room.onMessage(MSG.zoneMap, (m: ZoneMapMsg) => this.drawMap(m));
    room.onMessage(MSG.zoneTransfer, (m: ZoneTransferMsg) => void this.handleTransfer(m));

    const $ = getStateCallbacks(room);
    $(room.state).players.onAdd((player: any, id: string) => {
      if (id === this.selfId) {
        this.self = { x: player.x, y: player.y };
        this.selfRect = this.add.rectangle(this.self.x + this.offX, this.self.y + this.offY, 24, 24, 0x4ade80);
        this.selfLabel = this.label(player.name, "#4ade80");
        $(player).onChange(() => this.reconcile(player.x, player.y, player.lastSeq));
      } else {
        const rect = this.add.rectangle(player.x + this.offX, player.y + this.offY, 24, 24, 0x60a5fa);
        this.views.set(id, { rect, label: this.label(player.name, "#60a5fa"), buf: [] });
      }
    });
    $(room.state).players.onRemove((_p: any, id: string) => {
      const v = this.views.get(id);
      v?.rect.destroy();
      v?.label.destroy();
      this.views.delete(id);
    });

    // Levers (synced): a small square, yellow when on, grey when off.
    $(room.state).levers.onAdd((lever: any, id: string) => {
      const rect = this.add.rectangle(lever.x + this.offX, lever.y + this.offY, 14, 14, lever.on ? 0xfbbf24 : 0x6b7280);
      this.levers.set(id, { rect, x: lever.x, y: lever.y });
      $(lever).onChange(() => rect.setFillStyle(lever.on ? 0xfbbf24 : 0x6b7280));
    });
    $(room.state).levers.onRemove((_l: any, id: string) => {
      this.levers.get(id)?.rect.destroy();
      this.levers.delete(id);
    });

    room.onStateChange((state: any) => {
      const target = state.t - performance.now();
      this.clockOffset =
        Number.isNaN(this.clockOffset) || Math.abs(target - this.clockOffset) > 500
          ? target
          : this.clockOffset + (target - this.clockOffset) * 0.05;
      this.views.forEach((v, id) => {
        const p = state.players.get(id);
        if (!p) return;
        v.buf.push({ t: state.t, x: p.x, y: p.y });
        if (v.buf.length > 30) v.buf.shift();
      });
    });
  }

  // Draw the Caelum tile grid (floor + boxes) + portal markers, centred in the view.
  private drawMap(m: ZoneMapMsg): void {
    const { width, height, tileSize, tiles, portals } = m.map;
    this.offX = Math.round((VIEW_W - width * tileSize) / 2);
    this.offY = Math.round((VIEW_H - height * tileSize) / 2);
    this.mapGfx?.destroy();
    const g = this.add.graphics();
    g.setDepth(-10);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        g.fillStyle(tiles[y][x] === 1 ? 0x4b3b2a : 0x242437, 1); // box : floor
        g.fillRect(x * tileSize + this.offX, y * tileSize + this.offY, tileSize - 1, tileSize - 1);
      }
    }
    for (const p of portals) {
      g.fillStyle(0x22d3ee, 0.5); // portal trigger tile
      g.fillRect(p.at.x * tileSize + this.offX, p.at.y * tileSize + this.offY, tileSize - 1, tileSize - 1);
    }
    this.mapGfx = g;
  }

  // Portal fired: consume the new reservation, swap rooms, rebuild the scene for the target zone.
  private async handleTransfer(m: ZoneTransferMsg): Promise<void> {
    this.status.setText(`crossing to ${m.zoneId}…`);
    void this.room?.leave();
    const room = await this.client.consumeSeatReservation(
      m.seatReservation as unknown as Parameters<Client["consumeSeatReservation"]>[0],
    );
    this.enterZone(room, m.zoneId);
  }

  private resetScene(): void {
    this.selfRect?.destroy();
    this.selfLabel?.destroy();
    this.selfRect = undefined;
    this.selfLabel = undefined;
    this.views.forEach((v) => {
      v.rect.destroy();
      v.label.destroy();
    });
    this.views.clear();
    this.levers.forEach((l) => l.rect.destroy());
    this.levers.clear();
    this.mapGfx?.destroy();
    this.mapGfx = undefined;
    this.pending = [];
    this.seq = 0;
    this.clockOffset = NaN;
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
      this.room.send("input", cmd); // authoritative
      applyCmd(this.self, cmd);      // PREDICT locally — instant
      this.pending.push(cmd);        // keep for reconciliation until acked
    }

    // Interact: on E, toggle the nearest lever within reach (the server re-checks reach — Fornax qualify).
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      const near = this.nearestLever();
      if (near) this.room.send("interact", { targetId: near });
    }

    if (this.selfRect) { this.selfRect.x = this.self.x + this.offX; this.selfRect.y = this.self.y + this.offY; }
    if (this.selfLabel) { this.selfLabel.x = this.self.x + this.offX; this.selfLabel.y = this.self.y + this.offY - 16; }
    this.levers.forEach((l) => { l.rect.x = l.x + this.offX; l.rect.y = l.y + this.offY; });

    // others: buffered snapshots replayed on the SERVER clock, INTERP_DELAY_MS behind, interpolated.
    const renderT = performance.now() + this.clockOffset - INTERP_DELAY_MS;
    this.views.forEach((v) => {
      const buf = v.buf;
      if (buf.length === 0) return;
      let x = buf[0].x;
      let y = buf[0].y;
      if (renderT >= buf[buf.length - 1].t) {
        const last = buf[buf.length - 1];
        const prev = buf.length >= 2 ? buf[buf.length - 2] : undefined;
        const ahead = Math.min(renderT - last.t, EXTRAP_MAX_MS);
        if (prev && last.t > prev.t) {
          x = last.x + ((last.x - prev.x) / (last.t - prev.t)) * ahead;
          y = last.y + ((last.y - prev.y) / (last.t - prev.t)) * ahead;
        } else {
          x = last.x;
          y = last.y;
        }
      } else if (renderT > buf[0].t) {
        let i = 0;
        while (i < buf.length - 1 && buf[i + 1].t < renderT) i++;
        const a = buf[i];
        const b = buf[i + 1];
        const f = (renderT - a.t) / (b.t - a.t || 1);
        x = a.x + (b.x - a.x) * f;
        y = a.y + (b.y - a.y) * f;
      }
      v.rect.x = x + this.offX;
      v.rect.y = y + this.offY;
      v.label.x = x + this.offX;
      v.label.y = y + this.offY - 16;
      while (buf.length > 2 && buf[1].t < renderT) buf.shift();
    });
  }

  private nearestLever(): string | undefined {
    let best: string | undefined;
    let bestD = INTERACT_REACH;
    this.levers.forEach((l, id) => {
      const d = Math.hypot(l.x - this.self.x, l.y - this.self.y);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }

  private held(...names: string[]): boolean { return names.some((n) => this.keys[n]?.isDown); }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: "#1a1a2e",
  scene: ZoneScene,
});
