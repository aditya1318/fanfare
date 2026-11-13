// The page client, tested through the HTTP calls it makes to Supabase's REST
// and Storage APIs. Error bodies mirror what PostgREST returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicPage, getMyPage, savePage, uploadAvatar, avatarUrl } from '../page.js';

const cfg = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };
const session = { access_token: 'user-token' };
const form = (o = {}) => ({
  display_name: ' Maya Kapoor ', bio: ' Indie songwriter. ', published: true,
  sub_on: true, sub_price: '199', msg_on: false, msg_price: '', live_on: true, live_price: '0', deals_on: false,
  avatar_version: null, ...o,
});

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('reads a public page by username with the public key', async () => {
  const f = fakeFetch(200, { username: 'maya', display_name: 'Maya', lines: {} });
  const r = await getPublicPage(cfg, ' Maya ', f);
  assert.deepEqual(r, { ok: true, page: { username: 'maya', display_name: 'Maya', lines: {} } });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/public_page');
  assert.deepEqual(f.calls[0].body, { name: 'maya' });
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer anon-key');
});

test('an unknown or unpublished page comes back empty', async () => {
  assert.deepEqual(await getPublicPage(cfg, 'nobody', fakeFetch(200, null)), { ok: true, page: null });
});

test('reads the creator\'s own page with their login', async () => {
  const f = fakeFetch(200, { username: 'maya' });
  assert.deepEqual(await getMyPage(cfg, session, f), { ok: true, page: { username: 'maya' } });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/my_page');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('saves a cleaned-up page', async () => {
  const f = fakeFetch(204);
  assert.deepEqual(await savePage(cfg, session, form(), f), { ok: true });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/save_page');
  assert.deepEqual(f.calls[0].body, {
    display_name: 'Maya Kapoor', bio: 'Indie songwriter.', published: true,
    sub_on: true, sub_price: 199, msg_on: false, msg_price: null, live_on: true, live_price: 0, deals_on: false,
    avatar_version: null,
  });
});

test('a missing name or price is caught before saving', async () => {
  for (const [o, field] of [[{ display_name: ' ' }, 'display_name'], [{ sub_price: '' }, 'sub_price'], [{ sub_price: '5' }, 'sub_price'], [{ msg_on: true, msg_price: '1.5' }, 'msg_price'], [{ live_price: '-1' }, 'live_price'], [{ bio: 'x'.repeat(281) }, 'bio']]) {
    const f = fakeFetch(204);
    const r = await savePage(cfg, session, form(o), f);
    assert.equal(r.ok, false, JSON.stringify(o));
    assert.equal(r.field, field);
    assert.equal(f.calls.length, 0);
  }
});

test('a price for a switched-off line is kept but not required', async () => {
  const f = fakeFetch(204);
  await savePage(cfg, session, form({ msg_on: false, msg_price: '49' }), f);
  assert.equal(f.calls[0].body.msg_price, 49);
});

test('an invalid price on a switched-off line is dropped instead of blocking the save', async () => {
  const f = fakeFetch(204);
  assert.deepEqual(await savePage(cfg, session, form({ msg_on: false, msg_price: '5' }), f), { ok: true });
  assert.equal(f.calls[0].body.msg_price, null);
});

test('an unverified login is told to verify first', async () => {
  const r = await savePage(cfg, session, form(), fakeFetch(400, { code: 'P0001', message: 'not_verified' }));
  assert.equal(r.ok, false);
  assert.match(r.message, /verify/i);
});

test('a database check failure names the field', async () => {
  const r = await savePage(cfg, session, form(), fakeFetch(400, { code: '23514', message: 'new row for relation "pages" violates check constraint "pages_sub_price_check"' }));
  assert.equal(r.field, 'sub_price');
});

test('uploads a photo under the username, replacing the old one', async () => {
  const f = fakeFetch(200, { Key: 'avatars/maya' });
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  assert.deepEqual(await uploadAvatar(cfg, session, 'maya', blob, f), { ok: true });
  assert.equal(f.calls[0].url, 'https://proj.supabase.co/storage/v1/object/avatars/maya');
  assert.equal(f.calls[0].init.headers['x-upsert'], 'true');
  assert.equal(f.calls[0].init.headers['Content-Type'], 'image/jpeg');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer user-token');
  assert.equal(f.calls[0].init.body, blob);
});

test('a rejected photo explains why', async () => {
  const r = await uploadAvatar(cfg, session, 'maya', new Blob(['x'], { type: 'image/jpeg' }), fakeFetch(413, { statusCode: '413', error: 'Payload too large' }));
  assert.equal(r.ok, false);
  assert.match(r.message, /too large|2 MB/i);
});

test('photo links change when the photo changes', () => {
  assert.equal(avatarUrl(cfg, 'maya', 1700000000000), 'https://proj.supabase.co/storage/v1/object/public/avatars/maya?v=1700000000000');
  assert.equal(avatarUrl(cfg, 'maya', null), null);
});
