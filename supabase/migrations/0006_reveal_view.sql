-- Bible Dive — migration 0006: the host picks what the projector shows after a reveal.
-- Run in Supabase → SQL Editor after 0005 (paste the whole file, click Run). Safe to re-run.

-- 'climb' = the world risen to the highest tier anyone reached, with the guesses floating;
-- 'answers' = the full answer board. (The leaderboard is its own phase.)
alter table public.rooms add column if not exists reveal_view text not null default 'climb';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_reveal_view_check') then
    alter table public.rooms add constraint rooms_reveal_view_check check (reveal_view in ('climb', 'answers'));
  end if;
end $$;

-- Same security model as earlier migrations: only the server (service role) touches rooms.
grant select, insert, update, delete on public.rooms to service_role;
