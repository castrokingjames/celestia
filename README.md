# Celestia

Real-time MMO + reusable multi-game engine. All design documentation lives in [`docs/`](./docs) — start with [`docs/README.md`](./docs/README.md).

## Layout

```
services/   runnable backend services  — realtime (now) · polaris, cognition (later)
packages/   shared libraries           — norma (now)
client/phaethon/ netcode POC harness     — Vite + Phaser + colyseus.js (now; throwaway)
client/astrolabe/  Godot 4.5 client        — the Jupiter SDK (destination client; later)
docs/        all design docs
docker-compose.gaia.yml   Postgres + Valkey (infra only; the app runs on the host in dev)
```

## Quickstart (dev)

```bash
pnpm install
pnpm gaia:up                              # Postgres (+ Valkey) via docker compose
pnpm --filter @celestia/atlas dev       # the 20 Hz zone server on :2567  (GET /health)
```

Then run the Phaser netcode POC: `pnpm --filter @celestia/phaethon dev` → http://localhost:5173 (instant HMR, connects to `:2567`). `client/astrolabe/` is the Godot destination client — parked while the netcode design is proven in the POC.

## Local setup without Docker

The compose file provides two datastores: **Postgres** (required) and **Valkey** (optional — no code connects to it until we go multi-process). To run entirely on the host, do steps 1–5 for Postgres; Valkey is step 6, only if you want it.

1. **Get a Postgres server running with its CLIs (`psql`, `createdb`) on your PATH** — pick whichever you like; everything from step 2 on is identical. Postgres 14+ is fine.
   - **Homebrew:**
     ```bash
     brew install postgresql@17 && brew services start postgresql@17
     # if psql isn't on PATH: export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
     ```
   - **Postgres.app** (self-contained macOS app, no package manager): download from <https://postgresapp.com>, drag it to `/Applications`, open it, and click **Initialize** — it runs a server on `:5432` with a superuser named after your macOS user. Then expose the CLIs:
     ```bash
     echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
     ```
   - **Official installer** (EDB graphical installer — macOS/Linux/Windows): grab it from <https://www.postgresql.org/download/>, run it, set the `postgres` superuser password, and keep port `5432`. On macOS the CLIs land in `/Library/PostgreSQL/17/bin`.
2. **Create the role + database** with the one-time bootstrap (idempotent; reads the target from `DATABASE_URL`, defaulting to the compose values, so `.env` needs no change). `SUPERUSER` lets the migrations create the per-service DB roles; no `pgvector` is required yet.
   ```bash
   pnpm --filter @celestia/polaris db:init
   ```
   It connects as your OS user to the maintenance `postgres` db — passwordless on Homebrew / Postgres.app. For the EDB installer, point it at the superuser you set:
   ```bash
   ADMIN_DATABASE_URL=postgres://postgres:yourpw@localhost:5432/postgres pnpm --filter @celestia/polaris db:init
   ```
   Or do it by hand instead: `psql postgres -c "CREATE ROLE celestia LOGIN PASSWORD 'celestia' SUPERUSER;"` then `createdb -O celestia celestia`.
3. **Configure `.env`** (copy from `.env.example` if you don't have one):
   ```bash
   cp .env.example .env
   pnpm --filter @celestia/polaris gen-dev-keys   # writes dev Ed25519 JWT keys into .env
   ```
   Keep `DATABASE_URL=postgres://celestia:celestia@localhost:5432/celestia` and `BASIC_AUTH_SECRET=change-me-dev`. For least friction, leave `POLARIS_DATABASE_URL`/`ATLAS_DATABASE_URL` unset so both services connect as the admin role (dev-only fallback; needs `NODE_ENV=development`). To exercise the per-service write-ownership split instead, set those two URLs plus their matching `*_DB_PASSWORD`.
4. **Run migrations** (dev doesn't auto-migrate — `prestart` only runs on `start`):
   ```bash
   pnpm --filter @celestia/polaris migrate
   ```
5. **Run the stack** (one per terminal):
   ```bash
   pnpm --filter @celestia/polaris dev    # help desk   · http://localhost:3000
   pnpm --filter @celestia/atlas dev      # zone server · ws://localhost:2567  (GET /health)
   pnpm --filter @celestia/pyxis dev      # PixiJS client · http://localhost:5174
   # optional: pnpm --filter @celestia/phaethon dev   # Phaser client · :5173
   ```
   Open the client — it logs in with the demo user (which auto-creates the account at baseline `terra`), enters the Janus lobby, and drops into the zone. Run Pyxis and Phaethon together and each client appears as the other's remote (different demo users).
6. **Valkey — optional, skip unless you specifically want it.** No code connects to it yet; it's the deferred presence / instant-revocation seam that turns on at multi-process (see `docs/INFRA.md`), so the stack above runs fine without it. To install + run it natively anyway:
   ```bash
   brew install valkey && brew services start valkey      # listens on localhost:6379
   valkey-cli ping                                        # -> PONG  (verify it's up)
   ```
   No package manager: grab a build from <https://valkey.io/download/> (or `make` from source) and run `valkey-server`. Keep `VALKEY_URL=redis://localhost:6379` in `.env` — Valkey speaks the Redis wire protocol, hence the `redis://` scheme.

## Where to go next

- `docs/BUILD-PLAN.md` — the build sequence (start = the real-time netcode spike).
- `docs/REALTIME.md` — the real-time world / netcode / scaling architecture.
- `docs/TECH-STACK.md` — the decided stack + versions.
