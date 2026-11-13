// Creator pages: verified creators edit their own page through save_page();
// anyone reads a published page through public_page(); photos live in the
// avatars bucket under the creator's username.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, actAs } from './db.js';

const MAYA = '11111111-1111-1111-1111-111111111111';
const RAVI = '22222222-2222-2222-2222-222222222222';
let db;

beforeEach(async () => {
  db = await freshDb();
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${MAYA}', 'maya@example.com', now()), ('${RAVI}', 'ravi@example.com', now());
    insert into public.creators (email, country_code, mobile, username, user_id) values
      ('maya@example.com', '+91', '9876543210', 'maya', '${MAYA}'),
      ('ravi@example.com', '+91', '9876543211', 'ravi', null);`);
});

const page = (o = {}) => ({
  display_name: 'Maya Kapoor', bio: 'Indie songwriter from Pune.', published: true,
  sub_on: true, sub_price: 199, msg_on: false, msg_price: null,
  live_on: true, live_price: 0, deals_on: true, avatar_version: null, ...o,
});
async function save(id, p) {
  await actAs(db, 'authenticated', { sub: id, role: 'authenticated' });
  try {
    await db.query(`select public.save_page($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.display_name, p.bio, p.published, p.sub_on, p.sub_price, p.msg_on, p.msg_price, p.live_on, p.live_price, p.deals_on, p.avatar_version]);
  } finally { await actAs(db, 'postgres'); }
}
async function publicPage(name) {
  await actAs(db, 'anon');
  const { rows } = await db.query('select public.public_page($1) as p', [name]);
  await actAs(db, 'postgres');
  return rows[0].p;
}

test('a verified creator saves a page anyone can read', async () => {
  await save(MAYA, page());
  const p = await publicPage('Maya');
  assert.equal(p.username, 'maya');
  assert.equal(p.display_name, 'Maya Kapoor');
  assert.equal(p.bio, 'Indie songwriter from Pune.');
});

test('lines that are switched off are left out of the public page', async () => {
  await save(MAYA, page({ msg_on: false, msg_price: 99 }));
  const { lines } = await publicPage('maya');
  assert.deepEqual(lines, { subscriptions: { price: 199 }, live: { price: 0 }, brand_deals: {} });
});

test('saving again changes the page', async () => {
  await save(MAYA, page());
  await save(MAYA, page({ display_name: 'Maya K', sub_on: false }));
  const p = await publicPage('maya');
  assert.equal(p.display_name, 'Maya K');
  assert.equal(p.lines.subscriptions, undefined);
});

test('an unpublished page is not public', async () => {
  await save(MAYA, page({ published: false }));
  assert.equal(await publicPage('maya'), null);
});

test('an unknown username has no page', async () => {
  assert.equal(await publicPage('nobody'), null);
});

test('an unverified registration cannot save a page', async () => {
  await assert.rejects(save(RAVI, page({ display_name: 'Ravi' })), /not_verified/);
});

test('the creator can read back their own page, published or not', async () => {
  await save(MAYA, page({ published: false, msg_price: 49 }));
  await actAs(db, 'authenticated', { sub: MAYA, role: 'authenticated' });
  const { rows } = await db.query('select public.my_page() as p');
  assert.equal(rows[0].p.username, 'maya');
  assert.equal(rows[0].p.published, false);
  assert.equal(rows[0].p.msg_price, 49);
});

test('a verified creator with no page yet gets just their username', async () => {
  await actAs(db, 'authenticated', { sub: MAYA, role: 'authenticated' });
  const { rows } = await db.query('select public.my_page() as p');
  assert.deepEqual(rows[0].p, { username: 'maya' });
});

test('page fields are checked by name', async () => {
  const rejects = (o, constraint) => assert.rejects(save(MAYA, page(o)), (e) => e.message.includes(constraint));
  await rejects({ display_name: '' }, 'pages_display_name_check');
  await rejects({ display_name: 'x'.repeat(61) }, 'pages_display_name_check');
  await rejects({ bio: 'x'.repeat(281) }, 'pages_bio_check');
  await rejects({ sub_on: true, sub_price: null }, 'pages_sub_price_check');
  await rejects({ sub_price: 5 }, 'pages_sub_price_check');
  await rejects({ msg_on: true, msg_price: 100001 }, 'pages_msg_price_check');
  await rejects({ live_price: -1 }, 'pages_live_price_check');
});

test('nobody reads or writes the pages table directly', async () => {
  await save(MAYA, page());
  for (const role of ['anon', 'authenticated']) {
    await actAs(db, role, { sub: MAYA });
    await assert.rejects(db.query('select * from public.pages'), /permission denied/);
    await assert.rejects(db.query("update public.pages set display_name = 'x'"), /permission denied/);
  }
});

test('the public key cannot save or read private pages', async () => {
  await actAs(db, 'anon');
  await assert.rejects(db.query('select public.my_page()'), /permission denied/);
  await assert.rejects(db.query('select public.save_page(null, null, null, null, null, null, null, null, null, null, null)'), /permission denied/);
});

test('a creator can upload a photo only under their own username', async () => {
  await actAs(db, 'authenticated', { sub: MAYA, role: 'authenticated' });
  await db.query("insert into storage.objects (bucket_id, name) values ('avatars', 'maya')");
  await assert.rejects(db.query("insert into storage.objects (bucket_id, name) values ('avatars', 'ravi')"), /row-level security/);
  await assert.rejects(db.query("insert into storage.objects (bucket_id, name) values ('other', 'maya')"), /row-level security/);
});

test('an unverified registration cannot upload a photo', async () => {
  await actAs(db, 'authenticated', { sub: RAVI, role: 'authenticated' });
  await assert.rejects(db.query("insert into storage.objects (bucket_id, name) values ('avatars', 'ravi')"), /row-level security/);
});

test('the photo bucket is public, images only, up to 2 MB', async () => {
  const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'");
  assert.deepEqual(rows[0], { public: true, file_size_limit: 2097152, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
});
