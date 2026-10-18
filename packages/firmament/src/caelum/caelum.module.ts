// caelum.module.ts — @Global (like ConfigModule/PersistenceModule) so any Atlas module can inject CaelumService
// without re-importing. Atlas imports this at its root; Polaris does not — the help desk needs no world topology.
import { Global, Module } from "@nestjs/common";
import { CaelumService } from "./caelum.service.js";

@Global()
@Module({
  providers: [CaelumService],
  exports: [CaelumService],
})
export class CaelumModule {}
