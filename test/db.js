// An in-memory Postgres shaped like a Supabase project: the anon and
// authenticated roles, a minimal auth schema, and every migration applied.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');

const supabaseStub = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(supabaseStub);
  await db.exec(migrations);
  return db;
}

// Act as a PostgREST request would: a role plus the caller's JWT claims.
export async function actAs(db, role, claims = {}) {
  await db.exec('reset role;');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role};`);
}
