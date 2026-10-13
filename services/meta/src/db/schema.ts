// schema.ts — Kysely row types mirroring migrations/0001_identity.sql.
// Generated<T> = DB-supplied on insert (defaults, serials) so it's optional in inserts,
// present in selects. Kept hand-written (not codegen) while the schema is small.
import type { Generated } from "kysely";

export interface RoleTable {
  id: string;
  element: string;
  active: Generated<boolean>;
  description: string;
  created_at: Generated<Date>;
}

export interface AccountTable {
  id: Generated<string>;
  handle: string | null;
  role: Generated<string>; // default 'terra'
  status: Generated<string>; // default 'active'
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthIdentityTable {
  id: Generated<string>;
  account_id: string;
  method: string;
  external_id: string;
  secret_hash: string | null;
  created_at: Generated<Date>;
}

export interface RefreshTokenTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  issued_at: Generated<Date>;
  expires_at: Date;
  rotated_to: string | null;
  revoked_at: Date | null;
}

export interface Database {
  role: RoleTable;
  account: AccountTable;
  auth_identity: AuthIdentityTable;
  refresh_token: RefreshTokenTable;
}
