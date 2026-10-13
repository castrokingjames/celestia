<!-- Generated 2026-10-11 by a multi-agent pass: 4 client surfaces -> abstraction/thinness/web-export critic -> synthesis. The Godot Jupiter facade. -->

# CLIENT-SDK.md — Celestia Godot Client SDK

**Status:** Authoritative. Reconciles AUTH.md, SDK.md §4–5, PLATFORM.md §3.5, TECH-STACK. Supersedes the four surface drafts and folds in the adversarial critique. Where a surface draft and the critique disagreed, **the critique wins** and the resolution is noted inline.

---

## 1. Thesis

There is **one** thing the game touches: the `Jupiter` autoload. From the login screen through the 60fps render loop, the game calls Jupiter methods and reacts to Jupiter signals. It never sees a token, a cookie, a connect-ticket, a `wss://` URL, colyseus.js, a `WebSocketPeer`, `JavaScriptBridge`, a DOM `<input>`, or the OAuth-redirect/boot-resume dance.

Four properties define the SDK:

- **One facade.** `Jupiter` re-exposes a small, stable surface (§2). Everything else — ports, modules, adapters — is internal.
- **Adapters swapped by host at a composition root (§5).** The game never calls `OS.has_feature()` and never branches on host. Exactly two files name a concrete adapter class: `jupiter.gd` and the adapter itself.
- **THIN: pipe + contract, not game logic.** The SDK moves bytes, custodies tokens, interpolates numbers, and manages a text box. It never judges legality, computes an economy number, parses a JWT claim, decides which zone you go to, or evaluates what an NPC does. All of that is server-side TCB (`enumerate`/`execute`) or the GameModule's render package. §7 is the ruthless boundary.
- **Kept in contract with the server (§6).** Live state via colyseus.js **schema reflection** (no GDScript codegen); all constants (intent types, reason codes, WS close codes, state/intent field names, `protocolVersion`) via the committed, git-diff-gated `gen/celestia_contract.gd`; REST shapes hand-kept behind a CI contract test; a `protocolVersion` handshake at connect forces an update on mismatch.

**Web-export reality, stated up front.** The flagship runtime is a **single-threaded Godot 4.5 WebGL2 web export**. The transport (colyseus.js) and all browser I/O are driven through `JavaScriptBridge`, **which exists only in the HTML5/WASM export** — it is `null` in the editor and on native. This single fact is why `ITransport`, `AuthClient`, and `ITextEntry` are ports/strategies at all: the dev-JSON transport + dev-stub auth + Godot `LineEdit` input are the credible second implementation that lets netcode and the dialogue loop iterate from the Play button, and the replay-mock is the third for headless tests. Three web-export truths shape every surface below:

1. **Web OAuth is a top-level navigation that tears down the WASM heap.** No `await` survives it. The public API is therefore **signal-driven, never await-return** (critique fix, §2/§4.1).
2. **`JavaScriptBridge.create_callback()` refs must be retained for the lifetime of the thing that uses them, or JS GC silently drops them** — deltas stop, keystrokes die, auth hangs, with no error. Every adapter pins its callbacks.
3. **One thread.** colyseus.js and DOM callbacks fire on the WASM main-loop thread. Handlers are O(1) enqueue-only; a sync `JavaScriptBridge.eval` in a hot path stalls the frame. Interpolation runs on the render tick, never in the callback.

---

## 2. The game-facing API at a glance

This is the entire surface a game ever uses. Everything is on the `Jupiter` autoload. **All lifecycle outcomes arrive as signals; calls do not return outcomes.**

```gdscript
# ── Bootstrap (once) ───────────────────────────────────────────────
Jupiter.register_game(module: Object) -> void      # BEFORE init(); hands over the render/input package
Jupiter.init(cfg: CelestiaConfig = null) -> void       # detect host, wire adapters; emits sdk_ready

# ── Identity (fire-and-forget; react to signals only) ──────────────
Jupiter.login(method := &"") -> void                # &""=host default · &"discord" · &"dev" · &"magic_link"
Jupiter.logout(scope := &"local") -> void           # &"local" | &"all"

# ── Session lifecycle (void; outcome is signal-only) ───────────────
Jupiter.enter(zone := &"") -> void                  # /play + ticket + handshake + join, hidden
Jupiter.change_zone(zone: StringName) -> void       # client-initiated handoff intent
Jupiter.leave() -> void                             # consented disconnect

# ── The one write ──────────────────────────────────────────────────
Jupiter.send_intent(type: StringName, args := {}, echo := {}) -> int   # returns local seq

# ── Read-only authoritative state ──────────────────────────────────
Jupiter.entities    # EntityView: snapshot/sample/watch + add/change/remove signals
Jupiter.renderers   # RenderBinder: bind(archetype, scene) + mount(root)
Jupiter.dialogue    # DialogueClient: start/say/close + show_input/hide_input
Jupiter.net_clock   # NetClock: render_time_ms() for interpolation (NOT game-time-of-day)

# ── Synchronous UI-gating queries ──────────────────────────────────
Jupiter.is_authenticated() -> bool
Jupiter.current_user() -> Dictionary                # {id,name,avatar} projection ONLY — never claims/ent
Jupiter.is_connected() -> bool
Jupiter.connection_state() -> int                   # ConnState enum
Jupiter.current_zone() -> StringName
Jupiter.clock_offset_ms() -> int
```

### Signals (declared **once**, in `jupiter.gd` — see the drift gate in §6)

