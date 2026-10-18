// health.controller.ts — liveness. Injects ConfigService (DI) for the env tag.
import { Controller, Get, Inject } from "@nestjs/common";
import { ConfigService } from "@celestia/firmament/nest";

@Controller()
export class HealthController {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  @Get("health")
  health() {
    return { status: "up", env: this.config.env };
  }
}
