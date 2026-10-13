# Celestia

Real-time MMO + reusable multi-game engine. All design documentation lives in [`docs/`](./docs) — start with [`docs/README.md`](./docs/README.md).

## Layout

```
services/   runnable backend services  — realtime (now) · meta, cognition (later)
packages/   shared libraries           — net-contract (now)
client/phaser/ netcode POC harness     — Vite + Phaser + colyseus.js (now; throwaway)
client/godot/  Godot 4.5 client        — the Jupiter SDK (destination client; later)
docs/        all design docs
docker-compose.infra.yml   Postgres + Valkey (infra only; the app runs on the host in dev)
```

## Quickstart (dev)

```bash
pnpm install
pnpm infra:up                              # Postgres (+ Valkey) via docker compose
pnpm --filter @celestia/realtime dev       # the 20 Hz zone server on :2567  (GET /health)
```

Then run the Phaser netcode POC: `pnpm --filter @celestia/client-phaser dev` → http://localhost:5173 (instant HMR, connects to `:2567`). `client/godot/` is the Godot destination client — parked while the netcode design is proven in the POC.

## Where to go next

- `docs/BUILD-PLAN.md` — the build sequence (start = the real-time netcode spike).
- `docs/REALTIME.md` — the real-time world / netcode / scaling architecture.
- `docs/TECH-STACK.md` — the decided stack + versions.