```gdscript
# identity
signal logged_in(user: Dictionary)                   # {id,name,avatar} — NEVER a token/claim
signal logged_out()
signal auth_failed(reason: StringName)               # vocab from CelestiaContract, not invented

# connection lifecycle
signal connecting(zone: StringName)
signal connected(zone: StringName, server_tick: int, clock_offset_ms: int)
signal reconnecting(attempt: int, max_attempts: int)
signal resumed(zone: StringName)                     # same seat; NEVER resets collections (contract, §4.3)
signal zone_changed(from: StringName, to: StringName)
signal disconnected(reason: StringName)
signal banned(reason: StringName)
signal revoked(reason: StringName)

# ONE unified protocol-drift escape hatch (collapses S1/S2/S4 variants). NEVER auto-retries.
signal needs_update(client_pv: int, server_pv: int)

# state
signal entity_added(coll: StringName, id: String, snap: Dictionary)
signal entity_changed(coll: StringName, id: String, changes: Dictionary)   # DELTA fields only
signal entity_removed(coll: StringName, id: String)
signal collection_reset(coll: StringName)            # ALWAYS precedes a re-add storm (contract, §4.3)

# intents
signal intent_acked(seq: int)
signal intent_rejected(seq: int, type: StringName, reason: StringName)   # incl. &"unknown_type"

# dialogue (also mirrored on Jupiter.dialogue)
signal dialogue_opened(conv_id: String, npc_id: String)
signal dialogue_delta(conv_id: String, npc_id: String, text: String)
signal dialogue_line(conv_id: String, npc_id: String, line: String)
signal dialogue_typing(conv_id: String, npc_id: String, thinking: bool)
signal dialogue_closed(conv_id: String, reason: StringName)

# cross-cutting
signal sdk_ready(host: StringName)
signal sdk_error(domain: StringName, code: StringName, detail: Dictionary)   # ONE error funnel
signal telemetry(event: StringName, props: Dictionary)                       # host forwards to OTel
```

That is the whole contract: **2 bootstrap calls, 5 lifecycle calls, 1 write, 4 module accessors, 6 queries, and the signal set.**

---

## 3. A worked example — zero plumbing touched

```gdscript
# res://game/boot.gd — the game's entry node. Touches ONLY Jupiter.
extends Node

func _ready() -> void:
    Jupiter.register_game(CozyModule.new())      # render/input package (§5)
    Jupiter.sdk_ready.connect(_on_sdk_ready)
    Jupiter.logged_in.connect(_on_logged_in)
    Jupiter.auth_failed.connect(func(r): $UI.show_auth_error(r))
    Jupiter.needs_update.connect(func(c, s): $UI.show_force_update())   # terminal; never retried
    Jupiter.connected.connect(func(zone, tick, off): $UI.hide_spinner())
    Jupiter.disconnected.connect(func(r): $UI.show_disconnected(r))
    Jupiter.init()                                # host detected inside; no OS.has_feature() here

func _on_sdk_ready(_host: StringName) -> void:
    # On the flagship web host this is ALSO the OAuth boot-resume point: if a cookie/session
    # already exists, logged_in fires right after. There is no `await login()` to break.
    if Jupiter.is_authenticated():
        Jupiter.enter(&"meadow")                  # warm resume
    else:
        $UI.show_login_button()                    # button → Jupiter.login()  (fire-and-forget)

func _on_logged_in(user: Dictionary) -> void:
    $UI.greet(user.name)                           # {id,name,avatar} only
    Jupiter.enter(&"meadow")                       # void; wait for `connected`
```

```gdscript
# res://game/cozy_module.gd — the GameModule render package.
extends Object
class_name CozyModule

func register(sdk) -> void:
    sdk.renderers.bind(&"villager", preload("res://game/view/villager.tscn"))
    sdk.renderers.bind(&"player",   preload("res://game/view/player.tscn"))
    sdk.renderers.mount(get_tree().current_scene.get_node("World"))
    # declare which fields are smoothed; the SDK does the math, the module owns the numbers (§4.3)
    sdk.entities.mark_interpolated(&"villager", CelestiaContract.F_POS, EntityView.Interp.LERP)
    sdk.entities.mark_interpolated(&"player",   CelestiaContract.F_POS, EntityView.Interp.LERP_EXTRAPOLATE)
```

```gdscript
# res://game/view/villager.gd — a bound view node. Reads interpolated state, writes intents.
extends Node2D

var _v: EntityView; var _coll: StringName; var _id: String

func bind_entity(view: EntityView, coll: StringName, id: String) -> void:   # SDK calls this on spawn
    _v = view; _coll = coll; _id = id
    _v.watch(coll, id, CelestiaContract.F_MOOD, _on_mood)        # field name is a codegen constant (§6)

func _process(_dt: float) -> void:
    position = _v.sample(_coll, _id, CelestiaContract.F_POS)     # SAMPLE smoothed fields, never snapshot()

func _unhandled_input(e: InputEvent) -> void:
    if e.is_action_pressed("interact"):
        Jupiter.dialogue.start(_id)                          # streamed LLM dialogue
    elif e.is_action_pressed("give"):
        Jupiter.send_intent(&"give_gift", {"target": _id, "optionIndex": 0})
        # no amount/price computed on-client; the server enumerates legality and the number
```

The game wrote no token handling, no `await`, no reconnect logic, no DOM, no `OS.has_feature`. It reacted to signals and sent typed intents.

---

## 4. The four surfaces

Each surface lists its game-facing API, what it hides, the adapter(s) behind it, and web-export constraints. Ports are swapped at the composition root (§5); modules have one shipping impl and sit on top of a port.

### 4.1 Session & Auth — `AuthClient` port + `Session` module

**Game-facing:** `login(method)`, `logout(scope)`, `is_authenticated()`, `current_user()`; signals `logged_in` / `logged_out` / `auth_failed` / `needs_update`.

**Critique fix — login is fire-and-forget, signal-only.** `login()` returns `void`. On web the Discord redirect is a top-level navigation that destroys the heap, so a `bool`/`await` return is a lie that only "works" under DevStubAuth and breaks on the flagship host. **One shape on every host:** the game calls `login()` and reacts to `logged_in`; on boot the SDK re-emits `logged_in` from the resumed session. There is no code line "after `await login()`."

