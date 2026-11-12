-- Creator registrations from the landing page (#3).
-- The page inserts with the public anon key, so the anon role may insert and
-- nothing else: registrations hold emails and phone numbers.
-- ponytail: no rate limit on anon inserts; add a captcha or an edge function if spam shows up.

create table public.creators (
  id            uuid primary key default gen_random_uuid(),
  email         text not null
                constraint creators_email_check check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  country_code  text not null
                constraint creators_country_code_check check (country_code ~ '^\+[0-9]{1,4}$'),
  mobile        text not null
                constraint creators_mobile_check check (mobile ~ '^[0-9]{6,15}$'),
  username      text not null
                constraint creators_username_check check (username ~ '^[a-z0-9_]{3,30}$'),
  referral_code text
                constraint creators_referral_code_check check (length(referral_code) <= 40),
  created_at    timestamptz not null default now()
);

-- Named so the page can tell which field clashed.
create unique index creators_username_key on public.creators (username);
create unique index creators_email_key on public.creators (lower(email));

alter table public.creators enable row level security;
revoke all on public.creators from anon;
grant insert (email, country_code, mobile, username, referral_code) on public.creators to anon;
create policy creators_anon_insert on public.creators for insert to anon with check (true);

-- Lets the page say "taken" while the visitor types, without exposing the table.
create function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public
as $$ select not exists (select 1 from public.creators where username = lower(trim(name))) $$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon;
