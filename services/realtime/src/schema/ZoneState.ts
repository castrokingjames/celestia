// Authoritative room state (synced to clients as binary deltas). Scaffold — one player archetype.
// NOTE: needs experimentalDecorators + useDefineForClassFields:false (set in tsconfig.base.json).
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") lastSeq = 0; // last input command the server has applied — the client reconciles against this
}

export class ZoneState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
