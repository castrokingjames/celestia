// jupiter/metis.ts — METIS, the contract leg: re-export the shared wire contract so a game depends on ONE
// package (@celestia/jupiter) for both the SDK and the wire types it may need (e.g. ZoneMapWire to render).
// The contract itself lives in @celestia/norma — the single source of truth shared with the server.
export * from "@celestia/norma";
