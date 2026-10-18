// accounts.service.ts — injectable use-cases over the one Repository (@Global, from @celestia/firmament).
// Wraps the framework-agnostic findOrCreateAccount so controllers/gateways get it via DI. No local store:
// data access is the single Repository port; the Kysely adapter lives only in @celestia/firmament (G7).
import { Inject, Injectable } from "@nestjs/common";
import { REPOSITORY } from "@celestia/firmament/nest";
import type { Account, Repository } from "@celestia/firmament";
import type { VerifiedIdentity } from "../auth/auth-method.port.js";
import { findOrCreateAccount, type FindOrCreateResult } from "./account.service.js";

@Injectable()
export class AccountsService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  findOrCreate(identity: VerifiedIdentity): Promise<FindOrCreateResult> {
    return findOrCreateAccount(this.repo, identity);
  }

  getById(id: string): Promise<Account | null> {
    return this.repo.getAccountById(id);
  }
}
