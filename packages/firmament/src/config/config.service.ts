// config.service.ts — injectable, typed view over the shared config. Non-secret values are read at
// construction; secrets stay LAZY (getters delegating to the raw config) so constructing ConfigService in
// a service that lacks a given secret never throws.
import { Injectable } from "@nestjs/common";
import { config, type DbService } from "./config.js";

@Injectable()
export class ConfigService {
  readonly env = config.env;
  readonly polarisPort = config.polarisPort;
  readonly corsOrigins = config.corsOrigins;
  readonly realtimePort = config.realtimePort;
  readonly tickHz = config.tickHz;
  readonly patchRateHz = config.patchRateHz;
  readonly maxClientsPerChannel = config.maxClientsPerChannel;
  readonly accessTokenTtlSec = config.accessTokenTtlSec;
  readonly refreshTokenTtlSec = config.refreshTokenTtlSec;
  readonly accessTicketTtlSec = config.accessTicketTtlSec;
  readonly maxCharactersPerAccount = config.maxCharactersPerAccount;
  readonly startingZoneId = config.startingZoneId;
  readonly realtimeUrl = config.realtimeUrl;
  readonly autosaveIntervalSec = config.autosaveIntervalSec;
  readonly revocationSweepSec = config.revocationSweepSec;
  readonly enabledMethods = config.auth.enabledMethods;

  /** Connection string for a service's own least-privilege role (write-ownership split, REFACTOR S1 move 6). */
  databaseUrlFor(service: DbService): string {
    return config.databaseUrlFor(service);
  }
  get databaseUrl(): string {
    return config.databaseUrl;
  }
  get basicAuthSecret(): string {
    return config.basicAuthSecret;
  }
  get jwtPrivateKeyPem(): string {
    return config.jwtPrivateKeyPem;
  }
  get jwtPublicKeyPem(): string {
    return config.jwtPublicKeyPem;
  }
  get authTokenPepper(): string {
    return config.authTokenPepper;
  }
}
