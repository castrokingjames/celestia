// Celestia netcode POC — Vite + Phaser + colyseus.js against services/atlas.
// Throwaway harness to iron out movement → interactions → interp/sync/reconciliation (docs/REALTIME.md §3),
// then rebuild on Godot. Shares the SAME wire contract as the server (no codegen — TS↔TS).
//
// Flow (session-first, docs/CHARACTERS.md): login → bound session (Polaris) → create/select a character →
// play.enter → connect Atlas with the one-time zone ticket. P1 netcode: SELF is client-predicted +
// server-reconciled; OTHERS are entity-interpolated on the server clock.
import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { PROTOCOL_VERSION, MOVE_SPEED, type InputCommand } from "@celestia/norma";
import { login, SessionConnection, type PlayEnterResult, type SessionStateMsg } from "./sdk/session.js";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const POLARIS_WS = POLARIS_URL.replace(/^http/, "ws"); // session gateway shares Polaris's port
const DEMO_USER = (import.meta.env.VITE_DEMO_USER as string) ?? "neo";
const DEMO_SECRET = (import.meta.env.VITE_BASIC_SECRET as string) ?? "change-me-dev";
const ORIGIN_X = 400, ORIGIN_Y = 300; // center world (0,0) in the 800x600 view
const DT_MAX = 0.05;
const INTERP_DELAY_MS = 300; // render remotes this far behind the SERVER clock, between two snapshots (jitter buffer)
const EXTRAP_MAX_MS = 150;   // on buffer underflow (server stalled), extrapolate last velocity up to this, then hold

type Snap = { t: number; x: number; y: number };
type View = { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; buf: Snap[] };

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
  private clockOffset = NaN; // smoothed estimate of (serverTime − localTime); serverNow ≈ performance.now() + clockOffset
  private selfId = "";
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private status!: Phaser.GameObjects.Text;

  // self prediction state
  private selfRect?: Phaser.GameObjects.Rectangle;
  private selfLabel?: Phaser.GameObjects.Text;
  private self = { x: 0, y: 0 };      // predicted position
  private seq = 0;
  private pending: InputCommand[] = []; // commands sent but not yet acked by the server

  constructor() { super("zone"); }

  create() {
    this.status = this.add.text(8, 8, "logging in…", { color: "#9ca3af", fontSize: "14px" });
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT") as Record<string, Phaser.Input.Keyboard.Key>;
    void this.connect();
  }

  private label(name: string, color: string): Phaser.GameObjects.Text {
    return this.add.text(0, 0, name || "…", { color, fontSize: "11px" }).setOrigin(0.5, 1);
  }

  private async connect() {
    // Session-first: login → bound session → create a character if none → play.enter → zone ticket.
    const { sessionTicket } = await login(POLARIS_URL, DEMO_USER, DEMO_SECRET);
    const session = new SessionConnection(POLARIS_WS, sessionTicket);
    await session.ready();
    this.status.setText("choosing character…");
    const enter: PlayEnterResult = await new Promise((resolve) => {
      session.onState((state: SessionStateMsg) => {
        if (state.characters.length === 0) session.create(`Hero_${Math.random().toString(36).slice(2, 7)}`);
        else void session.enter(state.characters[0].id).then(resolve);
      });
    });
    session.close();

    // Connect to the resolved zone with the one-time zone ticket (Atlas rejects joins without it).
    const client = new Client(enter.realtimeUrl);
    this.room = await client.joinOrCreate("zone", { protocolVersion: PROTOCOL_VERSION, ticket: enter.zoneTicket });
    this.selfId = this.room.sessionId;
    this.status.setText(`in ${enter.zoneId} · ${this.selfId}  (green=you · blue=others)`);

    const $ = getStateCallbacks(this.room);
    $(this.room.state).players.onAdd((player: any, id: string) => {
      if (id === this.selfId) {
        this.self = { x: player.x, y: player.y };
        this.selfRect = this.add.rectangle(this.self.x + ORIGIN_X, this.self.y + ORIGIN_Y, 24, 24, 0x4ade80);
        this.selfLabel = this.label(player.name, "#4ade80");
        $(player).onChange(() => this.reconcile(player.x, player.y, player.lastSeq));
      } else {
        const rect = this.add.rectangle(player.x + ORIGIN_X, player.y + ORIGIN_Y, 24, 24, 0x60a5fa);
        this.views.set(id, { rect, label: this.label(player.name, "#60a5fa"), buf: [] });
        // remote snapshots are sampled per-patch on the SERVER clock in room.onStateChange (below).
      }
    });
    $(this.room.state).players.onRemove((_p: any, id: string) => {
      const v = this.views.get(id);
      v?.rect.destroy();
      v?.label.destroy();
      this.views.delete(id);
    });

    // Per-patch (20 Hz): anchor the server clock + append a snapshot for each remote on the SERVER
    // timeline. Fires after the whole patch is applied, so state.t is current.
    this.room.onStateChange((state: any) => {
      // Track the server clock as a SMOOTHED offset — not a hard re-anchor each patch, which would
      // re-inject arrival jitter and make the render time jump backward. Snap on first sample / big drift.
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
    if (this.selfLabel) { this.selfLabel.x = this.self.x + ORIGIN_X; this.selfLabel.y = this.self.y + ORIGIN_Y - 16; }

    // others: play buffered snapshots back on the SERVER clock, rendered INTERP_DELAY_MS behind,
    // interpolating between the two that bracket that time. The timeline is the server's (not
    // packet-arrival time), so jitter can't make remotes hop — only an underflow (updates stalled
    // past the buffer) briefly holds at the newest.
    const renderT = performance.now() + this.clockOffset - INTERP_DELAY_MS; // NaN until first patch → holds at buf[0]
    this.views.forEach((v) => {
      const buf = v.buf;
      if (buf.length === 0) return;
      let x = buf[0].x;
      let y = buf[0].y;
      if (renderT >= buf[buf.length - 1].t) {
        // UNDERFLOW: updates stalled past the buffer (e.g. a free-tier server-tick hitch). Extrapolate
        // the last-known velocity for a capped window so the remote keeps gliding instead of freezing;
        // past the cap, hold. (Any overshoot on a direction change self-corrects once snapshots resume.)
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
      v.rect.x = x + ORIGIN_X;
      v.rect.y = y + ORIGIN_Y;
      v.label.x = x + ORIGIN_X;
      v.label.y = y + ORIGIN_Y - 16;
      while (buf.length > 2 && buf[1].t < renderT) buf.shift(); // drop consumed snapshots, keep one before renderT
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
