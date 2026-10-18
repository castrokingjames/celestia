// main.ts — Polaris bootstrap (NestJS, the help desk). Pure HTTP: the auth handoff (login/refresh/logout) +
// /health — no WS anymore (character select + zone entry moved to the Atlas Janus lobby; docs/REFACTOR.md S1).
// CORS + port from ConfigService (DI); shutdown hooks so PersistenceModule destroys the pool. `reflect-metadata`
// first (Nest decorators need it). Run: pnpm --filter @celestia/polaris dev
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ConfigService } from "@celestia/firmament/nest";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
  const cfg = app.get(ConfigService);
  app.enableCors({ origin: cfg.corsOrigins });
  const port = Number(process.env.PORT) || cfg.polarisPort;
  await app.listen(port, "0.0.0.0");
  console.log(`[polaris] NestJS (HTTP help desk) listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error("[polaris] failed to start:", err);
  process.exit(1);
});
