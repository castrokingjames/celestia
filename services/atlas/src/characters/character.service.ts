// character.service.ts — create/list characters. The per-account cap is a GAME-MODULE POLICY read from
// config by the CALLER and passed in (maxCharacters; null = unlimited) — the service names no literal
// (G8) and stays config-agnostic. Data access is the one Repository, never Kysely directly (G7). Lives in
// Atlas: characters are game data (docs/PIPELINE.md §3), reached through the Janus lobby.
import type { Character, Repository } from "@celestia/firmament";

/** Account is at its per-game character cap. */
export class CharacterLimitError extends Error {
  constructor(readonly max: number) {
    super(`character limit reached (max ${max})`);
    this.name = "CharacterLimitError";
  }
}

/** The requested character name is already taken (names are unique). */
export class CharacterNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`character name already taken: ${name}`);
    this.name = "CharacterNameTakenError";
  }
}

type Store = Pick<Repository, "listCharacters" | "countCharacters" | "createCharacter">;

export function listCharacters(repo: Store, accountId: string): Promise<Character[]> {
  return repo.listCharacters(accountId);
}

/** Create a character, enforcing the per-game cap (maxCharacters; null = unlimited). The count→insert gap
 *  is a benign race (worst case one over-cap character; the next create is blocked) — the hard invariant is
 *  the unique name at the DB. A unique-violation surfaces as CharacterNameTakenError for the client to re-prompt. */
export async function createCharacter(
  repo: Store,
  accountId: string,
  name: string,
  maxCharacters: number | null,
): Promise<Character> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("character name required");

  if (maxCharacters !== null) {
    const count = await repo.countCharacters(accountId);
    if (count >= maxCharacters) throw new CharacterLimitError(maxCharacters);
  }

  try {
    return await repo.createCharacter(accountId, trimmed);
  } catch (err) {
    if (isUniqueViolation(err)) throw new CharacterNameTakenError(trimmed);
    throw err;
  }
}

/** Postgres unique_violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