```gdscript
class_name AuthClient extends RefCounted   # PORT. GDScript has no `interface` → base methods assert(false).
signal _logged_in(user: Dictionary)        # re-emitted as Jupiter.logged_in at the comp root
signal _logged_out()
signal _auth_failed(reason: StringName)
signal _needs_update(client_pv: int, server_pv: int)
func login(method: StringName) -> void:            _abstract()
func logout(scope: StringName) -> void:            _abstract()
func is_authenticated() -> bool:                   return _session.has_access()
func current_user() -> Dictionary:                 return _session.user()
# INTERNAL — called by the connect orchestration ONLY, never the game:
func ensure_fresh_access() -> void:                _abstract()   # single-flight silent refresh
func authorize_connect() -> Dictionary:            _abstract()   # {token, ticket} for auth OPTIONS
func _abstract() -> void: assert(false, "AuthClient is abstract")
```

`Session` is a **module**, memory-only custody: access EdDSA JWT in RAM, `_expires_at_ms` from the response's `expires_in` (the JWT is **never parsed** — parsing couples the SDK to claim shape and tempts reading `ent`). The refresh secret is unreachable to GDScript by design.

**Hides:** the Discord OAuth dance (authorize_url, PKCE, state — all server-side Pattern B); the access JWT (RAM, never on facade/URL/log); the opaque rotating refresh token (web = httpOnly SameSite=Strict cookie on `api.celestia.gg`; Telegram = memory-only); the three return legs collapsed behind one `login()`; the **30s single-use connect-ticket** (`authorize_connect()` → `{token,ticket}` into transport auth options, re-issued every attempt, **never cached, never the URL**, MUST-9); silent refresh with **single-flight coalescing**; the server-side alpha gate (client sees only allow→`logged_in` or deny→`auth_failed(&"not_in_alpha")`, never the `ent` claim); host detection.

**Adapters:**
- **`DevStubAuth`** (editor/native-dev/replay, P0): fabricates a persona or hits `POST /auth/dev`; `authorize_connect()` → `{"dev","dev"}` trusted by the dev transport; refresh is a no-op. **Critique fix:** seeded personas (alice/bob) live in a dev **seed/config file**, not baked into the adapter — no game content ships inside the SDK.
- **`WebAuthAdapter`** (web; also Android TWA, shared Chrome cookie jar): cold boot `GET /auth/session` (cookie rides) → warm resume; no session → `POST /auth/discord/start` then `window.location = authorize_url` (page reload resumes via `GET /auth/session`); `authorize_connect()` → `POST /auth/connect-ticket`. **All auth HTTP rides browser `fetch(…,{credentials:'include'})` via `JavaScriptBridge`**, never Godot `HTTPRequest`, so the httpOnly cookie attaches and stays unreadable.
- **`TelegramAuthAdapter`** (Mini App WebView): `start_param` present → `POST /auth/exchange {handoff_code, init_data, device_secret}`; absent → `/auth/discord/start` then `Telegram.WebApp.openLink` (Discord blocks embedded WebViews) → relaunch with `startapp=<code>`. `device_secret` = CSPRNG in CloudStorage. **Memory-only custody + transparent re-exchange on every cold start is the DEFAULT**, not a fallback — `login()` must make the re-exchange invisible or players perceive "logged out on reopen."

**Deferred:** native OS-secure-storage / loopback is a **fantasy in the shipping topology** (Android/iOS = TWA/WebView = web host). `Session` stays a memory-only module; a `KeychainSessionStore` adapter is born the day a native client is funded, not before.

**Web-export constraints:** bridge adapters are web-only (editor/native fall to `DevStubAuth`); auth HTTP must ride browser `fetch(credentials:'include')`; retain every `create_callback()` ref; OAuth completes via page reload, not an await; single-flight refresh is a **MUST** (two parallel `ensure_fresh_access()` calls presenting the same refresh generation trip reuse-detection and revoke the whole family — AUTH §4.3); `needs_update` from an auth client-too-old rejection funnels to the **one** `needs_update` signal shared with transport (§6), no duplicated handshake.

**Pre-auth status gate (notify up/down) — see `INFRA.md §9`.** Before `login()`, the `io` boot path runs a basic status preflight: it reads the **off-infra aggregated status JSON** (never backend `/health` directly) and tells the player whether game/auth is **up or down** — plus a maintenance notice if flagged — gating the login button. On reconnect it re-runs to disambiguate "server down (us)" vs "your network"; during a live session the WS **connection state** is the truth, not this. Thin: it fetches and displays, never judges. (Full design — health endpoints, the aggregator, and the external status page — lives in `INFRA.md §9`.)

### 4.2 Connection & Transport — `ITransport` port + `ConnectionManager` module

**Game-facing:** `enter(zone)`, `change_zone(zone)`, `leave()`, `is_connected()`, `connection_state()`, `current_zone()`, `clock_offset_ms()`; signals `connecting`/`connected`/`reconnecting`/`resumed`/`zone_changed`/`disconnected`/`banned`/`revoked`/`needs_update`.

**Critique fix — single truth channel.** `enter()`/`change_zone()` return `void`. The earlier `ConnectResult` enum created dual truth (an awaited enum racing the async signals, unreliable across the web navigation anyway). **Signals are the only outcome channel.**

```gdscript
class_name ITransport extends RefCounted   # the dumb pipe; bind DELTAS only across JS↔WASM.
signal entity_added(coll: StringName, id: String, snap: Dictionary)
signal entity_changed(coll: StringName, id: String, changes: Dictionary)
signal entity_removed(coll: StringName, id: String)
signal message(type: StringName, payload: Dictionary)     # dialogue tokens, acks — all ride the ONE WSS
signal opened(server_tick: int, clock_offset_ms: int)     # seeded by a ping handshake (§4.3)
signal closed(code: int, reason: String)
func connect_room(opts: Dictionary) -> void: _abstract()  # {endpoint, room_id, protocol_version, auth:{token,ticket}, reconnect_token?}
func send(type: StringName, payload: Dictionary) -> void: _abstract()
func close(consented: bool) -> void: _abstract()
func _abstract() -> void: assert(false, "ITransport is abstract")
```

