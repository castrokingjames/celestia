// main.ts — Polaris bootstrap (NestJS, the help desk). Pure HTTP: the auth handoff (login/refresh/logout) +
// /health — no WS anymore (character select + zone entry moved to the Atlas Janus lobby; docs/REFACTOR.md S1).
// CORS + port from ConfigService (DI); shutdown hooks so PersistenceModule destroys the pool. `reflect-metadata`
// first (Nest decorators need it). Run: pnpm --filter @celestia/polaris dev
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ConfigService } from "@celestia/firmament/nest";
import { createLogger, configureLogging, type LogLevel } from "@celestia/argus";

const log = createLogger("polaris");
const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "silent"];

async function bootstrap(): Promise<void> {
  if (LEVELS.includes(process.env.LOG_LEVEL as LogLevel)) configureLogging({ level: process.env.LOG_LEVEL as LogLevel });
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
  const cfg = app.get(ConfigService);
  app.enableCors({ origin: cfg.corsOrigins });
  const port = Number(process.env.PORT) || cfg.polarisPort;
  await app.listen(port, "0.0.0.0");
  log.info("listening (HTTP help desk)", { port });
}

bootstrap().catch((err) => {
  log.error("failed to start", err);
  process.exit(1);
});
