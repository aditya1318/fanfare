// The page's registration client, tested through the HTTP calls it makes to
// Supabase's REST API. Responses mirror what PostgREST returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, usernameAvailable } from '../register.js';

const cfg = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };
const form = (o = {}) => ({ email: ' Maya@Example.com ', cc: '+91', mobile: '98765 43210', username: ' Maya_K ', referral: '', ...o });

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('sends a cleaned-up registration to the creators endpoint', async () => {
  const f = fakeFetch(201);
  assert.deepEqual(await register(cfg, form({ referral: ' FRIEND10 ' }), f), { ok: true });
  const [call] = f.calls;
  assert.equal(call.url, 'https://proj.supabase.co/rest/v1/creators');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, 'anon-key');
  assert.equal(call.init.headers.Authorization, 'Bearer anon-key');
  assert.equal(call.init.headers.Prefer, 'return=minimal');
  assert.deepEqual(call.body, { email: 'maya@example.com', country_code: '+91', mobile: '9876543210', username: 'maya_k', referral_code: 'FRIEND10' });
});

test('an empty referral code is sent as null', async () => {
  const f = fakeFetch(201);
  await register(cfg, form(), f);
  assert.equal(f.calls[0].body.referral_code, null);
});

test('invalid fields are caught before anything is sent', async () => {
  for (const [o, field] of [[{ email: 'nope' }, 'email'], [{ cc: '91' }, 'country_code'], [{ mobile: '12' }, 'mobile'], [{ username: 'a!' }, 'username']]) {
    const f = fakeFetch(201);
    const r = await register(cfg, form(o), f);
    assert.equal(r.ok, false);
    assert.equal(r.field, field);
    assert.ok(r.message.length > 0);
    assert.equal(f.calls.length, 0);
  }
});

test('a taken username comes back as a username error', async () => {
  const r = await register(cfg, form(), fakeFetch(409, { code: '23505', message: 'duplicate key value violates unique constraint "creators_username_key"' }));
  assert.deepEqual(r, { ok: false, field: 'username', message: 'That username is taken. Try another.' });
});

test('a registered email comes back as an email error', async () => {
  const r = await register(cfg, form(), fakeFetch(409, { code: '23505', message: 'duplicate key value violates unique constraint "creators_email_key"' }));
  assert.equal(r.field, 'email');
  assert.match(r.message, /already registered/);
});

test('a database check failure names the field', async () => {
  const r = await register(cfg, form(), fakeFetch(400, { code: '23514', message: 'new row for relation "creators" violates check constraint "creators_mobile_check"' }));
  assert.equal(r.field, 'mobile');
});

test('server and network failures give a retry message', async () => {
  const down = await register(cfg, form(), fakeFetch(500, {}));
  assert.equal(down.ok, false);
  assert.equal(down.field, null);
  assert.match(down.message, /try again/i);
  const offline = await register(cfg, form(), async () => { throw new TypeError('Failed to fetch'); });
  assert.match(offline.message, /try again/i);
});

test('checks username availability through the RPC endpoint', async () => {
  const f = fakeFetch(200, false);
  assert.equal(await usernameAvailable(cfg, ' Maya ', f), false);
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/username_available');
  assert.deepEqual(f.calls[0].body, { name: 'maya' });
});

test('an unreachable availability check does not block the form', async () => {
  assert.equal(await usernameAvailable(cfg, 'maya', async () => { throw new TypeError('offline'); }), null);
});
