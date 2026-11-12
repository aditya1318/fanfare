-- Supabase grants signed-in users every privilege on new public tables.
-- Row-level security already blocks them; revoke so nothing relies on that alone.
revoke all on public.creators from authenticated;
