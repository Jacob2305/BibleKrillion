-- Bible Dive — migration 0007: the projector can show every player's answer ("Audience answers").
-- Run in Supabase → SQL Editor after 0006 (paste the whole file, click Run). Safe to re-run.

-- 0006 allowed only 'climb' and 'answers'; add 'given' (who said what).
alter table public.rooms drop constraint if exists rooms_reveal_view_check;
alter table public.rooms add constraint rooms_reveal_view_check check (reveal_view in ('climb', 'answers', 'given'));

-- Same security model as earlier migrations: only the server (service role) touches rooms.
grant select, insert, update, delete on public.rooms to service_role;
