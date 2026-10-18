// characters.module.ts — provides CharactersService (character list/create/ownership) for the Janus lobby.
// CharactersService injects REPOSITORY (@Global PersistenceModule) + ConfigService (@Global), so no bindings
// are needed here — just expose the service.
import { Module } from "@nestjs/common";
import { CharactersService } from "./characters.service.js";

@Module({
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
