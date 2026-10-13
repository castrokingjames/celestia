# Celestia — Documentation Index

All design docs for Celestia (real-time MMO + reusable multi-game engine). Where two docs disagree, the more specific/newer one wins and says so in its header.

## Start here
- [PLANNING.md](./PLANNING.md) — roadmap, phases, risks, locked decisions.
- [BUILD-PLAN.md](./BUILD-PLAN.md) — the Phase-0 build sequence (what to build first).

## Architecture
- [ARCHITECTURE.md](./ARCHITECTURE.md) — end-to-end seams; event-log-as-truth; clock authority.
- [REALTIME.md](./REALTIME.md) — **real-time world / netcode / scaling** design (tick, prediction, World>Zone>Sector, AoI, channels). *Supersedes the old cozy/low-tick premise elsewhere.*
- [NETCODE.md](./NETCODE.md) — **movement netcode as built** (predict + reconcile · server-clock interpolation · extrapolation), the lessons, and what to improve. Companion/as-built counterpart to REALTIME.md.
- [TECH-STACK.md](./TECH-STACK.md) — the decided stack + pinned versions + the 4 integration decisions.
- [INFRA.md](./INFRA.md) — lean infra, sizing, scaling path, **§9 health checks & status page**.
- [PLATFORM.md](./PLATFORM.md) — engine ↔ GameModule boundary; reuse across games.

## Client
- [CLIENT-SDK.md](./CLIENT-SDK.md) — the Godot **Jupiter** client SDK (facade + moons).
- [SDK.md](./SDK.md) — ports/adapters; the Phase-0 ports.

## Auth & Authz
- [AUTH.md](./AUTH.md) — authentication spec (Discord OAuth, JWT, tickets, dev/tester path).
- [AUTHZ.md](./AUTHZ.md) — authorization: 3 layers, the one `can()` chokepoint, sanctions.

## Cognition (LLM) & decisions
- [COGNITION.md](./COGNITION.md) — how the LLM integrates across behavior/economy/events/quests.
- [DECISIONS.md](./DECISIONS.md) — the LLM/vector **decision mechanism** (cascade, calibration, flywheel).

## Web3
- [WEB3.md](./WEB3.md) — custodial-first tokenomics (deferred for v1).
- [WEB3-READINESS.md](./WEB3-READINESS.md) — bake-in-now vs defer seams.

## Meta
- [NAMING.md](./NAMING.md) — codename menu + locks: SDK **Jupiter** · services **Atlas** (world) / **Polaris** (meta) · clients **Astrolabe** (Godot) / **Phaethon** (Phaser POC).
- [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) — parking lot for unresolved / needs-analysis items.
