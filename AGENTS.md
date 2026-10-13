# AGENTS.md — Celestia agent baseline

> The single, tool-neutral source of truth for any AI agent working in this repo (Claude Code, Copilot, Gemini, Cursor…). `CLAUDE.md` and `GEMINI.md` are thin imports of this file. Deep rules live in `.context/`; design decisions live in `docs/`. **On any conflict, the cited `.context/` or `docs/` file wins.**

## Mission

Celestia is a **real-time MMO** (real-time directional movement, basic hack-and-slash) that is also a **reusable multi-game engine**. The engine is genre-neutral; each game is a module on top of it. Server-authoritative, event-sourced, intents-only.

## Build / test / lint

Monorepo: **pnpm + Turborepo**, **Node 22**, **TypeScript 5.7**.

```bash
pnpm install                                   # (pnpm comes via corepack if not on PATH)
pnpm infra:up                                  # Postgres(+Valkey) via docker compose
pnpm --filter @celestia/atlas dev           # 20 Hz zone server on :2567 (GET /health)
pnpm build | pnpm typecheck | pnpm lint | pnpm test   # turbo across the workspace
```

If `turbo` can't find the pnpm binary, run `corepack enable` first (puts pnpm on PATH).

## Service / package map

| Path | What | Status |
|---|---|---|
| `services/atlas` | **Atlas** — realtime world-server (TCB): Colyseus 20 Hz authoritative sim, rooms, intents, connect-ticket `onAuth` | **now** |
| `packages/net-contract` | shared wire contract (`PROTOCOL_VERSION`, intent types) | **now** |
| `client/phaethon/` | throwaway netcode POC — Vite + Phaser + colyseus.js | **now (POC)** |
| `client/astrolabe/` | Godot 4.5 client — the **Jupiter** SDK (destination client) | later |
| `services/polaris` | **Polaris** — meta tier (Fastify HTTP): auth, accounts, sessions, connect-ticket; later matchmaking/social | **now** (auth live) |
| `services/cognition` | LLM gateway (Mercury/Calliope) | later (P2; in-process module until then) |
| `packages/{ledger,event,authz}-contract` | EconomyService, event registry, `can()` | later (seams) |

`services/` = runnable backend processes · `packages/` = shared libraries you import · `client/phaethon/` = the throwaway netcode POC · `client/astrolabe/` = the Godot destination client. See `.context/architecture/modules.md`.

## Guardrails (NON-NEGOTIABLE — see `.context/architecture/guardrails.md`)

1. **Client is never trusted.** Intents only; they carry **indices / typed args / ids — NEVER amounts, prices, balances, or state**. The server enumerates legality and computes every number.
2. **The LLM never writes state.** It *proposes within sim-authored bounds*; the deterministic TCB validates and owns truth. It never mints currency, fires an unvalidated event, grants an arbitrary reward, or acts as an authz principal.
3. **Engine ↛ game module.** Genre-neutral engine packages must **never** import a game module (e.g. `game-cozy`). Enforced by an arch-test.
4. **Event-sourced truth.** Mutations are append-only events in `log.event` (seq + prev_hash, `UPDATE`/`DELETE` revoked). Replay reads logged oracle outputs; it never re-infers.
5. **One `EconomyService` chokepoint.** All value moves through it; integer money (`NUMERIC(38,0)` / `bigint`); it is the only emitter of `economy.posted`.
6. **`can()` deny-by-default.** Every mutating intent passes `can()` *before* enumerate/execute; `resolveResource` reads scope/owner from authoritative state, **never** from the client envelope.
7. **Ports/adapters.** Only the composition root (server) / `Jupiter` (client) names a concrete adapter class. Callers depend on the port, never a concrete.
8. **No secrets in code.** Ever. Config via env.
9. **Determinism.** Fixed-timestep sim, seeded RNG, no wall-clock inside reducers.
10. **Naming/structure.** `services/` (not `apps/`), never a `-server` suffix. Services are named by their **celestial codename** (`docs/NAMING.md`): `atlas` (world-server), `polaris` (meta), cognition later (`mercury`/`calliope`). "realtime"/"meta" are *function* words in prose; the dir/package IS the codename (`services/atlas`, `@celestia/atlas`).
11. **Client never sets its own privilege.** Identity/role/entitlement are **server-assigned** — an auth/login request carries a credential to verify, never a requested role. Everyone lands at baseline (`terra`); elevation only via an audited admin action by an already-privileged principal (or server-local bootstrap), never self-service. Gating a session (a shared secret like `BASIC_AUTH_SECRET`) ≠ granting a role; **no shareable secret ever grants privilege.** `can()` reads authority from authoritative state, never a client-asserted `role`/claim.

## Working principles

- **Lean / YAGNI.** Build the minimal thing; defer with a trigger. Don't over-scaffold.
- **Seams before content; prove before build.** De-risk the unknown (netcode, calibration) first; lay ruinous-to-retrofit seams into the empty skeleton before pouring features.
- **Match the surrounding code** — comment density, naming, idioms.
- **Report honestly.** If tests fail, say so with output; if a step was skipped, say that.
- **Agent conduct → `.context/conventions/agent-behavior.md`** — the deep, citable version of these principles (verification discipline, minimal-diff/assigned-scope, ask-before-the-irreversible, untrusted-output-is-never-authority). For an agentic repo this is the most load-bearing `.context` doc; read it first.

## Concurrency (parallel agents)

- Parallel agents work in **git worktrees**, each in its **assigned scope only**.
- **Ask before branching or merging.** Never touch another agent's worktree.
- Workflows automate this via `isolation:'worktree'`.

## Git usage

- Commit or push **only when asked**. If on the default branch, branch first.
- No interactive flags. Use `gh` for GitHub operations.
- *(This repo is not yet `git init`-ed; husky hooks activate after that + reinstall.)*

## Documentation index (working on X → read Y)

**Design decisions → `docs/`** · **coding conventions → `.context/`**

| Working on… | Read |
|---|---|
| anything (first) | `docs/PLANNING.md`, `docs/BUILD-PLAN.md` |
| real-time / netcode / tick / zones / AoI | `docs/REALTIME.md` + `.context/architecture/guardrails.md` |
| movement netcode as built / smoothing / jitter | `docs/NETCODE.md` |
| the stack / versions | `docs/TECH-STACK.md` |
| infra / health / status | `docs/INFRA.md` |
| engine vs game-module boundary | `docs/PLATFORM.md` + `.context/architecture/modules.md` |
| the Godot client (Jupiter) | `docs/CLIENT-SDK.md` |
| auth / authz | `docs/AUTH.md`, `docs/AUTHZ.md` |
| LLM behavior / economy / events / quests | `docs/COGNITION.md` |
| the LLM/vector decision mechanism | `docs/DECISIONS.md` |
| web3 / tokens | `docs/WEB3.md`, `docs/WEB3-READINESS.md` |
| open questions / parking lot | `docs/OPEN-QUESTIONS.md` |
| monorepo layout / naming / placement | `.context/conventions/organization.md` |
| **how an agent should work here (conduct)** | **`.context/conventions/agent-behavior.md`** |
| parallel agents / worktrees | `.context/conventions/concurrency.md` |
| TS style / lint / format | `.context/conventions/formatting.md` |
| errors / failure handling | `.context/conventions/error-handling.md` |

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
