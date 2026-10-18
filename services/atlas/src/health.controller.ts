// health.controller.ts — liveness for the realtime tier (served by Nest on the same HTTP server Colyseus
// upgrades WS on). TODO: readiness — verify Postgres (and Redis once multi-process) reachable (docs/INFRA.md §9).
import { Controller, Get, Inject } from "@nestjs/common";
import { ConfigService } from "@celestia/firmament/nest";

@Controller()
export class HealthController {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  @Get("health")
  health() {
    return { status: "up", env: this.config.env, tier: "atlas" };
  }
}
