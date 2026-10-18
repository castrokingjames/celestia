// themis.module.ts — wires Themis's enforcement: the shared SessionRegistry (exported so the composition root
// hands it to the rooms) + the ThemisService sweep (self-starts via Nest's OnApplicationBootstrap). Reuses the
// @Global ConfigService + REPOSITORY from firmament. (Themis = the reserved moderation/enforcement codename.)
import { Module } from "@nestjs/common";
import { SessionRegistry } from "./session-registry.js";
import { ThemisService } from "./themis.service.js";

@Module({
  providers: [SessionRegistry, ThemisService],
  exports: [SessionRegistry],
})
export class ThemisModule {}
