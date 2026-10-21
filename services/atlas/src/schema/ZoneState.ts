// Authoritative room state (synced to clients as binary deltas). Scaffold — one player archetype.
// NOTE: needs experimentalDecorators + useDefineForClassFields:false (set in tsconfig.base.json).
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") lastSeq = 0; // last input command the server has applied — the client reconciles against this
  @type("string") name = ""; // character display name (loaded from game_character on join)
  @type("number") hp = 0; // current health; the server owns it (combat reduces it, respawn resets it) — never client-set
  @type("number") maxHp = 0; // health ceiling (from character/kind stats)
}

// A toggleable world object (the first Fornax interaction). `on` is flipped by the lever action's execute step;
// it's synced, so clients render the state change. Position lets the server gate interaction on reach.
export class LeverState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") on = false;
}

// A non-player entity (monster/NPC). Synced so clients render it off the SAME binary state-sync as players —
// no art on the wire. `kind` is the join point to the client's CDN asset manifest (kind → sprite); the server
// only ever sends data. hp/level feed both combat (Fornax) and the mob's situation frame (Pallas). `action` is
// the current behaviour label the brain chose this tick (idle|wander|flee|attack) — a render hint for the client.
export class MobState extends Schema {
  @type("string") id = "";
  @type("string") kind = ""; // e.g. "rat" — resolves to a CDN sprite client-side
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") level = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("string") action = "idle"; // last decision label (render hint only; truth is the server's)
}

export class ZoneState extends Schema {
  // Server clock (ms), advanced one TICK per 20 Hz step. Clients interpolate remote players on THIS
  // timeline (not packet-arrival time) so network jitter can't make remotes hop. See docs/REALTIME.md §3.
  @type("number") t = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: LeverState }) levers = new MapSchema<LeverState>();
  @type({ map: MobState }) mobs = new MapSchema<MobState>();
}