`ConnectionManager` (one impl, a module — the swap axis is entirely at `ITransport`) runs the lifecycle inside `enter(zone)`: `auth.ensure_fresh_access()` → `POST /play {Bearer, intent:<zone>}` → `{endpoint, reservation{roomId,processId,publicAddress}, reconnectionToken, zoneId}` → `auth.authorize_connect()` (fresh 30s ticket) → `transport.connect_room({endpoint: reservation.publicAddress, room_id, protocol_version: CelestiaContract.PROTOCOL_VERSION, auth:{token,ticket}})` → on `opened`, store offset, emit `connected`.

**Hides:** colyseus.js `Client`/`Room` and every call; `JavaScriptBridge`; the `WebSocketPeer` poll loop (dev) and canned-frame player (replay); the two-phase `/play` + ticket; the JWT + ticket (into **auth options, never the URL**); `reconnectionToken` + the grace/backoff state machine; the zone-handoff saga (reserve dest → connect dest → leave source) collapsed into **one** `zone_changed`; close-code integers → clean StringName signals; the `protocolVersion` handshake; binary `@colyseus/schema` decode (stays in JS); per-pod `publicAddress` routing.

**Reconnect contract (critique fix — one shape).** On a non-consented close within the grace window the SDK emits `reconnecting` and attempts `room.reconnect(reconnectionToken, …)` with a **fresh ticket**; success → `resumed(zone)`. If the grace expires or the pod is gone it falls through to a `/play` resume that rebuilds from Postgres and fires `collection_reset` + a re-add storm. **The game is given one rule:** `resumed` **NEVER** resets a collection; any rebuild **ALWAYS** emits `collection_reset(coll)` before re-adding. Therefore the game treats every entity reference as **transient across any disconnect** and re-acquires on `entity_added`. No game code needs to distinguish resume-vs-rebuild.

**WS close-code → signal map (codes frozen in `CelestiaContract`, §6):**

| Code | Game signal | Lifecycle action |
|---|---|---|
| 1000 consented | `disconnected(&"consented")` | none |
| 1001/1006 | `reconnecting` → `disconnected(&"network")` | grace resume → `/play` resume |
| 4000 bad/no token | `disconnected(&"bad_ticket")` | refresh + retry once |
| 4010 banned | `banned(&"banned")` | FATAL |
| 4011 session revoked | `revoked(&"session_revoked")` | FATAL → re-auth |
| 4012 ticket invalid/used | `disconnected(&"bad_ticket")` | re-issue ticket + bounded retry |
| 4030 not alpha | `revoked(&"not_in_alpha")` | FATAL → entitlement UI |
| 4031 entitlement revoked | `revoked(&"entitlement")` | FATAL → re-auth |
| protocol-mismatch | `needs_update(client_pv, server_pv)` | **terminal; NEVER auto-retry** |

**Critique fix — policy numbers come from `CelestiaConfig`, not literals.** Grace window, max attempts, backoff, and "retry once on 4000 / bounded retry on 4012" counts live in `CelestiaConfig` so they are tunable without touching the pipe. The *mechanism* is pipe; the *numbers* are config. One spelling per reason StringName, all codegen'd (§6) — no `&"no_alpha"` vs `&"not_in_alpha"` split.

**Adapters:** `ColyseusBridgeTransport` (web + telegram, flagship) · `NativeJsonDevTransport` (editor/native-dev, plaintext JSON over `WebSocketPeer`) · `ReplayTransport` (GUT headless, golden-trace frames).

**Web-export constraints:** colyseus.js loaded in the custom export HTML head, reached via `JavaScriptBridge`, coexisting with the Telegram script and CSP (no COOP/COEP); retain every callback ref (`onAdd`/`onChange`/`onRemove`/`onMessage`/`onLeave`/`onError`) for app lifetime — a dropped ref is "the server went quiet," the highest-severity footgun; **marshal deltas only** (full `room.state` per tick kills mobile WebGL2); single-threaded callbacks must be O(1) enqueue-only; **Telegram WebView backgrounding drops the WS silently** — resume is driven by a page-visibility hook into `ConnectionManager`, and (critique fix) that hook **also forces a clock resync** (§4.3), not only a reconnect; stale CDN/store-cached builds decode against an old schema and are caught **only** by the `protocolVersion` forced-update, which is why `needs_update` must be terminal with no reconnect path re-entering `connect_room`.

**Thinness flag:** `NativeJsonDevTransport` is a dev tool, **not** a shippable native client (no maintained GDScript schema-v3 decoder). The transport golden-trace test (§6) is the only guard against it drifting from the binary path.

### 4.3 World State + Intents — the game-loop pipe (modules on `ITransport`)

**Game-facing:** `Jupiter.entities` (`EntityView`), `Jupiter.send_intent(...)` (`IntentSender`), `Jupiter.renderers` (`RenderBinder`), `Jupiter.net_clock` (`NetClock`). These are **modules, not ports** — the swap already happened at `ITransport`, and there is no credible second GDScript decoder.

```gdscript
class_name EntityView extends RefCounted
enum Interp { HOLD, LERP, LERP_EXTRAPOLATE }
# add/change/remove/collection_reset re-emitted on Jupiter (see §2)
func snapshot(coll: StringName, id: String) -> Dictionary      # discrete fields; local mirror read, no bridge hop
func exists(coll: StringName, id: String) -> bool
func ids(coll: StringName) -> PackedStringArray
func all(coll: StringName) -> Array[Dictionary]
func watch(coll: StringName, id: String, field: StringName, cb: Callable) -> Callable   # returns unsub
func mark_interpolated(coll: StringName, field: StringName, mode := Interp.LERP) -> void
func sample(coll: StringName, id: String, field: StringName) -> Variant   # interpolated value at render-time
```

`EntityView` keeps a plain-GDScript authoritative mirror built from deltas, so reads never re-cross the bridge. Entities are `Dictionary` snapshots keyed by `(coll, id)` — zero codegen, matching whatever the reflected schema yields.

