// Entry point / launcher for the realtime service (docs/REALTIME.md).
// Boots the Colyseus server on a bare HTTP server, defines the zone room, serves /health, listens.
import http from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ZoneRoom } from "./rooms/ZoneRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

// Bare HTTP server: hosts the WS upgrade + the /health readiness endpoint (docs/INFRA.md §9).
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    // TODO: readiness — verify Postgres (and Redis once multi-process) reachable, not just "process alive".
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "up" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// One zone room for now (single channel). Multi-channel / Redis presence come at scale (docs/REALTIME.md §10).
gameServer.define("zone", ZoneRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[realtime] zone server listening on :${PORT}  (GET /health)`);
});
