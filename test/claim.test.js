// Verification links a registration to the Supabase Auth user who proved they
// own its email. claim_creator() is what the account page calls after login.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, actAs } from './db.js';

const MAYA = '11111111-1111-1111-1111-111111111111';
const RAVI = '22222222-2222-2222-2222-222222222222';
let db;

beforeEach(async () => {
  db = await freshDb();
  await db.exec(`insert into public.creators (email, country_code, mobile, username)
                 values ('maya@example.com', '+91', '9876543210', 'maya');`);
});

async function authUser(id, email, confirmed = true) {
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [id, email, confirmed ? new Date() : null]);
}
async function claimAs(id) {
  await actAs(db, 'authenticated', { sub: id, role: 'authenticated' });
  const { rows } = await db.query('select public.claim_creator() as username');
  await actAs(db, 'postgres');
  return rows[0].username;
}
const linkedTo = async () => (await db.query("select user_id from public.creators where username = 'maya'")).rows[0].user_id;

test('a creator who verified their email is linked and gets their username', async () => {
  await authUser(MAYA, 'maya@example.com');
  assert.equal(await claimAs(MAYA), 'maya');
  assert.equal(await linkedTo(), MAYA);
});

test('email matching ignores case', async () => {
  await authUser(MAYA, 'Maya@Example.com');
  assert.equal(await claimAs(MAYA), 'maya');
});

test('logging in again returns the same username', async () => {
  await authUser(MAYA, 'maya@example.com');
  await claimAs(MAYA);
  assert.equal(await claimAs(MAYA), 'maya');
});

test('an unconfirmed email links nothing', async () => {
  await authUser(MAYA, 'maya@example.com', false);
  assert.equal(await claimAs(MAYA), null);
  assert.equal(await linkedTo(), null);
});

test('someone with a different email cannot take the registration', async () => {
  await authUser(RAVI, 'ravi@example.com');
  assert.equal(await claimAs(RAVI), null);
  assert.equal(await linkedTo(), null);
});

test('a verified user who never registered gets no username', async () => {
  await authUser(RAVI, 'ravi@example.com');
  assert.equal(await claimAs(RAVI), null);
});

test('registrations stay unverified until claimed', async () => {
  assert.equal(await linkedTo(), null);
});

test('the public key cannot claim', async () => {
  await actAs(db, 'anon');
  await assert.rejects(db.query('select public.claim_creator()'), /permission denied/);
});
