// The account page's auth client, tested through the HTTP calls it makes to
// Supabase Auth and the REST API. Error bodies mirror what Supabase Auth returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCode, verifyCode, refreshSession, logOut, claimCreator, sessionFromLink } from '../auth.js';

const cfg = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };
const session = { access_token: 'user-token', refresh_token: 'refresh-1', expires_at: 2000000000 };

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const authError = (status, error_code, msg = 'x') => fakeFetch(status, { code: status, error_code, msg });

test('sends a sign-in code to the cleaned-up email', async () => {
  const f = fakeFetch(200, {});
  assert.deepEqual(await sendCode(cfg, ' Maya@Example.com ', null, f), { ok: true });
  const [call] = f.calls;
  assert.equal(call.url, 'https://proj.supabase.co/auth/v1/otp');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, 'anon-key');
  assert.deepEqual(call.body, { email: 'maya@example.com', create_user: true });
});

test('an invalid email is caught before sending', async () => {
  const f = fakeFetch(200, {});
  const r = await sendCode(cfg, 'nope', null, f);
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
});

test('asking for codes too often says to wait', async () => {
  const r = await sendCode(cfg, 'maya@example.com', null, authError(429, 'over_email_send_rate_limit'));
  assert.match(r.message, /wait/i);
});

test('an address Supabase will not email yet is explained', async () => {
  const r = await sendCode(cfg, 'maya@example.com', null, authError(400, 'email_address_not_authorized'));
  assert.match(r.message, /can't send/i);
});

test('a correct code returns a session', async () => {
  const f = fakeFetch(200, { access_token: 'user-token', refresh_token: 'refresh-1', expires_at: 2000000000, user: {} });
  const r = await verifyCode(cfg, 'Maya@Example.com', ' 123 456 ', f);
  assert.deepEqual(r, { ok: true, session });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/auth/v1/verify');
  assert.deepEqual(f.calls[0].body, { type: 'email', email: 'maya@example.com', token: '123456' });
});

test('a wrong or expired code says so and points to a new code', async () => {
  const r = await verifyCode(cfg, 'maya@example.com', '000000', authError(403, 'otp_expired', 'Token has expired or is invalid'));
  assert.equal(r.ok, false);
  assert.match(r.message, /wrong or has expired/);
  assert.match(r.message, /new one/);
});

test('a code that is not digits is caught before sending', async () => {
  const f = fakeFetch(200, {});
  const r = await verifyCode(cfg, 'maya@example.com', 'abc', f);
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
});

test('network failures give a retry message', async () => {
  const r = await sendCode(cfg, 'maya@example.com', null, async () => { throw new TypeError('offline'); });
  assert.match(r.message, /try again/i);
});

test('refreshes an ageing session', async () => {
  const f = fakeFetch(200, { access_token: 'new-token', refresh_token: 'refresh-2', expires_in: 3600 });
  const r = await refreshSession(cfg, session, f);
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(f.calls[0].body, { refresh_token: 'refresh-1' });
  assert.equal(r.session.access_token, 'new-token');
  assert.ok(r.session.expires_at > Date.now() / 1000);
});

test('a dead refresh token ends the session', async () => {
  assert.deepEqual(await refreshSession(cfg, session, authError(400, 'refresh_token_not_found')), { ok: false, expired: true });
});

test('being offline does not end the session', async () => {
  assert.deepEqual(await refreshSession(cfg, session, async () => { throw new TypeError('offline'); }), { ok: false, expired: false });
});

test('logging out revokes the session with the user token', async () => {
  const f = fakeFetch(204);
  await logOut(cfg, session, f);
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/auth/v1/logout');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('logging out still finishes when offline', async () => {
  await logOut(cfg, session, async () => { throw new TypeError('offline'); });
});

test('claims the registration with the user token', async () => {
  const f = fakeFetch(200, 'maya');
  assert.deepEqual(await claimCreator(cfg, session, f), { ok: true, username: 'maya' });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/claim_creator');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('a rejected login token is reported as expired', async () => {
  const r = await claimCreator(cfg, session, fakeFetch(401, { message: 'JWT expired' }));
  assert.equal(r.ok, false);
  assert.equal(r.expired, true);
  assert.match(r.message, /log in again/i);
});

test('a login with no registration comes back without a username', async () => {
  assert.deepEqual(await claimCreator(cfg, session, fakeFetch(200, null)), { ok: true, username: null });
});

test('the sign-in link lands back on the page that asked for it', async () => {
  const f = fakeFetch(200, {});
  await sendCode(cfg, 'maya@example.com', 'https://site.test/fanfare/account.html', f);
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fsite.test%2Ffanfare%2Faccount.html');
});

test('a clicked sign-in link gives a session', () => {
  const r = sessionFromLink('#access_token=user-token&expires_at=2000000000&expires_in=3600&refresh_token=refresh-1&token_type=bearer&type=magiclink');
  assert.deepEqual(r, { ok: true, session });
});

test('an expired sign-in link says to send a new one', () => {
  const r = sessionFromLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(r.ok, false);
  assert.match(r.message, /expired/);
});

test('a page opened normally has no link session', () => {
  assert.equal(sessionFromLink(''), null);
});
