// Authoritative room state (synced to clients as binary deltas). Scaffold — one player archetype.
// NOTE: needs experimentalDecorators + useDefineForClassFields:false (set in tsconfig.base.json).
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") lastSeq = 0; // last input command the server has applied — the client reconciles against this
  @type("string") name = ""; // character display name (loaded from game_character on join)
}

// A toggleable world object (the first Fornax interaction). `on` is flipped by the lever action's execute step;
// it's synced, so clients render the state change. Position lets the server gate interaction on reach.
export class LeverState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("boolean") on = false;
}

export class ZoneState extends Schema {
  // Server clock (ms), advanced one TICK per 20 Hz step. Clients interpolate remote players on THIS
  // timeline (not packet-arrival time) so network jitter can't make remotes hop. See docs/REALTIME.md §3.
  @type("number") t = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: LeverState }) levers = new MapSchema<LeverState>();
}
