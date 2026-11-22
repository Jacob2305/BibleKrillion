-- Bible Dive — migration 0002: Live Event Rooms.
-- Run in Supabase → SQL Editor after 0001 (paste the whole file, click Run). Safe to re-run.
--
-- Same security model as 0001: RLS on, no policies, so browsers can't touch
-- these tables. The /api functions do every read and write with the service role.
-- Phones get live updates through Realtime *broadcast* on private channels: the
-- one policy below lets browsers LISTEN on "room:…" topics, and nothing lets
-- them SEND, so only the server can push room state.

-- ───────────────────────── rooms ─────────────────────────
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}$'),
  phase       text not null default 'lobby'
              check (phase in ('lobby', 'question', 'reveal', 'leaderboard', 'final')),
  round_index integer not null default -1,          -- -1 = lobby
  prompt_ids  text[] not null,
  seconds     integer not null check (seconds between 5 and 120),
  teams       boolean not null default false,
  version     integer not null default 0,           -- bumps on every host action
  opened_at   timestamptz,                          -- current prompt opened
  deadline    timestamptz,                          -- current prompt closes
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

-- A code is only reserved while its room is open.
create unique index if not exists rooms_open_code on public.rooms (code) where ended_at is null;

-- ───────────────────────── players ─────────────────────────
create table if not exists public.players (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references public.rooms (id) on delete cascade,
  nickname  text not null check (char_length(nickname) between 1 and 24),
  name_key  text not null,                           -- lower-cased, for "name taken"
  team      text check (team is null or char_length(team) between 1 and 24),
  kicked    boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (room_id, name_key)
);

create index if not exists players_by_room on public.players (room_id);

-- ───────────────────────── rounds ─────────────────────────
create table if not exists public.rounds (
  room_id     uuid not null references public.rooms (id) on delete cascade,
  idx         integer not null check (idx >= 0),
  prompt_id   text not null,
  opened_at   timestamptz not null,
  deadline    timestamptz not null,
  revealed_at timestamptz,
  primary key (room_id, idx)
);

-- ───────────────────────── submissions ─────────────────────────
-- One locked (accepted) answer per player per prompt. Rejected guesses go to
-- rejected_answers (mode 'live') instead.
create table if not exists public.submissions (
  id         bigint generated always as identity primary key,
  room_id    uuid not null,
  round_idx  integer not null,
  player_id  uuid not null references public.players (id) on delete cascade,
  raw_text   text not null check (char_length(raw_text) <= 200),
  canonical  text not null,
  tier       text not null
             check (tier in ('plankton', 'too_clever', 'schooler', 'rare', 'deep_cut', 'one_in_a_million')),
  points     integer not null check (points between 0 and 100),
  ms         integer not null check (ms >= 0),      -- answer time, breaks leaderboard ties
  created_at timestamptz not null default now(),
  foreign key (room_id, round_idx) references public.rounds (room_id, idx) on delete cascade,
  unique (room_id, round_idx, player_id)
);

create index if not exists submissions_by_room on public.submissions (room_id, round_idx);

-- ───────────────────────── security ─────────────────────────
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.submissions enable row level security;

revoke all on public.rooms, public.players, public.rounds, public.submissions from anon, authenticated;
grant select, insert, update, delete on public.rooms, public.players, public.rounds, public.submissions to service_role;

-- Realtime: browsers may receive broadcasts on room topics, never send them.
drop policy if exists "bible dive phones listen to rooms" on realtime.messages;
create policy "bible dive phones listen to rooms"
  on realtime.messages for select
  to anon, authenticated
  using (realtime.topic() like 'room:%' and extension = 'broadcast');
