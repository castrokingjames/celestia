// seat-reservation.ts — reserve a seat in a zone room by zone id, with the verified identity pre-attached as
// authData. Shared by Janus (lobby enter) and the zone room (portal transfer): find the live instance for the
// zone via room metadata, else create one, then reserve. The client consumes the returned reservation to join
// WITHOUT re-auth (Colyseus skips onAuth when authData is set; the room rejects direct joins). docs/REFACTOR.md
// S1/S2. Single starting instance per zone for now; per-zone instancing/sharding (channels) is a later seam.
import { matchMaker } from "@colyseus/core";
import type { ZoneSeatAuth } from "@celestia/norma";

export async function reserveZoneSeat(zoneId: string, authData: ZoneSeatAuth) {
  const open = (await matchMaker.query({ name: "zone" })).find(
    (r) => (r.metadata as { zoneId?: string } | undefined)?.zoneId === zoneId && !r.locked,
  );
  const room = open ?? (await matchMaker.createRoom("zone", { zoneId }));
  return matchMaker.reserveSeatFor(room, { zoneId }, authData);
}
