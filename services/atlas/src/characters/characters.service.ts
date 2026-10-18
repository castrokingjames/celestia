// characters.service.ts — injectable use-cases over the one Repository (@Global). Wraps the framework-agnostic
// create/list (character.service.ts); the per-account cap comes from ConfigService (no bare literal, G8). Used
// by the Janus lobby room (character select / create / ownership check at enter).
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService, REPOSITORY } from "@celestia/firmament/nest";
import type { Character, Repository, SpawnData } from "@celestia/firmament";
import { createCharacter, listCharacters } from "./character.service.js";

@Injectable()
export class CharactersService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  list(accountId: string): Promise<Character[]> {
    return listCharacters(this.repo, accountId);
  }

  create(accountId: string, name: string): Promise<Character> {
    return createCharacter(this.repo, accountId, name, this.config.maxCharactersPerAccount);
  }

  /** The character iff it belongs to the account (ownership check at enter — read from authoritative
   *  state, never trusted from the client; G1/G11). */
  getOwned(accountId: string, characterId: string): Promise<Character | null> {
    return this.repo.getOwnedCharacter(accountId, characterId);
  }

  /** The character's saved spawn (name + last zone/position), or null if it has never been placed — the lobby
   *  uses the saved zone to resume a returning character at the zone they left. */
  getSpawn(characterId: string): Promise<SpawnData | null> {
    return this.repo.loadSpawn(characterId);
  }
}
