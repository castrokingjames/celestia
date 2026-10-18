// app.module.ts — the Nest root module (Polaris, the help desk). ConfigModule + PersistenceModule are @Global;
// feature modules Accounts + Auth. Pure REST now — character select + zone entry moved to the Atlas Janus
// lobby (docs/REFACTOR.md S1). HealthController lives here.
import { Module } from "@nestjs/common";
import { ConfigModule, PersistenceModule } from "@celestia/firmament/nest";
import { AccountsModule } from "./accounts/accounts.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [ConfigModule, PersistenceModule.forService("polaris"), AccountsModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
