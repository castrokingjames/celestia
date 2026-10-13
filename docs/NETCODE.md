# Netcode — movement (as built)

> What's actually implemented for real-time movement (2026-10-13), verified on a **free-tier Render deploy**. Design rationale + the broader world/zone model live in `docs/REALTIME.md` §3; this is the as-built record, the lessons, and what to improve next. Follows Gabriel Gambetta's *Fast-Paced Multiplayer* model, **Parts I–III** (prediction, reconciliation, interpolation); Part IV (lag compensation) is deferred to combat.

## The model in one line

Server-authoritative **20 Hz** sim. **Self = client prediction + server reconciliation** (instant local feel). **Remotes = server-clock snapshot interpolation + velocity extrapolation on underflow** (smooth under jitter).

## Server — Atlas (`services/atlas`)

- **Fixed 20 Hz tick** (`setSimulationInterval` + `setPatchRate`, `TICK_MS = 50`).
- Inputs are **queued on message, drained on the tick** — movement advances on a steady clock, decoupled from message-arrival jitter. That even cadence is *what makes client interpolation smooth*.
- Each tick, per player: `pos += (dir/|dir|) * MOVE_SPEED * clamp(dt, 0, INPUT_DT_MAX)`, and `lastSeq = last applied input seq`. The server **never trusts client `dt`** (clamped) — authority stays server-side (guardrail #1).
- **`state.t`** — a server clock advanced one `TICK_MS` per tick, shipped in every patch. This is the timeline clients interpolate remotes on.
- Join is gated on a one-time connect-ticket (`onAuth`) — see `docs/AUTH.md`.

## Client — Phaethon (`client/phaethon`)

### Self (the local player)
- **Predict:** apply input to the local position immediately each frame → zero perceived input lag.
- **Keep** un-acked commands (`pending`, keyed by `seq`).
- **Reconcile:** on each authoritative patch, snap to the server's `x/y`, then **replay** `pending` where `seq > lastSeq`. Rendered at the predicted position; corrections are invisible because deterministic movement (same `MOVE_SPEED`) means prediction ≈ server, so there's ~nothing to correct.

### Remotes (other players)
- **Buffer:** per remote, a ring of `{ t, x, y }` snapshots, sampled each patch in `room.onStateChange`, timestamped with the **server clock** `state.t` (not packet-arrival time).
- **Clock:** a **smoothed** offset — `serverNow ≈ performance.now() + offset`, nudged toward `state.t − now` each patch (snapped on first sample / large drift). Smoothing stops packet-arrival jitter from re-anchoring the render time (which caused backward hitches early on).
- **Interpolate:** render at `serverNow − INTERP_DELAY_MS`, lerping between the two buffered snapshots that bracket that time.
- **Extrapolate on underflow:** if the server stalls past the buffer, continue the remote at its last-segment velocity for up to `EXTRAP_MAX_MS`, then hold. Hides free-tier server-tick hitches; any overshoot on a direction change self-corrects when snapshots resume.

### Knobs (`client/phaethon/src/main.ts`)
| const | value | trade-off |
|---|---|---|
| `INTERP_DELAY_MS` | 300 | buffer depth — smoothness vs freshness (others shown further in the past) |
| `EXTRAP_MAX_MS` | 150 | glide-through-stall vs overshoot on direction change |
| clock-smoothing factor | 0.05 | tracking speed of the server-clock estimate |

## Why these choices (lessons)

1. **Self ≠ others.** Predict self (you *have* your inputs); interpolate others (you don't). Never interpolate self (adds input lag) or predict others (no inputs to predict from).
2. **Interpolate on the server clock, not arrival time.** Arrival-time interpolation re-injects network jitter — the first version visibly "jumped." The server timeline is even by construction.
3. **The interpolation input must itself be smooth** → the server applies movement on a fixed tick (evenly-spaced snapshots), not per message.
4. **Free tier is a free hostile-network test rig.** Real RTT + jitter + shared-CPU tick-hitches exposed bugs localhost hid (smooth locally, jumpy deployed). We tuned against it: arrival-time → server-clock interpolation → smoothed clock + 300 ms buffer → velocity extrapolation.

## Verified

- `typecheck` + `vite build` green; local headless smoke (self round-trip: auth → ticket → connect → move → reconcile; `x` + `lastSeq` advance).
- Deployed free-tier (Render) two-tab test, iterated until remotes went from hopping to smooth.

## What to improve (beyond paying for CPU)

**Fidelity**
- **Lag compensation (Gambetta Part IV)** — server rewinds to where the shooter saw targets, to validate hits fairly. Needed once combat exists; meaningless for pure movement.
- **Smooth error-correction on self** — reconciliation currently *hard-snaps*; once collisions/knockback make prediction diverge, lerp the correction over a few frames instead of snapping.
- **Tick-aligned / fixed-rate input** — the client sends ~per-frame with variable `dt`; a fixed send rate (or purely direction-based server integration using the server's own `dt`) gives even deltas, cleaner reconciliation, and less speedhack surface.
- **Interpolate facing/animation**, not just position, once entities have them — and per-entity interp profiles (projectiles dead-reckon hard; players interpolate gently).

**Robustness**
- **Adaptive jitter buffer** — size `INTERP_DELAY_MS` from measured inter-arrival variance (minimal latency on good networks, more buffer on bad) instead of a fixed 300 ms.
- **Explicit RTT clock sync** — a ping/pong sampler for a more accurate server-time + one-way-delay estimate, vs deriving it solely from `state.t`.
- **Send real elapsed in state** so the client can scale extrapolation when the server tick actually hitched (partial client-side mitigation of stalls).

**Scale / bandwidth**
- **Area-of-interest filtering (Colyseus `StateView` / sectors)** — send each client only nearby entities. The real scaling lever (`docs/REALTIME.md`); irrelevant at 2 players, essential at hundreds.
- **Patch-rate tiering / snapshot compression** — update distant entities less often; compress payloads.

**Authority / anti-cheat**
- **Server movement validation** — collision grid, speed caps, teleport/path-sanity checks (today it's only a `dt` clamp).

## Not changing

20 Hz tick, server-authoritative, intents-only, WSS — the design (`docs/REALTIME.md`). The residual free-tier *server-tick hitching* is **infra, not code**: a paid/dedicated-CPU atlas is the only cure for that specific jump (no amount of client buffering invents motion the server never produced).