**Critique fix — field names are codegen constants, not magic strings.** `watch`/`sample`/`snapshot` take field names, but the game references `CelestiaContract.F_POS`, `CelestiaContract.F_MOOD` (names-only constants generated into `celestia_contract.gd`, §6). A server rename bumps the structural hash → `needs_update`, instead of `watch` silently returning null forever.

**Critique fix — the two-tier read rule is a hard contract, defaulted by the binder.** Discrete fields → `snapshot()`. Smoothed fields → **must** be read via `sample()` after `mark_interpolated()`, or they stutter at the 2–10Hz tick. Reading a transform from `snapshot()` is a silent visual bug, so **`RenderBinder`-bound view nodes default any `mark_interpolated` field to `sample()`** and the rule is documented loudly at every call site.

```gdscript
class_name IntentSender extends RefCounted      # the ONE intents-out chokepoint, mirrors the server EconomyService
func send(type: StringName, args := {}, echo := {}) -> int:
    if not CelestiaContract.INTENT_TYPES.has(type):
        var seq := _next_seq()
        Jupiter.intent_rejected.emit(seq, type, &"unknown_type")   # typed signal, NOT a silent -1
        return seq
    var seq := _next_seq()
    if not echo.is_empty(): _apply_echo(seq, echo)                  # opt-in, module-fed optimistic overlay
    _t.send(&"intent", {"seq": seq, "type": String(type), "payload": args, "traceparent": _trace()})
    return seq
```

**Critique fix — no hand-typed money denylist.** The earlier `MONEY = ["amount","price","balance","gem","cost","value"]` baked economy schema into the thin SDK and `value`/`cost` are generic enough to refuse a legitimate slider value — a false firewall (the server is the real gate per the thinness table). The denylist is **dropped from the SDK**; the server rejection is authoritative. If a client-side structural guard is ever wanted, it must be a **server-authored, codegen'd list in `celestia_contract.gd`**, never a hand-typed array.

**Critique fix — `send_intent` keeps `seq`, loses the silent `-1`.** `seq` is a local monotonic counter (needed for optimistic-UI correlation), returned so the game can match `intent_acked`/`intent_rejected`. An unknown type is surfaced as `intent_rejected(seq, type, &"unknown_type")` — a typed channel the game cannot forget to check — not a `-1` + `push_error`.

**Reconcile — identity only, no prediction policy (critique fix).** The authoritative mirror is the only truth. The optimistic overlay is opt-in and module-fed; the SDK clears it **strictly on `seq`-ack or matching-delta identity, never on value comparison**, and rolls back on reject. **Easing curves and "smooth-correct" live in the GameModule**, not the SDK — the moment the SDK does value-aware or field-specific reconciliation, movement/prediction policy has leaked.

