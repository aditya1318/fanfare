-- Verification (#4): a registration belongs to the Supabase Auth user who
-- proved, with an email code, that they own its email address.
-- A creator is verified once user_id is set; publishing a page (#5) must require it.

alter table public.creators
  add column user_id uuid unique references auth.users (id) on delete set null;

-- Called by the account page after login. Links the caller to the registration
-- with their confirmed email (once), then returns their username, or null if
-- that email never registered.
create function public.claim_creator() returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  confirmed_email text;
  uname text;
begin
  select email into confirmed_email
    from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if confirmed_email is null then
    return null;
  end if;

  update public.creators set user_id = auth.uid()
   where user_id is null and lower(email) = lower(confirmed_email);

  select username into uname from public.creators where user_id = auth.uid();
  return uname;
end
$$;

revoke all on function public.claim_creator() from public, anon;
grant execute on function public.claim_creator() to authenticated;
