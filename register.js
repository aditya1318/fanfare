// Registration client for the landing page. Talks to Supabase's REST API
// (PostgREST) directly; the rules it mirrors live in supabase/migrations.

const RULES = {
  email: [(v) => v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email address, like name@example.com.'],
  country_code: [(v) => /^\+\d{1,4}$/.test(v), 'Enter a country code starting with +, like +91.'],
  mobile: [(v) => /^\d{6,15}$/.test(v), 'Enter your mobile number as 6 to 15 digits.'],
  username: [(v) => /^[a-z0-9_]{3,30}$/.test(v), 'Usernames are 3 to 30 characters: lowercase letters, numbers and underscores.'],
  referral_code: [(v) => v === null || v.length <= 40, 'Referral codes are at most 40 characters.'],
};
const RETRY = 'Registration failed. Check your connection and try again.';

const headers = (cfg) => ({
  apikey: cfg.anonKey,
  Authorization: `Bearer ${cfg.anonKey}`,
  'Content-Type': 'application/json',
});

export const cleanUsername = (v) => v.trim().toLowerCase();

function clean(f) {
  return {
    email: f.email.trim().toLowerCase(),
    country_code: f.cc.trim(),
    mobile: f.mobile.replace(/[\s()-]/g, ''),
    username: cleanUsername(f.username),
    referral_code: f.referral.trim() || null,
  };
}

// Server errors carry the constraint name; map it back to the field.
function explain(body) {
  const field = Object.keys(RULES).find((k) => body.message?.includes(`creators_${k}_`));
  if (body.code === '23505' && field === 'username') return { field, message: 'That username is taken. Try another.' };
  if (body.code === '23505' && field === 'email') return { field, message: 'That email address is already registered.' };
  if (body.code === '23514' && field) return { field, message: RULES[field][1] };
  return { field: null, message: RETRY };
}

// form: { email, cc, mobile, username, referral } as typed.
// Resolves to { ok: true } or { ok: false, field, message }; field is null when no single field is at fault.
export async function register(cfg, form, fetchFn = fetch) {
  const row = clean(form);
  for (const [field, [valid, message]] of Object.entries(RULES)) {
    if (!valid(row[field])) return { ok: false, field, message };
  }
  try {
    const res = await fetchFn(`${cfg.url}/rest/v1/creators`, {
      method: 'POST',
      headers: { ...headers(cfg), Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (res.ok) return { ok: true };
    return { ok: false, ...explain(await res.json().catch(() => ({}))) };
  } catch {
    return { ok: false, field: null, message: RETRY };
  }
}

// true or false, or null when the check could not run (the submit still catches a clash).
export async function usernameAvailable(cfg, name, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${cfg.url}/rest/v1/rpc/username_available`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ name: cleanUsername(name) }),
    });
    return res.ok ? (await res.json()) === true : null;
  } catch {
    return null;
  }
}
