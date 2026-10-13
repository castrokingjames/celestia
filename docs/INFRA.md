<!-- Lean-first infra & sizing for v1/alpha. Complements TECH-STACK.md (full/scale stack) with the deployment reality + sizing + growth path. LLM/web3 are the cost cliffs and are OFF at v1. -->

# Celestia — System Requirements & Infrastructure

**Scope:** what we actually run at v1/alpha, how to size it, and how it grows. Reconciles `TECH-STACK.md` (the full stack choices) with the **lean deployment reality**. The game-server core is cheap; the **LLM (GPU)** and **web3 (chain)** are the step-change costs — both **OFF at v1** (mica-mock in-process; DB-sim economy).

> ⚠️ **AMENDED by `REALTIME.md` (real-time MMO).** The cozy / low-tick sizing below is superseded — `REALTIME.md` is authoritative on sizing where they disagree:
> - **tick 2–10 Hz → 20 Hz** real-time;
> - the "cozy" CCU-per-core numbers → **real-time sizing** with a **load-tested per-channel cap** (target ~1000 CCU/channel, verify by load test);
> - **PM2 multi-core (one process per core)** is the per-box scaling unit; **Redis/Valkey is ON at multi-process** (and included from the start as the ephemeral/cross-process layer — not merely "optional until multi-process");
> - **size for the hub hotspot** (power-law population), not the average.
> The lean / phased / portable philosophy stays; the numbers and the "cheap forever" tone change for real-time load.

## 1. Guiding principles

- **Don't pay for idle compute.** Start on the smallest viable box; scale **on measured signals**, not vibes.
- **Modular monolith on one box at v1.** Scale **vertically (resize)** first, then **horizontally**.
- **Keep it a portable Dockerized VM** (`docker-compose`); no provider-proprietary features → move providers freely (Hetzner ↔ DO ↔ Linode ↔ AWS).
- **The game-server core is cheap and horizontal.** The LLM and web3 are separate cost cliffs — budget them separately, enable them only when earned.

---

## 2. The v1 / alpha footprint — one box

Everything co-hosted on a single VM via `docker-compose` (same compose file = local dev, for parity).

### Running on the box (containers)

