// The registration contract lives in the database: the landing page talks to
// Supabase's REST API, which runs every insert as the `anon` role against these
// rules. So the schema is tested directly, as `anon`, in an in-memory Postgres.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = ['0001_creators.sql', '0002_creators_revoke_authenticated.sql']
  .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('
');
let db;

beforeEach(async () => {
  db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin;'); // both exist in every Supabase project
  await db.exec(migrations);
  await db.exec('set role anon;');
});

const row = (o = {}) => ({ email: 'maya@example.com', country_code: '+91', mobile: '9876543210', username: 'maya', referral_code: null, ...o });
const insert = (r) => db.query(
  'insert into public.creators (email, country_code, mobile, username, referral_code) values ($1, $2, $3, $4, $5)',
  [r.email, r.country_code, r.mobile, r.username, r.referral_code]);
const rejects = (r, constraint) => assert.rejects(insert(r), (e) => e.message.includes(constraint));

test('anon can register a creator', async () => {
  await insert(row({ referral_code: 'FRIEND10' }));
});

test('anon can only fill in the form fields', async () => {
  await assert.rejects(db.query("insert into public.creators (email, country_code, mobile, username, created_at) values ('a@b.co', '+91', '9876543210', 'abc', '2000-01-01')"), /permission denied/);
});

test('anon cannot read registrations back', async () => {
  await insert(row());
  await assert.rejects(db.query('select * from public.creators'), /permission denied/);
});

test('anon cannot change or delete registrations', async () => {
  await insert(row());
  await assert.rejects(db.query("update public.creators set username = 'x'"), /permission denied/);
  await assert.rejects(db.query('delete from public.creators'), /permission denied/);
});

test('a taken username is rejected', async () => {
  await insert(row());
  await rejects(row({ email: 'other@example.com' }), 'creators_username_key');
});

test('an email registers only once, ignoring case', async () => {
  await insert(row());
  await rejects(row({ email: 'Maya@Example.com', username: 'maya2' }), 'creators_email_key');
});

test('invalid fields are rejected by name', async () => {
  await rejects(row({ email: 'not-an-email' }), 'creators_email_check');
  await rejects(row({ country_code: '91' }), 'creators_country_code_check');
  await rejects(row({ mobile: '98765 43210' }), 'creators_mobile_check');
  await rejects(row({ mobile: '123' }), 'creators_mobile_check');
  await rejects(row({ username: 'Maya' }), 'creators_username_check');
  await rejects(row({ username: 'ab' }), 'creators_username_check');
  await rejects(row({ username: 'has space' }), 'creators_username_check');
  await rejects(row({ referral_code: 'x'.repeat(41) }), 'creators_referral_code_check');
});

test('anon can check whether a username is free', async () => {
  const free = async (name) => (await db.query('select public.username_available($1) as ok', [name])).rows[0].ok;
  assert.equal(await free('maya'), true);
  await insert(row());
  assert.equal(await free('maya'), false);
  assert.equal(await free('MAYA'), false);
});