**NetClock — interpolation timing, not game-time (critique fix).** `opened` seeds the offset from a **short ping handshake** (a single `opened` event can't separate one-way latency); `NetClock` runs **periodic resync** and emits `resynced(offset_ms)`; `render_time_ms() = server_now_ms() - interpolation_delay_ms`. **Numbers are GameModule config**, not SDK literals: `interpolation_delay_ms`, the extrapolation clamp window, and the `Interp` mode come from `CelestiaConfig`/the module (dead-reckoning clamp + delay are game-feel). This is a **transport render clock only** — it is NOT the event-sourced game-time-of-day Clock Authority (that arrives as a `world_clock` state field the module reads like any other). The local 60fps frame never advances canonical game-time.

```gdscript
class_name RenderBinder extends RefCounted
func bind(archetype: StringName, scene: PackedScene) -> void
func mount(root: Node) -> void   # on entity_added → instance scene, call bind_entity(view,coll,id); free on removed
```

**Hides:** schema reflection + callback binding → signals; `JavaScriptBridge` + callback retention (entirely in the bridge transport; these modules touch zero JS); the delta-marshaling boundary; the local mirror; `IntentEnvelope{seq,type,payload,traceparent}` construction + OTel injection; intent-type validation; ack/reject correlation; the ping/offset handshake; the per-entity snapshot ring + lerp/extrapolate sampling; the optimistic overlay machinery; collection reset on rejoin; **holdings arriving as decimal strings** that the SDK never parses into client-side money math.

**Web-export constraints:** callbacks fire on the WASM thread → delta handlers are O(1) enqueue-only, interpolation runs on the render tick; **deltas only** across the boundary; **cap/batch interpolation work per frame** — per-frame `sample()` lerp across many entities in pure GDScript at MMO zone density is a real mobile frame-budget risk, and `Time.get_ticks_msec()` jitters under GC pauses, so the clock needs the resync + a work cap; Telegram suspend leaves a **stale clock** → the visibility hook forces a resync, not just a reconnect.

### 4.4 Dialogue — `DialogueClient` module + `ITextEntry` strategy

**Game-facing:** `Jupiter.dialogue.start(npc, opts)`, `.say(text)`, `.close()`, `.show_input(opts)`, `.hide_input()`, `.set_input_control(ctrl)`, `.is_active()`; signals `dialogue_opened`/`dialogue_delta`/`dialogue_line`/`dialogue_typing`/`dialogue_closed`/`dialogue_error` plus `player_line_submitted`.

System-2 tokens arrive as **plain room `message`s over the one WSS** (a client-held SSE/gRPC stream is forbidden — WebView buffering stalls it). `DialogueClient` filters `dialogue.*` message types from `CelestiaContract` and re-emits typed signals. Player utterances go through `IntentSender` (so dialogue inherits whatever write discipline the pipe has), **never `transport.send` directly.**

```gdscript
class_name DialogueClient extends RefCounted
func start(npc_id: String, opts := {}) -> void:      # critique fix: returns void — ONE conv id (the server's)
    _intents.send(&"dialogue.open", {"npc": npc_id})  # server runs proximity / NPC-busy enumerate(); emits dialogue_opened
    if opts.get("use_builtin_input", false):          # critique fix: DEFAULT FALSE — game decides UI flow
        show_input(opts)
func say(text: String) -> void:  _intents.send(&"dialogue.say", {"conv": _conv, "text": text})
func show_input(opts := {}) -> void: _input.open(opts)
func set_input_control(ctrl: Control) -> void: _input.track(ctrl)   # critique fix: anchor to a node, not a Rect2
func close() -> void: _input.close(); _intents.send(&"dialogue.close", {"conv": _conv})
```

**Critique fix — one conversation id.** `start()` returns `void`. The authoritative conv id arrives on `dialogue_opened` and is the only id ever used; the SDK correlates request→first-token internally. The game never swaps a client id mid-flight.

**Critique fix — overlay anchors to a Control node.** `set_input_control(ctrl)` tracks a Godot `Control`; the SDK maps its global rect to DOM/CSS pixels every frame and on layout change. The game never thinks in rects or re-anchors manually, and the DOM-sibling-over-canvas reality never leaks into game UI code.

```gdscript
class_name ITextEntry extends RefCounted   # STRATEGY field on DialogueClient, deliberately NOT a catalogued port
signal submitted(text: String)
signal changed(text: String)
signal dismissed()
func open(opts: Dictionary) -> void: _abstract()
func track(ctrl: Control) -> void:    _abstract()
func close() -> void:                 _abstract()
func _abstract() -> void: assert(false, "ITextEntry is abstract")
```

**Strategies:** `GodotLineEditInput` (editor/dev/replay — a real `LineEdit` on a CanvasLayer; lets the dialogue flow iterate from the Play button) and `HtmlOverlayInput` (web/telegram only — a DOM `<input>` that is a **sibling of the WebGL2 canvas**, because Godot cannot render HTML and Godot's own web text input/IME is unreliable).

**Critique fix — persistent input + callback set, not per-dialogue.** `HtmlOverlayInput` creates the `<input>` and its `input`/`keydown`/`blur` listeners **once at construction** and pins them in a held array for the app lifetime; `open()`/`close()` only show/hide and focus/blur. Creating callbacks per `start()` either grows `_held` unboundedly (memory/callback leak on mobile) or, if freed, GCs the callbacks and silently kills keystrokes. One persistent set avoids both.

**Hides:** colyseus.js message plumbing; the DOM `<input>` lifecycle (`createElement`, absolute positioning over the canvas, `getBoundingClientRect` + `devicePixelRatio` scaling, z-index, removal); focus/blur orchestration (focus to summon the soft keyboard; blur + `canvas.focus()` on close so WASD/hotkeys resume); keyboard safe-area math (`window.visualViewport` on web; `Telegram.WebApp.viewportStableHeight` + `viewportChanged` in the Mini App); `create_callback` lifetime; `call_deferred` bouncing of resolved JS events so a callback never re-enters Godot mid-frame; tokens riding the one WSS as `dialogue.*` deltas; routing utterances through `IntentSender`.

**Web-export constraints & gates:** retain callbacks; use `visualViewport.height/offsetTop` (web) and `viewportStableHeight` + `viewportChanged` (Mini App), re-anchor on every resize — positioning against `window.innerHeight` hides the input behind the keyboard; `close()` must blur + hide + refocus the canvas or a left-focused `<input>` eats game keys; tokens as per-fragment deltas, never re-marshalling the transcript each token; **z-index/stacking over the canvas and old-Android `visualViewport` absence are only caught by a manual on-device web smoke test** — this stays an explicit CI/release-checklist gate (no editor repro, since `GodotLineEditInput` ignores the anchor).

**Absent by design — no `candidate_intents` surface.** System-2 candidate intents are emitted server-side and re-validated by the room-TCB (`onDialogueIntents`). The client only ever receives already-resolved reply text plus state deltas. The client is a dumb renderer; if `DialogueClient` ever exposed or evaluated candidate intents, the client would become a decision-maker — a **trust violation**, not just a thinness leak.

---

## 5. The composition root

```gdscript
# res://addons/jupiter/jupiter.gd   (Autoload "Jupiter")  — "Astrolabe" is the engine-internal codename.
extends Node

var transport: ITransport
var auth: AuthClient
var entities: EntityView
var intents: IntentSender
var dialogue: DialogueClient
var renderers: RenderBinder
var net_clock: NetClock
var _conn: ConnectionManager
var _host: StringName = &""
var _cfg: CelestiaConfig
var _game: Object
var _held_cbs: Array = []            # RETAIN every create_callback() ref for app lifetime (silent-GC footgun)

func _ready() -> void:
    renderers = RenderBinder.new()   # autoload stays INERT until the game calls init()

func register_game(module: Object) -> void:   # call BEFORE init()
    _game = module

func init(cfg: CelestiaConfig = null) -> void:
    _cfg = cfg if cfg != null else CelestiaConfig.load()
    await _resolve_host(_cfg)        # critique fix: AWAIT the Telegram-ready gate before host resolution
    net_clock = NetClock.new(_cfg)
    var text_entry: ITextEntry
    match _host:                     # host_override → web+telegram-sniff → editor → native_dev → replay
        &"editor_dev", &"native_dev":
            transport  = NativeJsonDevTransport.new()
            auth       = DevStubAuth.new(_cfg, Session.new())
            text_entry = GodotLineEditInput.new()
        &"replay_test":
            transport  = ReplayTransport.new(_cfg.replay_trace)
            auth       = DevStubAuth.new(_cfg, Session.new())
            text_entry = GodotLineEditInput.new()
        &"telegram":
            transport  = ColyseusBridgeTransport.new(_held_cbs)
            auth       = TelegramAuthAdapter.new(_cfg, Session.new(), _held_cbs)
            text_entry = HtmlOverlayInput.new(&"telegram", _held_cbs)
        &"web":                      # Android TWA resolves here (shared cookie jar)
            transport  = ColyseusBridgeTransport.new(_held_cbs)
            auth       = WebAuthAdapter.new(_cfg, Session.new(), _held_cbs)
            text_entry = HtmlOverlayInput.new(&"web", _held_cbs)
    intents   = IntentSender.new(transport)
    entities  = EntityView.new(transport, net_clock)
    dialogue  = DialogueClient.new(transport, intents, text_entry)
    _conn     = ConnectionManager.new(transport, auth, net_clock, _cfg)
    _rewire_signals()                # adapter/module private signals → the ONE public signal set (§2/§6)
    if _game and _game.has_method("register"):
        _game.register(self)         # module.register(sdk) → renderers.bind(...)/mount(...)/mark_interpolated(...)
    sdk_ready.emit(_host)
```

**Host detection order (critique fix — exact, and the Telegram sniff must not race the script).** `host_override` → `web` feature **with** `window.Telegram.WebApp` present → editor → native_dev → replay flag. Because a Mini App is `OS.has_feature("web") == true`, resolving the host **before `telegram-web-app.js` executes** mis-wires `WebAuthAdapter` + the wrong viewport source (input hidden behind the keyboard). `_resolve_host()` therefore **gates on a Telegram-ready callback (or bounded poll)** before deciding web-vs-telegram.

**Adapter wiring table:**

| Host / build | Transport | AuthClient | ITextEntry | Selected by |
|---|---|---|---|---|
| web (`play.celestia.gg`) | `ColyseusBridgeTransport` | `WebAuthAdapter` | `HtmlOverlayInput` | `web` feature, no Telegram |
| telegram (Mini App) | `ColyseusBridgeTransport` | `TelegramAuthAdapter` | `HtmlOverlayInput` | `web` feature + Telegram ready |
| editor / native dev | `NativeJsonDevTransport` | `DevStubAuth` | `GodotLineEditInput` | `JavaScriptBridge` absent |
| tests (GUT headless) | `ReplayTransport` | `DevStubAuth` | `GodotLineEditInput` | replay flag |

**GameModule registration.** `register_game(module)` before `init()`; inside `init()` the SDK calls `module.register(self)`, where the module binds archetype→scene, mounts a root, and declares interpolated fields. The SDK then wires module callbacks to module/port signals so the module **never subscribes to the transport** and never names an adapter. The module touches only `entities`, `intents`, `dialogue`, `renderers`, `net_clock`.

---

## 6. Kept-in-contract (drift gates)

Three contract mechanisms, each with the critique's gates folded in:

**(a) Live state via schema reflection — no GDScript codegen.** colyseus.js decodes `@colyseus/schema`; the bridge marshals deltas as untyped `Dictionary`. There is deliberately **no** generated decoder (none could be a credible second impl). The acknowledged cost: a server field rename reaches the game as a silently-null read. Mitigation is the structural hash below, plus field-name constants.

**(b) `gen/celestia_contract.gd` — committed, git-diff-gated codegen.** Everything stringly is a generated constant, **one spelling, no hand-typed literals in any surface** (critique fix for the `not_in_alpha`/`no_alpha`, `session_revoked`/`session` splits):
- `INTENT_TYPES`, `REASON_CODES`, WS close codes, `MSG_DIALOGUE_*` message types.
- **State field-name constants** (`F_POS`, `F_MOOD`, …) so the game never writes a magic string.
- `PROTOCOL_VERSION`, with a **structural hash folded into it** computed over **field names** (not just types) for both **state shapes and intent payload shapes** (critique fix — intent args were previously ungated; now an arg rename bumps `protocolVersion` → `needs_update`, same mechanism as state fields). A CI job regenerates the file and **fails the build on an un-reviewed diff.**

**(c) `protocolVersion` handshake.** The client sends `CelestiaContract.PROTOCOL_VERSION` in the join auth options; the server compares and the structural hash is **asserted equal at the join handshake** (confirm it is actually asserted, or renames slip). Mismatch → the **one** `needs_update(client_pv, server_pv)` signal, which is **terminal and never auto-retries** (a stale CDN/store-cached build would otherwise loop forever).

**(d) REST contract test — against the live endpoint.** `/play`, `/auth/*`, and `/auth/connect-ticket` shapes are hand-kept GDScript builders. The CI test must **exercise the running server (or assert handler == decorator)**, not merely diff against the `@nestjs/swagger` doc (critique fix — a handler can change while its Zod/Swagger decorator doesn't, drifting behind a green test; `publicAddress`/`reservation` renames must not slip).

**(e) Transport golden-trace test.** A committed binary-path trace replayed through `ReplayTransport` guards `NativeJsonDevTransport` and the bridge from drifting apart in delta/signal shape.

**(f) SDK self-drift gate (critique fix — the facade had internal client/client drift).** The three drafts declared three incompatible `needs_update`/`connected`/`login`/`logged_in` signatures. Resolution: **every signal is declared exactly once in `jupiter.gd`** (the signatures in §2 are canonical), and a CI test (GDScript parse assert) checks the shipped autoload's signal set against a **committed signature manifest**. The facade that prevents client/server drift must not itself drift.

---

## 7. Thinness boundary + top risks

**The litmus test:** the SDK may move bytes, custody tokens, interpolate numbers, and manage a text box. The moment it **judges** a legality, **computes** an economy number, **parses** a JWT claim, **decides** a zone, **evaluates** what an NPC does, or **filters** player text, game logic has leaked into the pipe.

**Confirmed leaks caught and removed (from the critique):**

| Leak | Resolution |
|---|---|
| `await login()`/`connect() -> enum` outcome channels | Removed. Fire-and-forget + signal-only; one shape on every host. |
| Entity field magic strings | `CelestiaContract.F_*` constants + structural-hash gate. |
| Resume-vs-rebuild two shapes | One contract: `resumed` never resets; reset always precedes re-add; refs transient. |
| Two conversation ids | One server-issued id; `start()` returns void. |
| `send_intent` silent `-1` + raw wire seq | `seq` kept for optimistic UI; unknown type → `intent_rejected(&"unknown_type")`. |
| Hand-typed money denylist in the SDK | Dropped; server is the real firewall (or a codegen'd server-authored list). |
| Optimistic reconcile = prediction policy | Clear on seq/delta **identity only**; easing in the GameModule. |
| Dead-reckoning clamp / interp delay / mode as SDK constants | GameModule/`CelestiaConfig` config; SDK does math, owns no numbers. |
| Retry/grace/backoff literals | `CelestiaConfig`; mechanism is pipe, numbers are config. |
| SDK auto-opens the text box | `use_builtin_input` defaults **false**; game drives UI flow. |
| Seeded personas in `DevStubAuth` | Dev seed/config file; no game content in the SDK. |
| Overlay `set_input_anchor(Rect2)` | `set_input_control(Control)`; SDK tracks the node. |

**Server-authority leaks the SDK must refuse to grow:** zone-assignment policy (continuity/party/load/region — `enter`/`change_zone` pass a zone *intent* only); any `ent`/alpha/entitlement check (allow/deny only, never read the claim); `candidate_intents` evaluation (a trust violation, not just thinness); affection/relationship numbers, NPC-busy, proximity/eligibility, turn-taking, persona/dialogue assembly; client-side moderation/profanity (server `ModerationProvider`; `max_len` is a UX guard only); authoritative conversation/transcript state (server owns the conv id; transcript is a GameModule render concern). The only locally-owned "rule" is a pure-UX input-lock while `dialogue_typing` is true.

**Top web-export risks + mitigations:**

1. **`create_callback` silent GC** (deltas stop / keystrokes die / auth hangs, no error). → Every adapter pins refs in a lifetime-held array; `HtmlOverlayInput` uses one persistent input+callback set. **Highest-frequency bug on this stack.**
2. **OAuth navigation tears down the heap.** → Signal-driven API; boot is the resume point via `GET /auth/session`.
3. **Single thread.** → O(1) enqueue-only handlers; no sync `JavaScriptBridge.eval` in hot paths; cap/batch per-frame interpolation.
4. **Telegram suspend/resume** drops the WS silently **and** staleness the clock. → Visibility hook forces **reconnect + clock resync**.
5. **Telegram host-sniff race.** → `init()` gates on Telegram-ready before host resolution.
6. **Soft-keyboard viewport + z-index/stacking.** → `visualViewport` / `viewportStableHeight` re-anchoring; **manual on-device web smoke test is a mandatory release gate** (no editor repro).
7. **Stale cached build decodes old schema.** → `protocolVersion` forced-update, **terminal, never auto-retried**.
8. **Single-use connect-ticket.** → Re-issued every join **and** every reconnect attempt; never cached (reuse → 4012 loop).
9. **Single-flight refresh.** → `Session` coalesces concurrent refreshes (parallel calls → reuse-detection revokes the family).

**P0 (ship-blocking):** `Jupiter` facade + signal manifest + self-drift gate; `ITransport` with `ColyseusBridgeTransport` + `NativeJsonDevTransport`; `ConnectionManager` lifecycle + reconnect contract + close-code map; `AuthClient` with `WebAuthAdapter` + `DevStubAuth`; `EntityView` + `IntentSender` + `RenderBinder` + `NetClock` (ping handshake + resync + per-frame work cap); `DialogueClient` + `HtmlOverlayInput` (persistent) + `GodotLineEditInput`; `celestia_contract.gd` codegen + `protocolVersion` handshake + REST live-endpoint contract test + golden-trace test.

**P1:** `TelegramAuthAdapter` + Mini App viewport handling; `ReplayTransport` + full replay suite; single-flight refresh hardening; `CelestiaConfig`-driven policy tuning.

**Deferred (fantasy in the shipping topology — build when funded, not before):** native OS-secure-storage / loopback auth; a maintained GDScript schema-v3 decoder / shippable native production transport. `Session` and the dev transport stay single-adapter modules until a real native client exists.


---

## 8. Packaging — Jupiter + its moons (modules)

The client SDK is **Jupiter** (the facade autoload). Internally it is **chunked by functionality**, each module a *moon* of Jupiter. A game uses the `Jupiter.*` facade for convenience, or pulls a single `jupiter/<moon>` module.

| Module | Moon | Core / opt | What it is |
|---|---|---|---|
| auth / session | `jupiter/io` | **core** | login, token custody, refresh, per-host `AuthMethod`; pre-auth up/down status gate (INFRA §9) |
| transport | `jupiter/europa` | **core** | `ITransport`: colyseus.js-bridge (web) / native-JSON dev / replay-mock |
| state | `jupiter/ganymede` | **core** | read-only `WorldView` + interpolation (Ganymede = largest moon → the big state view) |
| intents | `jupiter/callisto` | **core** | typed intents out |
| contract | `jupiter/metis` | **core** | binds the shared `celestia_contract.gd` constants + protocolVersion handshake |
| dialogue | `jupiter/amalthea` | optional | System-2 stream + HTML `<input>` overlay |
| wallet (web3) | `jupiter/thebe` | optional | ownership-read + deposit (TON Connect) |

The facade `Jupiter` composes the **included** moons; optional moons add `Jupiter.dialogue` / `Jupiter.wallet` only when present.

```gdscript
# facade (most games):
Jupiter.login();  Jupiter.send_intent("plant", {...})
# or a single module (a tool/companion that only needs one):
jupiter/io      -> JupiterIo.login()
jupiter/europa  -> JupiterEuropa.connect(...)
```

**Godot packaging reality:** `addons/jupiter/` with submodule folders (`io/`, `europa/`, `ganymede/`, …) + the `Jupiter` facade autoload. "Chunking" = separable submodules excluded from the export preset when unused + conditional JS injection (`colyseus.min.js` is core via `jupiter/europa`; `tonconnect.js` loads only if `jupiter/thebe` is on; the overlay JS only if `jupiter/amalthea` is on). The shared contract constants stay `celestia_contract.gd` (Celestia-level), consumed by `jupiter/metis`.

