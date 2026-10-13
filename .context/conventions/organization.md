# Organization & file placement

## Monorepo layout

```
services/<role>/      runnable backend process
  src/index.ts        entry point (launcher): wire + listen
  src/rooms/          Colyseus rooms (realtime)
  src/schema/         @colyseus/schema state classes
packages/<name>/      shared library (@celestia/<name>)
  src/index.ts        public surface
client/godot/               Godot project
  addons/jupiter/     the client SDK (facade + ports/adapters)
  game/               the game's entry node + scenes
docs/                 design decisions (the authoritative docs)
.context/             coding conventions (this layer)
```

## Placement rules

- **Shared across ≥2 services → a `package/`.** Never copy-paste shared logic between services.
- **Wire constants (intent types, `PROTOCOL_VERSION`, reason codes) → `packages/net-contract`**, the single source; later codegen'd into the client's `celestia_contract.gd`. Never hand-type a wire string in two places.
- **A concrete adapter class lives next to its port**, and is named only at the composition root (G7).
- **One entry point per service** (`src/index.ts`); room/handler logic lives in subfolders, not the entry file.

## Naming

- Packages: `@celestia/<kebab>`. Services: role nouns (`realtime`/`meta`/`cognition`), no `-server` suffix (G10).
- TS: `PascalCase` types/classes, `camelCase` values, `SCREAMING_SNAKE` consts, `kebab-case` filenames (except class-per-file like `ZoneRoom.ts`).
- GDScript: `snake_case` methods/vars, `PascalCase` class_names, `snake_case.gd` files.
