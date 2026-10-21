-- 0005_precedent.sql — seeded decision precedents (DECISIONS §2 tier-1): a situation EMBEDDING → an action,
-- retrieved by pgvector nearest-neighbour. This is the REAL pgvector backing the in-memory PrecedentStore stood
-- in for; swapping the adapter changes nothing at the call sites (G7). Atlas (atlas_app) seeds (replace-per-
-- schema) + reads; the set is grown by Mica/Opus later. Runs as the admin/owner DATABASE_URL, which is a dev
-- superuser (per db-init.ts), so CREATE EXTENSION is permitted.
create extension if not exists vector;

create schema if not exists memory;
grant usage on schema memory to atlas_app;

-- One row = one seeded example. `embedding` DIM must match the wired embedder (HashEmbedder = 16); a real
-- embedding model later changes the dim → a new migration. `schema_key` scopes a decision type (e.g. mob.tactic).
create table if not exists memory.precedent (
  id         bigint generated always as identity primary key,
  schema_key text        not null,
  action     text        not null,
  embedding  vector(16)  not null,
  created_at timestamptz not null default now()
);

create index if not exists precedent_schema_idx on memory.precedent (schema_key);
-- No ANN (HNSW/IVFFlat) index yet: the seed set is tiny (a seqscan + the <=> operator is instant), AND the vector
-- dim will change when a real embedding model lands. Add `using hnsw (embedding vector_cosine_ops)` then, sized
-- to the real dim + row count.

grant select, insert, delete on memory.precedent to atlas_app;
