// auth.tokens.ts — DI tokens for the auth providers. Kept in their own file so auth.module and
// auth.controller can both import them WITHOUT a module↔controller value-import cycle.
export const SESSION_SERVICE = "SESSION_SERVICE";
export const AUTH_METHODS = "AUTH_METHODS";
