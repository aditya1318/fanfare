// Creator pages: read a public page, and let a logged-in creator edit their own
// and upload a photo. The rules mirror supabase/migrations/0004_creator_pages.sql.
import { headers } from './register.js?v=7';
import { post } from './auth.js?v=7';

const RETRY = 'Something went wrong. Check your connection and try again.';
const MAX = 100000;
const price = (min, on, v) => (v === null ? !on : Number.isInteger(v) && v >= min && v <= MAX);
const CHECKS = {
  display_name: [(r) => r.display_name.length >= 1 && r.display_name.length <= 60, 'Enter the name to show on your page, up to 60 characters.'],
  bio: [(r) => r.bio === null || r.bio.length <= 280, 'Keep the description to 280 characters.'],
  sub_price: [(r) => price(10, r.sub_on, r.sub_price), 'Set a monthly price from ₹10 to ₹1,00,000, in whole rupees.'],
  msg_price: [(r) => price(10, r.msg_on, r.msg_price), 'Set a message price from ₹10 to ₹1,00,000, in whole rupees.'],
  live_price: [(r) => price(0, r.live_on, r.live_price), 'Set a ticket price up to ₹1,00,000 in whole rupees, or 0 for free shows with tips.'],
};

// '' means no price; anything that isn't whole digits becomes NaN and fails its check.
const toPrice = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : /^\d+$/.test(s) ? Number(s) : NaN;
};

function clean(f) {
  const r = {
    display_name: f.display_name.trim(),
    bio: f.bio.trim() || null,
    published: !!f.published,
    sub_on: !!f.sub_on, sub_price: toPrice(f.sub_price),
    msg_on: !!f.msg_on, msg_price: toPrice(f.msg_price),
    live_on: !!f.live_on, live_price: toPrice(f.live_price),
    deals_on: !!f.deals_on,
    avatar_version: f.avatar_version ?? null,
  };
  // A switched-off line keeps its price only if it is valid, so a leftover typo can't block saving.
  for (const [on, key] of [['sub_on', 'sub_price'], ['msg_on', 'msg_price'], ['live_on', 'live_price']]) {
    if (!r[on] && !CHECKS[key][0]({ ...r, [on]: true })) r[key] = null;
  }
  return r;
}

const rpc = (cfg, fn, body, token, fetchFn) =>
  post(fetchFn, `${cfg.url}/rest/v1/rpc/${fn}`, { headers: headers(cfg, token), body: JSON.stringify(body) });

export async function getPublicPage(cfg, username, fetchFn = fetch) {
  const r = await rpc(cfg, 'public_page', { name: username.trim().toLowerCase() }, undefined, fetchFn);
  return r.ok ? { ok: true, page: r.body ?? null } : { ok: false, message: RETRY };
}

export async function getMyPage(cfg, session, fetchFn = fetch) {
  const r = await rpc(cfg, 'my_page', {}, session.access_token, fetchFn);
  return r.ok ? { ok: true, page: r.body ?? null } : { ok: false, expired: r.status === 401, message: RETRY };
}

// form holds the editor's raw values (prices as typed). Resolves to { ok: true } or { ok: false, field, message }.
export async function savePage(cfg, session, form, fetchFn = fetch) {
  const row = clean(form);
  for (const [field, [valid, message]] of Object.entries(CHECKS)) {
    if (!valid(row)) return { ok: false, field, message };
  }
  const r = await rpc(cfg, 'save_page', row, session.access_token, fetchFn);
  if (r.ok) return { ok: true };
  if (r.body?.message === 'not_verified') return { ok: false, field: null, message: 'Verify your email first: log in with the link we email you.' };
  const field = Object.keys(CHECKS).find((k) => r.body?.message?.includes(`pages_${k}_check`));
  if (r.body?.code === '23514' && field) return { ok: false, field, message: CHECKS[field][1] };
  return { ok: false, field: null, expired: r.status === 401, message: RETRY };
}

// Replaces the creator's photo. blob should already be a small JPEG, PNG or WebP.
export async function uploadAvatar(cfg, session, username, blob, fetchFn = fetch) {
  const r = await post(fetchFn, `${cfg.url}/storage/v1/object/avatars/${encodeURIComponent(username)}`, {
    headers: { ...headers(cfg, session.access_token), 'Content-Type': blob.type, 'x-upsert': 'true' },
    body: blob,
  });
  if (r.ok) return { ok: true };
  const status = Number(r.body?.statusCode ?? r.status);
  if (status === 413) return { ok: false, message: 'That photo is too large. Use one under 2 MB.' };
  if (status === 415 || /mime/i.test(r.body?.message ?? '')) return { ok: false, message: 'Use a JPEG, PNG or WebP photo.' };
  if (status === 401 || status === 403) return { ok: false, message: 'Your login has ended or isn’t verified. Log in again.' };
  return { ok: false, message: RETRY };
}

// The version changes the link whenever the photo changes, so browsers don't show an old one.
export const avatarUrl = (cfg, username, version) =>
  version ? `${cfg.url}/storage/v1/object/public/avatars/${encodeURIComponent(username)}?v=${version}` : null;
