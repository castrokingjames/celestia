// themis/themis.service.ts — the revocation SWEEP: periodically re-reads the status of every account with a
// live connection here and kicks any that have gone non-active since connect (a ban that landed mid-session).
// This is the in-process live-kick for the single-process topology; the instant Valkey `auth.revoke` channel is
// deferred behind the multi-process/sub-second trigger (docs/REFACTOR.md). Reads status via Atlas's SELECT grant
// on account — shared-datastore coordination, NOT a Polaris RPC. Self-starts on Nest boot; interval from config.
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService, REPOSITORY } from "@celestia/firmament/nest";
import type { Repository } from "@celestia/firmament";
import { SessionRegistry } from "./session-registry.js";
import { selectRevoked, CODE_REVOKED } from "./revocation.js";
import { createLogger } from "@celestia/argus";

const log = createLogger("atlas:themis");

@Injectable()
export class ThemisService implements OnApplicationBootstrap, OnModuleDestroy {
  #timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(REPOSITORY) private readonly repo: Pick<Repository, "getAccountStatuses">,
    // Explicit token (not bare type-based DI): Atlas runs under tsx/esbuild, which doesn't emit the
    // `design:paramtypes` metadata Nest needs to resolve a param by its type — so this must name its token.
    @Inject(SessionRegistry) private readonly registry: SessionRegistry,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.#timer = setInterval(() => {
      // Guard the floated promise: a transient DB error in the sweep must LOG and let the next tick retry,
      // never become an unhandled rejection that crashes the world server (Node 22 default).
      this.sweep().catch((err) => log.error("revocation sweep failed", err));
    }, this.config.revocationSweepSec * 1000);
  }

  onModuleDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  /** One sweep: batch-read the status of all present accounts, kick those no longer active. */
  async sweep(): Promise<void> {
    const ids = this.registry.accountIds();
    if (ids.length === 0) return;
    const statusById = await this.repo.getAccountStatuses(ids);
    for (const id of selectRevoked(ids, statusById)) this.registry.kick(id, CODE_REVOKED);
  }
}
