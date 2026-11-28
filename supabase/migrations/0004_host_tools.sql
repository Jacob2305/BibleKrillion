-- Bible Dive — migration 0004: host tools (test bots, re-tiering answers per room).
-- Run in Supabase → SQL Editor after 0003 (paste the whole file, click Run). Safe to re-run.

-- Two test bots join every hosted room and answer each prompt at random.
alter table public.players add column if not exists is_bot boolean not null default false;

-- The host can move an answer to another tier for one room:
-- { "<prompt id>": { "<canonical answer>": "<tier>" } }. Points are recomputed from it.
alter table public.rooms add column if not exists tier_overrides jsonb not null default '{}'::jsonb;

-- Same security model as 0002: only the server (service role) touches these tables.
grant select, insert, update, delete on public.rooms, public.players to service_role;
