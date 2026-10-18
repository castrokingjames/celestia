// @celestia/firmament (pure entry) — shared logic with NO NestJS decorators: the config loader, the DB
// client, and the Kysely schema. Safe to import from scripts/tests/non-Nest code (ships TS source, no
// build or reflect-metadata needed). The shared NestJS modules live at "@celestia/firmament/nest".
export * from "./config/config.js";
export * from "./caelum/caelum.js";
export * from "./persistence/schema.js";
export * from "./persistence/client.js";
export * from "./persistence/repository.js";
export * from "./persistence/kysely-repository.js";
