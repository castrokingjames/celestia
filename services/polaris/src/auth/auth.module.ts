// auth.module.ts — the auth composition root (guardrail #7): assembles the session-first SessionService
// (refresh lifecycle over the @Global Repository + the shared TicketService signer) and the enabled
// AuthMethod map from config.auth.enabledMethods. All via DI factory providers.
import { Module } from "@nestjs/common";
import { ConfigService, REPOSITORY, TicketModule, TicketService } from "@celestia/firmament/nest";
import type { Repository } from "@celestia/firmament";
import { AccountsModule } from "../accounts/accounts.module.js";
import { SessionService } from "./session.service.js";
import { BasicAuthMethod } from "./methods/basic.auth-method.js";
import type { AuthMethod } from "./auth-method.port.js";
import { AuthController } from "./auth.controller.js";
import { AUTH_METHODS, SESSION_SERVICE } from "./auth.tokens.js";

@Module({
  imports: [AccountsModule, TicketModule],
  controllers: [AuthController],
  providers: [
    {
      provide: SESSION_SERVICE,
      useFactory: (cfg: ConfigService, repo: Repository, tickets: TicketService) =>
        new SessionService({
          pepper: cfg.authTokenPepper,
          refreshTtlSec: cfg.refreshTokenTtlSec,
          accessTicketTtlSec: cfg.accessTicketTtlSec,
          repo,
          tickets,
        }),
      inject: [ConfigService, REPOSITORY, TicketService],
    },
    {
      provide: AUTH_METHODS,
      useFactory: (cfg: ConfigService): Map<string, AuthMethod> => {
        const available: Record<string, () => AuthMethod> = {
          basic: () => new BasicAuthMethod(cfg.basicAuthSecret),
        };
        const methods = new Map<string, AuthMethod>();
        for (const id of cfg.enabledMethods) {
          const make = available[id];
          if (!make) throw new Error(`config auth.enabledMethods references unknown method '${id}'`);
          methods.set(id, make());
        }
        return methods;
      },
      inject: [ConfigService],
    },
  ],
})
export class AuthModule {}
