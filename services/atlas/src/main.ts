// main.ts — Atlas bootstrap (NestJS hosting Colyseus). Nest owns the app shell (DI, HTTP /health, lifecycle);
// Colyseus owns the realtime rooms, attached to Nest's HTTP server. Room deps (TicketService, the Repository,
// CharactersService, config) are resolved from the Nest container and handed to each room via Colyseus define
// options. Run: pnpm --filter @celestia/atlas dev
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ConfigService, TicketService, CaelumService, REPOSITORY } from "@celestia/firmament/nest";
import type { Repository } from "@celestia/firmament";
import { AppModule } from "./app.module.js";
import { CharactersService } from "./characters/characters.service.js";
import { ZoneRoom, type ZoneRoomDeps } from "./rooms/ZoneRoom.js";
import { LobbyRoom, type LobbyRoomDeps } from "./janus/lobby.room.js";
import { SessionRegistry } from "./themis/session-registry.js";
import { DurableEventSink } from "./fornax/index.js";
import { createLogger, configureLogging, type LogLevel } from "@celestia/argus";

const log = createLogger("atlas");
const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "silent"];

async function bootstrap(): Promise<void> {
  // Switchable verbosity: LOG_LEVEL flips the Argus level at boot (default info); the sink can be swapped at
  // runtime via configureLogging (e.g. to add an analytics sink later) with no call-site changes.
  if (LEVELS.includes(process.env.LOG_LEVEL as LogLevel)) configureLogging({ level: process.env.LOG_LEVEL as LogLevel });
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();

  const cfg = app.get(ConfigService);
  const tickets = app.get(TicketService);
  const repo = app.get<Repository>(REPOSITORY);
  const characters = app.get(CharactersService);
  const caelum = app.get(CaelumService);
  const sessions = app.get(SessionRegistry);

  const httpServer = app.getHttpServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

  // Janus — the lobby (the gateway in): badge auth · character select/create · resolve-and-enter a zone.
  gameServer.define("lobby", LobbyRoom, {
    tickets,
    characters,
    repo,
    sessions,
    maxCharacters: cfg.maxCharactersPerAccount,
    startingZoneId: caelum.registry.startingZoneId(),
    realtimeUrl: cfg.realtimeUrl,
  } satisfies LobbyRoomDeps);

  // The authoritative zone sim (20 Hz). No ticket dep — entry is via a lobby seat reservation (onAuth rejects
  // direct joins) and identity rides the reservation's authData (J3). Events persist to log.event via the
  // DurableEventSink (named only here — G7); the session registry lets the Themis sweep evict a banned player.
  gameServer.define("zone", ZoneRoom, {
    registry: caelum.registry,
    repo,
    sessions,
    makeEventSink: (stream) => new DurableEventSink(repo, stream),
    autosaveIntervalSec: cfg.autosaveIntervalSec,
  } satisfies ZoneRoomDeps);

  const port = Number(process.env.PORT) || cfg.realtimePort;
  await app.listen(port, "0.0.0.0");
  log.info("listening (NestJS + Colyseus; GET /health)", { port });
}

// Backstop: a world server must not die from a transient fault in a floated promise (a timer or a
// fire-and-forget message handler). Each such site also catches locally; this is defense in depth — a
// registered handler keeps Node 22 from terminating on an otherwise-unhandled rejection.
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection (backstop)", reason);
});

bootstrap().catch((err) => {
  log.error("failed to start", err);
  process.exit(1);
});
