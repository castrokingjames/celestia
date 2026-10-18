// persistence.module.ts — the ONE data-access module and the whole ORM boundary. Imported per-service via
// `PersistenceModule.forService("polaris" | "atlas")`, which connects as THAT service's own least-privilege DB
// role (write-ownership enforcement — docs/REFACTOR.md S1 move 6; Atlas has no write on auth tables). The
// returned module is global, so any provider injects REPOSITORY anywhere. It owns the Kysely client internally
// + its lifecycle (destroy on shutdown); the ONLY public DB surface is REPOSITORY. To swap the ORM, rewrite
// kysely-repository.ts (+ client.ts / schema.ts) in this folder — no service module changes.
import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";
import type { Kysely } from "kysely";
import { ConfigService } from "../config/config.service.js";
import type { DbService } from "../config/config.js";
import { createDb } from "./client.js";
import type { Database } from "./schema.js";
import { KyselyRepository } from "./kysely-repository.js";

// Internal token for the raw Kysely client — NEVER exported; nothing outside this module touches it.
const KYSELY = "KYSELY";

export const REPOSITORY = "REPOSITORY";

@Module({})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** Wire the one Repository for a specific service, connecting as THAT service's least-privilege DB role.
   *  Global, so REPOSITORY is injectable anywhere in the service. */
  static forService(service: DbService): DynamicModule {
    return {
      module: PersistenceModule,
      global: true,
      providers: [
        {
          provide: KYSELY,
          useFactory: (cfg: ConfigService): Kysely<Database> => createDb(cfg.databaseUrlFor(service)),
          inject: [ConfigService],
        },
        {
          provide: REPOSITORY,
          useFactory: (db: Kysely<Database>) => new KyselyRepository(db),
          inject: [KYSELY],
        },
      ],
      exports: [REPOSITORY],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
