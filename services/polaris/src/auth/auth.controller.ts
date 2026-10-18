// auth.controller.ts — the REST auth handoff (NestJS), the ONLY REST surface (session-first, AUTH.md P1.5;
// one access badge per REFACTOR.md S1): login/refresh return { session: { refresh, accessBadge }, account } —
// NO reusable access token. Past login, the client opens ONE Atlas connection with the badge (the Janus
// lobby — character select / enter live there, not REST). The parametric :method route is declared LAST so
// static routes win. req.body is NEVER read for role/privilege (G11).
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthMethod } from "./auth-method.port.js";
import type { SessionService } from "./session.service.js";
import { AccountNotActiveError } from "./session.service.js";
import { AccountsService } from "../accounts/accounts.service.js";
import { AUTH_METHODS, SESSION_SERVICE } from "./auth.tokens.js";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_METHODS) private readonly methods: Map<string, AuthMethod>,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  @Post("refresh")
  async refresh(@Body() body: { refreshToken?: unknown }) {
    if (typeof body?.refreshToken !== "string") throw new BadRequestException("expected { refreshToken }");
    try {
      const { session, account } = await this.sessions.refresh(body.refreshToken);
      return { session, account: { id: account.id, role: account.role, handle: account.handle } };
    } catch {
      // invalid / expired / reuse-detected / inactive — don't distinguish (no leak).
      throw new UnauthorizedException("invalid refresh token");
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: { refreshToken?: unknown }): Promise<void> {
    if (typeof body?.refreshToken !== "string") throw new BadRequestException("expected { refreshToken }");
    await this.sessions.logout(body.refreshToken); // idempotent; always 204 (no token enumeration)
  }

  @Post(":method")
  async login(@Param("method") methodId: string, @Body() body: unknown) {
    const method = this.methods.get(methodId);
    if (!method) throw new NotFoundException("unknown or disabled auth method");
    let identity;
    try {
      identity = await method.complete(body);
    } catch {
      throw new UnauthorizedException("invalid credentials");
    }
    const { account, created } = await this.accounts.findOrCreate(identity);
    let session;
    try {
      session = await this.sessions.issue(account);
    } catch (err) {
      // Banned/suspended → 403 (authenticated but forbidden). refresh() keeps its generic 401 (no leak there).
      if (err instanceof AccountNotActiveError) throw new ForbiddenException("account is not active");
      throw err;
    }
    return { session, account: { id: account.id, role: account.role, handle: account.handle }, created };
  }
}
