// @celestia/firmament/nest — the shared NestJS building blocks (ConfigModule/ConfigService, PersistenceModule
// + the REPOSITORY data-access port, TicketModule/TicketService). COMPILED to dist (decorators need a real
// build; tsx/esbuild won't transform a package symlinked under node_modules). Services import these; everything
// is DI-resolved.
export * from "./config/config.service.js";
export * from "./config/config.module.js";
export * from "./caelum/caelum.service.js";
export * from "./caelum/caelum.module.js";
export * from "./persistence/persistence.module.js";
export * from "./tickets/ticket.service.js";
export * from "./tickets/ticket.module.js";
