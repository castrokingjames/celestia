// accounts.module.ts — exposes AccountsService. Data access is the @Global Repository (PersistenceModule),
// so there is no local store to bind here anymore.
import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service.js";

@Module({
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
