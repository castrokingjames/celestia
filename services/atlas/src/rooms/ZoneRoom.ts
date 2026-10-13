// The authoritative zone room — 20 Hz (docs/REALTIME.md §2). The server owns truth; the client sends
// typed intents only and predicts/reconciles locally (§3). Movement is command-based so prediction works.
import { Room, Client } from "@colyseus/core";
import { ZoneState, Player } from "../schema/ZoneState.js";
import { MOVE_SPEED, INPUT_DT_MAX, type InputCommand, type ConnectTicketClaims } from "@celestia/net-contract";
import { verifyConnectTicket } from "../auth/ticket.js";

const TICK_HZ = 20;

export class ZoneRoom extends Room<ZoneState> {
  onCreate() {
    this.setState(new ZoneState());
    this.setSimulationInterval(() => this.update(), 1000 / TICK_HZ); // heartbeat; mob AI + combat land here (P4)
    this.setPatchRate(1000 / TICK_HZ);

    // Command-based movement → client prediction + server reconciliation (docs/REALTIME.md §3).
    // Client predicts locally with the SAME MOVE_SPEED; the server applies the command authoritatively
    // and echoes lastSeq so the client can snap + replay un-acked commands.
    this.onMessage("input", (client: Client, cmd: InputCommand) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !cmd) return;
      const dt = Math.max(0, Math.min(INPUT_DT_MAX, cmd.dt ?? 0)); // clamp — the server never trusts client dt
      const len = Math.hypot(cmd.dx ?? 0, cmd.dy ?? 0);
      if (len > 0) {
        p.x += ((cmd.dx ?? 0) / len) * MOVE_SPEED * dt;
        p.y += ((cmd.dy ?? 0) / len) * MOVE_SPEED * dt;
      }
      p.lastSeq = cmd.seq ?? p.lastSeq;
      // TODO P2: validate against the map collision grid. P3: scope to StateView AoI.
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
    this.state.players.set(client.sessionId, new Player());
    console.log(
      `[zone] join ${client.sessionId} as ${auth?.accountId ?? "?"} role=${auth?.role ?? "?"} (${this.state.players.size} present)`,
    );
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  private update() {
    // Heartbeat. Server-authoritative mob AI + combat (P4) run here on the 20 Hz step.
  }
}