| Instance | What | Notes |
|---|---|---|
| **Node app** | NestJS (meta/auth) + Colyseus (realtime rooms) | 1 process (or 2 if split). **Colyseus = one process hosts ALL zone-rooms** (rooms aren't separate processes). |
| **PostgreSQL** | Truth / event-log / ledger / entities | Self-hosted in Docker. Single primary, no replicas at v1. |
| **Valkey (Redis)** | Presence, pub/sub, cache, rate-limit, handoff codes | **Optional until multi-process** — with ONE Colyseus process, in-process state + Postgres suffice. Keep Redis access behind an interface so adding it later is a one-line swap. |
| **Caddy** | Reverse proxy + **automatic TLS** (Let's Encrypt) | **Required** — browsers/Telegram/Discord-OAuth all need HTTPS/WSS. Routes `/api`→NestJS, `wss://`→Colyseus. (nginx/Traefik also work; Caddy is simplest.) |

**In-process (not separate instances) at v1:** `mica-mock` (LLM off), the outbox drain (plain `setInterval`, not BullMQ yet).

### Required but NOT a paid instance
- **TLS cert** — Caddy auto (Let's Encrypt).
- **Postgres backups** — automated `pg_dump` → offsite object storage **+** volume snapshots. **NON-NEGOTIABLE** (a dead box with no backup = total data loss).
- **Domain + DNS** — ~$10–15/yr (`api.*`, `play.*`, …).
- **Discord bot token** — used by **NestJS** for the login-time guild-role check (REST). *No separate process at v1.* The persistent gateway bot (instant role-loss kick) is **deferred** — re-check at login/refresh instead.
- **Minimal logs + a free uptime ping** (UptimeRobot/Hetzner).

### Off-box external (mostly free at alpha)
- **Discord OAuth app** — free (identity provider).
- **Static hosting for the Godot web build + APK** — **Cloudflare Pages/R2 (free, global CDN)**; offloads *all client bandwidth* off the box.
- **Object storage for backups** — Cloudflare R2 (free tier) / Hetzner Storage Box (~€3).
- *(Optional)* email provider — only if using magic-link tester login.
- *(Deferred)* Stripe / Telegram Stars — only when premium currency ships.

### OFF / deferred (NOT running at v1)
GPU/LLM (Mica llama.cpp/vLLM) · chain/web3 (indexer, deposit watcher, hot wallet) · Prometheus/Grafana/Langfuse · dedicated BullMQ workers · PgBouncer · read replicas · multiple Colyseus processes · Kubernetes.

---

## 3. Sizing — spec-based (SKU names churn; size by spec)

Cozy, **low-tick** game (2–10 Hz, small deltas, interest-managed), **LLM/web3 OFF**. CCU figures are **planning estimates — load-test before trusting them** (see §8).

| Stage | Spec to look for | ~Cost/mo | Realistic CCU |
|---|---|---|---|
| **Alpha floor** | ~1 vCPU / **2 GB** | **€3–4** (Hetzner Arm) or **$0** (Oracle free Arm) | dozens → ~a few hundred |
| **Early beta** | ~2–4 vCPU / 4–8 GB | ~€5–10 | ~500 → ~1,500 |
| **Ceiling (self-imposed $20)** | ~8 vCPU / 16 GB | ~€15–20 | ~1,000 → ~2,500 |

Reality check: **alpha is *dozens* of concurrent** (Discord-gated) — you'll run at single-digit % utilization on even the floor box. Resize up **only** when real players arrive.

Planning anchor: **~500–1,000 CCU per vCPU** of Colyseus for a cozy low-tick game (lean state + tight interest management → more; heavy state → less).

---

## 4. RAM vs CPU — which to buy, and when ⚠️ (the thing not to miss)

**There's a crossover. At our stage it's RAM; at scale it's CPU.**

- **Alpha / co-hosted tiny box → RAM-BOUND.** With dozens of players, CPU is nearly idle. The squeeze is fitting **Postgres + Node + Valkey + Caddy + OS** into 1–2 GB; what bites is OOM / Postgres thrashing. → **Favor RAM over cores** (a 1 vCPU/4 GB beats a 2 vCPU/1 GB here). Burstable/shared CPU is fine at this stage.
- **Growth (hundreds+ CCU) → CPU-BOUND.** Colyseus/Node is **single-threaded**; CPU ≈ `clients × tick_rate × per-client work`, and the CCU-per-core ceiling is a *CPU* limit. → **Add cores / split into multiple Colyseus processes**, and give Postgres its own RAM/disk (eventually its own box).

**Per-component resource profile:**

| Component | Binds on | Scaling move |
|---|---|---|
| **Postgres** | **RAM + disk IO** (the main RAM user, every stage) | more RAM/faster disk → eventually its own box |
| **Node / Colyseus** | **CPU** (single thread), modest RAM — the CCU driver | more cores / more processes |
| **Valkey / Caddy** | negligible on both | — |

**Watch these signals (so you know which is biting):**
- RAM pressure → **free RAM / swap usage / Postgres cache-hit ratio**.
- CPU pressure → **CPU % + Colyseus tick-duration p95** ← the single best early-warning that you've crossed from RAM-bound to CPU-bound.

**Rule of thumb: buy RAM now, buy cores at scale.**

**Small-RAM tuning (alpha):** Postgres `shared_buffers ~128 MB`, low `max_connections`, add a little swap. Node + Valkey + Caddy slot in around it.

---

## 5. Provider guidance

- **Cheapest paid → Hetzner Arm (Ampere, CAX-style) shared tier.** Node + Postgres + Valkey all run on **Arm64** (multi-arch Docker); client is unaffected (runs on players' devices). *Verify current SKUs — Hetzner churns names (e.g. CX22 is deprecated); size by spec, not model.*
- **Free → Oracle Cloud Always-Free Arm** (up to 4 cores / 24 GB, free forever). Generous; **caveats:** signup friction, possible idle-instance reclaim, keep backups. Strongest $0 play for alpha.
- **Avoid for this workload:** DO/Linode **cheapest tiers** (RAM-starved — DO $6 = 1 GB), and **managed Postgres** (~$15+ alone blows the budget — self-host in Docker at v1).
- **Cheap-but-oversold alt:** Contabo (works, slower/less reliable).
- **Keep it portable** (Dockerized VM, no proprietary features) → graduate to DO/Linode/AWS **managed services only when scale + HA justify the premium.**

---

## 6. Non-negotiables even at alpha

1. **Automated Postgres backups** — `pg_dump` → offsite object storage **+** volume snapshots. *(The one thing not to skip — single box = single point of data loss.)*
2. **TLS everywhere** — Caddy auto.
3. **Redis access behind an interface** — so "defer Valkey now / add it at multi-process" is a one-line swap.

---

## 7. Scaling path — grow on signals, one step at a time

| # | Step | Trigger signal |
|---|---|---|
| 1 | **Vertical resize** (bigger box, one reboot) | sustained RAM pressure, or CPU % / tick-p95 climbing |
| 2 | **Add Valkey + split Postgres onto its own box** | going multi-process; Postgres contending for RAM/IO |
| 3 | **Multiple Colyseus processes/boxes** (horizontal; Valkey driver + sticky per-pod WS routing) | one core saturated; CCU beyond one box |
| 4 | **PgBouncer + read replicas / partition the event log** | Postgres connection/write pressure (~low-10k CCU) |
| 5 | **Observability stack** (Prometheus/Grafana/Langfuse) | real scale ops |
| 6 | **THE COST CLIFFS: GPU fleet (LLM on) + chain/indexer (web3 on)** | enabling cognition / a real chain — **step-change in cost, separate from the game-server core; budget separately** |

**Elastic cost tip:** Hetzner bills **hourly (capped at the monthly max)** → scale a box up for a known spike (launch, Telegram push) and back down — pay only for the hours used. No autoscaling machinery needed at single-box scale.

---

## 8. Honest caveats

- **One box = no HA.** Fine for alpha (testers reconnect after a blip); **add redundancy before real launch.**
- **CCU numbers are estimates.** The real ceiling depends on state size / tick rate / interest management / intent rate — **run the Week-4 load microbenchmark** (k6 / Artillery / a Colyseus load client) before sizing a fleet.
- **The LLM is the real cost and the real CCU limit *when it turns on*.** The game-server core (Node + Postgres + Valkey + Caddy) stays cheap and horizontal. "Fun with the LLM off" + DB-sim web3 are exactly what keep v1 hosting at **~$0–20/mo**.

---

## 9. Health checks & status page

**One rule:** everything status-facing is **hosted OFF your own infra** (CDN + a free Worker), so it can affirmatively report **DOWN** when the box is down — instead of failing to load along with it.

```
Cloudflare Worker (off-infra)  ── polls each /health on a schedule ──▶ caches one status JSON
                                                                        { auth:"up", game:"up", db:"up", …, updatedAt }
        ▲ reads                                   ▲ reads
  external status page (CF Pages)         Godot client (Jupiter)
   up/down dots, no history               login screen: show auth/game up; on WS drop: disambiguate
```

### 9.1 Health checks (`/health`) — per-process, not centralized
- Each process serves its **own** `/health` **readiness** endpoint: `200` = *can serve* (verifies Postgres — and Redis once multi-process — are reachable), not merely "process alive."
- The **Colyseus** process serves `/health` on its own HTTP server (the one it binds for the WS upgrade + matchmaking) — **from the first server box, no NestJS required.** Do **not** stand up NestJS just to answer a health check.
- **NestJS** serves its own `/health` (via `@nestjs/terminus`, pg/redis indicators) **when it exists**, for the meta-api process.
- Consumed by: the status aggregator (below), the free UptimeRobot ping (§2), and any LB/PM2 liveness probe.

### 9.2 Status aggregator + external status page — up/down only
- An **off-infra aggregator** (free **Cloudflare Worker**) polls each `/health` on a schedule and caches **one small status JSON** (`{ auth, game, db, …: "up"|"down", updatedAt }`). **Single source of truth** — clients never fan out to each backend themselves.
- An **external status page** (free **Cloudflare Pages**, off-infra) reads that JSON and shows **up/down dots** per component. **Up/down only — no uptime %, history, or latency graphs.** Start with one overall "Game" dot; split into per-component dots (game / auth / db / api) as desired.
- Distinct from the deferred Prometheus/Grafana (§7 / TECH-STACK §2f): that is *internal metrics*; this is *public up/down*.

### 9.3 Pre-auth status gate (Jupiter)

Scoped to the **boot / pre-login phase** — a **preflight gate in the connection lifecycle, *before* auth**, not a persistent in-game widget. (During a live session the client uses its **WS connection state**, not this.)

```
boot (client from CDN) → STATUS PREFLIGHT (fetch aggregated JSON, off-infra)
   ├─ up             → proceed to login/auth → connect to game
   └─ down / maint.  → show "servers unavailable / down for maintenance", block login
```

- Reads the **same** aggregated JSON (never polls backend `/health` directly); works even when backends are down because the client (CDN) and the JSON (Worker) are both **off-infra**. Shows "Auth 🟢 · Game 🟢" (or the down/maintenance notice) *before* the player attempts login.
- **Maintenance mode lives here:** the status JSON carries a `maintenance` flag + message, so the gate blocks *new logins* gracefully **without kicking live sessions**.
- **Reconnect:** a mid-session disconnect drops the client back into the (re)connect phase → the preflight re-runs and disambiguates "server down (us)" vs "your network." During a *live* session, WS state only — no polling.
- Cheap: cached read at boot + a 30–60 s refresh while on the login screen; never a live fan-out. Lives in Jupiter's pre-auth boot path, adjacent to the `io`/auth moon (see `CLIENT-SDK.md`).

### 9.4 Timing
An alpha nicety built on `/health`. The **`/health` endpoints exist from the first server box**; the aggregator + external page + in-game reader land at **alpha** (deferred past the netcode gate) and **reuse the Cloudflare Pages + Worker already used for the client** — no new infra, no new paid instance.
