// caelum.service.ts — the Nest wrapper over the Caelum loader (firmament pure entry). Constructs + VALIDATES
// the whole world graph at boot (when Nest instantiates this provider); invalid/dangling topology throws here
// and fails boot loudly. Only a service that imports CaelumModule (Atlas) pays the load — Polaris (the help
// desk) never does. The built WorldRegistry is immutable; rooms read it and instantiate per-zone lazily.
import { Injectable } from "@nestjs/common";
import { loadWorldRegistry, type WorldRegistry } from "./caelum.js";

@Injectable()
export class CaelumService {
  readonly registry: WorldRegistry = loadWorldRegistry();
}
