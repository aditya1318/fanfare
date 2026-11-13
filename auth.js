// Login for creators: a one-time code sent to their email by Supabase Auth.
// Talks to Supabase Auth's HTTP API directly, like register.js does for signup.
import { headers, isEmail } from './register.js?v=5';

const RETRY = 'Something went wrong. Check your connection and try again.';
const MESSAGES = {
  otp_expired: 'That code is wrong or has expired. Check it, or send a new one.',
  over_email_send_rate_limit: 'Too many codes sent. Wait a minute, then try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  email_address_not_authorized: "We can't send email to that address yet. Creator logins are still being set up.",
  email_address_invalid: 'Enter a valid email address, like name@example.com.',
};

const cleanEmail = (v) => v.trim().toLowerCase();

async function post(fetchFn, url, init) {
  try {
    const res = await fetchFn(url, { method: 'POST', ...init });
    return { ok: res.ok, status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

// expired: the login is no longer valid, as opposed to a network or server problem.
function failure({ status, body }) {
  const expired = status === 401;
  const known = MESSAGES[body?.error_code];
  if (known) return { ok: false, expired, message: known };
  if (status === 429) return { ok: false, expired, message: MESSAGES.over_request_rate_limit };
  return { ok: false, expired, message: expired ? 'Your login has ended. Log in again.' : RETRY };
}

function toSession(body) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at ?? Math.floor(Date.now() / 1000) + body.expires_in,
  };
}

// redirectTo: where the email's sign-in link should land (must be allowed in Supabase's URL settings).
export async function sendCode(cfg, email, redirectTo, fetchFn = fetch) {
  email = cleanEmail(email);
  if (!isEmail(email)) return { ok: false, message: MESSAGES.email_address_invalid };
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const r = await post(fetchFn, `${cfg.url}/auth/v1/otp${query}`, {
    headers: headers(cfg),
    body: JSON.stringify({ email, create_user: true }),
  });
  return r.ok ? { ok: true } : failure(r);
}

export async function verifyCode(cfg, email, code, fetchFn = fetch) {
  const token = code.replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(token)) return { ok: false, message: 'Enter the code from the email, digits only.' };
  const r = await post(fetchFn, `${cfg.url}/auth/v1/verify`, {
    headers: headers(cfg),
    body: JSON.stringify({ type: 'email', email: cleanEmail(email), token }),
  });
  return r.ok ? { ok: true, session: toSession(r.body) } : failure(r);
}

// After clicking the email's sign-in link, Supabase redirects here with the
// session (or an error) in the URL fragment. Returns null when there is neither.
export function sessionFromLink(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.get('access_token') && p.get('refresh_token')) {
    return { ok: true, session: toSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
      expires_at: p.has('expires_at') ? Number(p.get('expires_at')) : undefined, expires_in: Number(p.get('expires_in')) }) };
  }
  if (p.get('error_code') === 'otp_expired') return { ok: false, message: 'That sign-in link has expired or was already used. Send a new one.' };
  if (p.get('error')) return { ok: false, message: RETRY };
  return null;
}

// { ok: true, session }, or { ok: false, expired } where expired means log in again
// and not expired means it could not be checked (offline): keep the old session.
export async function refreshSession(cfg, session, fetchFn = fetch) {
  const r = await post(fetchFn, `${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    headers: headers(cfg),
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (r.ok) return { ok: true, session: toSession(r.body) };
  return { ok: false, expired: r.status >= 400 && r.status < 500 && r.status !== 429 };
}

// Best effort: the page forgets the session whether or not this reaches the server.
export async function logOut(cfg, session, fetchFn = fetch) {
  await post(fetchFn, `${cfg.url}/auth/v1/logout`, { headers: headers(cfg, session.access_token) });
}

// Links the logged-in user to their registration; username is null if they never registered.
export async function claimCreator(cfg, session, fetchFn = fetch) {
  const r = await post(fetchFn, `${cfg.url}/rest/v1/rpc/claim_creator`, {
    headers: headers(cfg, session.access_token),
    body: '{}',
  });
  return r.ok ? { ok: true, username: r.body ?? null } : failure(r);
}
