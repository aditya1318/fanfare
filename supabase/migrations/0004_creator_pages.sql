-- Creator pages (#5). A verified creator (creators.user_id set, see 0003)
-- edits their own page through save_page(); anyone reads a published page
-- through public_page(), which leaves out lines that are switched off.
-- Nobody touches the table directly. Prices are whole rupees.

create table public.pages (
  creator_id     uuid primary key references public.creators (id) on delete cascade,
  display_name   text not null,
  bio            text,
  published      boolean not null default false,
  sub_on         boolean not null default false,
  sub_price      integer,
  msg_on         boolean not null default false,
  msg_price      integer,
  live_on        boolean not null default false,
  live_price     integer,
  deals_on       boolean not null default false,
  avatar_version bigint,
  updated_at     timestamptz not null default now(),
  -- Named so the page can tell which field is wrong. A price is needed only while its line is on.
  constraint pages_display_name_check check (length(trim(display_name)) between 1 and 60),
  constraint pages_bio_check          check (length(bio) <= 280),
  constraint pages_sub_price_check    check ((sub_price  is null or sub_price  between 10 and 100000) and (not sub_on  or sub_price  is not null)),
  constraint pages_msg_price_check    check ((msg_price  is null or msg_price  between 10 and 100000) and (not msg_on  or msg_price  is not null)),
  constraint pages_live_price_check   check ((live_price is null or live_price between 0  and 100000) and (not live_on or live_price is not null))
);

alter table public.pages enable row level security;
revoke all on public.pages from anon, authenticated;

-- The logged-in creator's username, or null if their login isn't linked to a registration.
create function public.my_username() returns text
language sql stable security definer set search_path = public
as $$ select username from public.creators where user_id = auth.uid() $$;

create function public.save_page(
  display_name text, bio text, published boolean,
  sub_on boolean, sub_price integer, msg_on boolean, msg_price integer,
  live_on boolean, live_price integer, deals_on boolean, avatar_version bigint
) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid;
begin
  select id into me from public.creators where user_id = auth.uid();
  if me is null then
    raise exception 'not_verified' using hint = 'Log in with the emailed link to verify your registration first.';
  end if;

  insert into public.pages as p (creator_id, display_name, bio, published, sub_on, sub_price, msg_on, msg_price,
                                 live_on, live_price, deals_on, avatar_version, updated_at)
  values (me, trim(save_page.display_name), nullif(trim(save_page.bio), ''), save_page.published,
          save_page.sub_on, save_page.sub_price, save_page.msg_on, save_page.msg_price,
          save_page.live_on, save_page.live_price, save_page.deals_on, save_page.avatar_version, now())
  on conflict (creator_id) do update set
    display_name = excluded.display_name, bio = excluded.bio, published = excluded.published,
    sub_on = excluded.sub_on, sub_price = excluded.sub_price, msg_on = excluded.msg_on, msg_price = excluded.msg_price,
    live_on = excluded.live_on, live_price = excluded.live_price, deals_on = excluded.deals_on,
    avatar_version = excluded.avatar_version, updated_at = now();
end
$$;

-- Everything the editor needs: the page as saved plus the username, or just
-- the username before the first save, or null when not verified.
create function public.my_page() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(to_jsonb(p) - 'creator_id' - 'updated_at', '{}'::jsonb) || jsonb_build_object('username', c.username)
  from public.creators c left join public.pages p on p.creator_id = c.id
  where c.user_id = auth.uid()
$$;

-- What the public page shows. Only published pages of verified creators, and
-- only the lines that are switched on.
create function public.public_page(name text) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'username', c.username, 'display_name', p.display_name, 'bio', p.bio, 'avatar_version', p.avatar_version,
    'lines', jsonb_strip_nulls(jsonb_build_object(
      'subscriptions', case when p.sub_on   then jsonb_build_object('price', p.sub_price)  end,
      'messages',      case when p.msg_on   then jsonb_build_object('price', p.msg_price)  end,
      'live',          case when p.live_on  then jsonb_build_object('price', p.live_price) end,
      'brand_deals',   case when p.deals_on then '{}'::jsonb end)))
  from public.pages p join public.creators c on c.id = p.creator_id
  where c.username = lower(trim(name)) and p.published and c.user_id is not null
$$;

revoke all on function public.my_username(), public.my_page(),
  public.save_page(text, text, boolean, boolean, integer, boolean, integer, boolean, integer, boolean, bigint),
  public.public_page(text) from public, anon, authenticated;
grant execute on function public.my_username(), public.my_page(),
  public.save_page(text, text, boolean, boolean, integer, boolean, integer, boolean, integer, boolean, bigint)
  to authenticated;
grant execute on function public.public_page(text) to anon, authenticated;

-- Photos: public bucket, one image per creator stored under their username.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and name = public.my_username());
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = public.my_username());
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = public.my_username())
  with check (bucket_id = 'avatars' and name = public.my_username());
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = public.my_username());
