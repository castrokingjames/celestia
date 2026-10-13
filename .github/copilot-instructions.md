# Celestia — Copilot instructions

> GENERATED SUMMARY of `AGENTS.md` + `.context/` (Copilot can't crawl `.context/`). Regenerate with the `sync-copilot-instructions` skill when `.context/` changes. Each bullet cites its authoritative source; **the source wins on conflict.**

## Project
- Celestia is a real-time MMO + reusable multi-game engine; server-authoritative, event-sourced, intents-only. `Source: AGENTS.md#Mission`
- Monorepo: pnpm + Turborepo, Node 22, TypeScript 5.7. Build/test: `pnpm build|test|lint|typecheck` (turbo). `Source: AGENTS.md#Build`
- `services/` = runnable processes (`realtime` now), `packages/` = shared libs, `client/godot/` = Godot. `Source: .context/architecture/modules.md`

## Guardrails (non-negotiable)
- Client is never trusted — intents carry ids/indices/typed args, never amounts/prices/balances/state; the server computes numbers. `Source: .context/architecture/guardrails.md#G1`
- The LLM never writes state — it proposes within sim-authored bounds; the TCB validates and owns truth. `Source: .context/architecture/guardrails.md#G2`
- Engine packages never import a game module. `Source: .context/architecture/guardrails.md#G3`
- Event-sourced truth — append-only `log.event`; pure reducers; replay never re-infers. `Source: .context/architecture/guardrails.md#G4`
- One `EconomyService` chokepoint; integer money (`bigint`/`NUMERIC(38,0)`). `Source: .context/architecture/guardrails.md#G5`
- `can()` deny-by-default before enumerate/execute; resolve from authoritative state, not the client. `Source: .context/architecture/guardrails.md#G6`
- Ports/adapters — only the composition root / `Jupiter` names a concrete adapter. `Source: .context/architecture/guardrails.md#G7`
- No secrets in code. `Source: .context/architecture/guardrails.md#G8`
- Determinism — fixed timestep, seeded RNG, no wall-clock in reducers. `Source: .context/architecture/guardrails.md#G9`
- Structure: `services/` not `apps/`, role-named (`realtime`), no `-server` suffix. `Source: .context/architecture/guardrails.md#G10`

## Conventions
- No magic values / bare wire strings — name them or source from `@celestia/net-contract`/config. `Source: .context/conventions/formatting.md`
- ESM + NodeNext: relative imports end in `.js`; `strict` on; no `any`/`@ts-ignore` without a reason. `Source: .context/conventions/formatting.md`
- Shared-by-≥2-services logic → a `package/`; one entry point per service. `Source: .context/conventions/organization.md`
- Rejections are typed reason codes, never silent drops or `-1`; fail closed on cognition (abstain → scripted). `Source: .context/conventions/error-handling.md`

## Working principles
- Lean/YAGNI; seams before content; prove the risky unknown first; match surrounding code; report honestly. `Source: AGENTS.md#Working-principles`
