// The authoritative zone room — 20 Hz FIXED tick (docs/REALTIME.md §2-3). The server owns truth; the
// client sends typed input commands and predicts/reconciles locally. Movement is applied on the fixed
// tick (inputs are QUEUED, then drained each step) rather than on message arrival — so the authoritative
// position advances on a steady clock. That even cadence + the server clock (state.t) is what lets
// clients interpolate remote players smoothly even under network jitter.
import { Room, Client } from "@colyseus/core";
import { ZoneState, Player } from "../schema/ZoneState.js";
import { MOVE_SPEED, INPUT_DT_MAX, type InputCommand, type ConnectTicketClaims } from "@celestia/net-contract";
import { verifyConnectTicket } from "../auth/ticket.js";

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;

export class ZoneRoom extends Room<ZoneState> {
  // Per-player inputs received since the last tick; drained in update().
  private readonly inputs = new Map<string, InputCommand[]>();

  onCreate() {
    this.setState(new ZoneState());
    this.setSimulationInterval(() => this.update(), TICK_MS);
    this.setPatchRate(TICK_MS);

    // QUEUE inputs — do NOT apply here. The fixed tick drains them, decoupling movement from
    // message-arrival jitter. The client predicts the same commands locally with the SAME MOVE_SPEED.
    this.onMessage("input", (client: Client, cmd: InputCommand) => {
      if (!cmd) return;
      this.inputs.get(client.sessionId)?.push(cmd);
    });
  }

  // Gate every join on a valid one-time connect-ticket from meta. The returned value becomes
  // client.auth; throwing rejects the join. The ticket is server-signed, so the client can't
  // mint or alter who it is (client-never-trusted / G11).
  async onAuth(_client: Client, options: { ticket?: string }): Promise<ConnectTicketClaims> {
    if (!options?.ticket) throw new Error("connect-ticket required");
    return verifyConnectTicket(options.ticket);
  }

  onJoin(client: Client) {
    const auth = client.auth as ConnectTicketClaims | undefined;
    this.inputs.set(client.sessionId, []);
    this.state.players.set(client.sessionId, new Player());
    console.log(
      `[zone] join ${client.sessionId} as ${auth?.accountId ?? "?"} role=${auth?.role ?? "?"} (${this.state.players.size} present)`,
    );
  }

  onLeave(client: Client) {
    this.inputs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  // Fixed 20 Hz step: advance the server clock, then apply each player's queued inputs authoritatively.
  private update() {
    this.state.t += TICK_MS;
    this.state.players.forEach((p, id) => {
      const q = this.inputs.get(id);
      if (!q || q.length === 0) return;
      for (const cmd of q) {
        const dt = Math.max(0, Math.min(INPUT_DT_MAX, cmd.dt ?? 0)); // clamp — the server never trusts client dt
        const len = Math.hypot(cmd.dx ?? 0, cmd.dy ?? 0);
        if (len > 0) {
          p.x += ((cmd.dx ?? 0) / len) * MOVE_SPEED * dt;
          p.y += ((cmd.dy ?? 0) / len) * MOVE_SPEED * dt;
        }
        p.lastSeq = cmd.seq ?? p.lastSeq;
      }
      q.length = 0; // drained
      // TODO P2: collision grid. P3: StateView AoI. P4: mob AI + combat on this same tick.
    });
  }
}
