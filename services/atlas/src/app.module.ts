// app.module.ts — the Nest root module (Atlas). Reuses the shared Firmament modules: ConfigModule (@Global),
// PersistenceModule (@Global — the one Repository, for character_placement reads/writes), TicketModule
// (access-badge verify), CaelumModule (@Global — the validated world/zone registry, loaded + graph-checked at
// boot). HealthController served on the same HTTP server Colyseus upgrades WS on.
import { Module } from "@nestjs/common";
import { ConfigModule, PersistenceModule, TicketModule, CaelumModule } from "@celestia/firmament/nest";
import { CharactersModule } from "./characters/characters.module.js";
import { ThemisModule } from "./themis/themis.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [
    ConfigModule,
    PersistenceModule.forService("atlas"),
    TicketModule,
    CaelumModule,
    CharactersModule,
    ThemisModule, // SessionRegistry + the revocation sweep (ban/suspend eviction)
  ],
  controllers: [HealthController],
})
export class AppModule {}
