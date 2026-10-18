# Modules & dependency rules

## The three top-level kinds

- **`services/`** — runnable backend processes we deploy (`realtime` now; `polaris`, `cognition` later). Each has its own entry point (`src/index.ts`) and `/health`.
- **`packages/`** — shared libraries, imported by services (and the client codegen). Never run on their own.
- **`client/astrolabe/`** — the Godot 4.5 project (the Jupiter SDK). Not a Node service.

## Current graph

```
services/atlas  ──imports──▶  packages/norma      (PROTOCOL_VERSION, intent types)
client/astrolabe/            ──(codegen later: norma → celestia_contract.gd)
```

## Dependency rules

- **Acyclic.** The intended direction (as packages land): `services → composition → {core, adapters-*, game-*} → ports → leaf-contracts`. Never a cycle.
- **G3 — engine ↛ game module.** Genre-neutral engine packages (`core`, `ports`, `*-contract`) must **never** import a game module (`game-cozy`, etc.). The engine must build with the game module absent. Enforced by an arch-test.
- **Ports/adapters (G7).** A service depends on a **port**; the concrete adapter is chosen only at the composition root. Economy logic is one shared module (`EconomyService`) imported by both `realtime` and (later) `polaris` — never duplicated, never called cross-service over HTTP.
- **Services talk through shared packages + Postgres + thin seams** (connect-ticket handshake, Redis pub/sub) — **not** a chatty RPC mesh. Cognition is reached through a port whose adapter is in-process now, a service later.

## Naming (G10)

Role-named, no redundant suffix: `realtime`, `polaris`, `cognition` (not `game-server`, `polaris-api-server`). Packages are `@celestia/<name>`.
