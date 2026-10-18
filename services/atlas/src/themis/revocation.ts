// themis/revocation.ts — THEMIS, in-world enforcement (docs/NAMING.md). Pure decision cores for ban/revocation:
// the per-connection status gate + the sweep selector. Identity/status is read from AUTHORITATIVE state (the
// account table, via Atlas's SELECT-on-account grant) — never a client claim (G1/G11). FAIL-CLOSED: a missing
// or unknown status is treated as revoked. Polaris is the sole WRITER of account.status; Atlas only enforces.

/** Code sent when evicting a non-active account (lobby/zone onJoin + the sweep). */
export const CODE_REVOKED = 4403;

/** The per-connection access-status gate: `active` passes; everything else (incl. missing) fails closed. */
export function gateAccountStatus(
  status: string | null | undefined,
): { ok: true } | { ok: false; code: number; reason: string } {
  if (status === "active") return { ok: true };
  return { ok: false, code: CODE_REVOKED, reason: status ? `account_${status}` : "account_unknown" };
}

/** Of the currently-present account ids, those whose status is NOT active — a missing status counts as
 *  revoked (fail-closed). This is the sweep's kick list. */
export function selectRevoked(present: Iterable<string>, statusById: ReadonlyMap<string, string>): string[] {
  const revoked: string[] = [];
  for (const id of present) {
    if (statusById.get(id) !== "active") revoked.push(id);
  }
  return revoked;
}
