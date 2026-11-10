-- Tesla Roadster global leaderboard (Supabase free tier).
--
-- How to use:
--   1. Create a free project at https://supabase.com
--   2. Open SQL Editor -> New query, paste this whole file, Run. Safe to re-run.
--   3. Project Settings -> API: copy the Project URL and the "anon public" key
--      into src/multiplayer/config.js (supabase.url / supabase.anonKey).
--
-- The anon key is public by design. These rules only let anonymous players
-- insert sane lap times and read them; nobody can edit or delete rows.

create table if not exists public.lap_times (
  id          bigint generated always as identity primary key,
  player_id   uuid        not null,
  name        text        not null check (char_length(name) between 1 and 16),
  track_id    text        not null check (char_length(track_id) between 1 and 40),
  lap_ms      integer     not null check (lap_ms between 5000 and 3600000),
  color       text        not null default '#c8102e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  car_id      text        not null default 'roadster' check (char_length(car_id) <= 24),
  mode        text        not null default 'solo' check (mode in ('solo', 'online')),
  created_at  timestamptz not null default now()
);

create index if not exists lap_times_track_lap_idx on public.lap_times (track_id, lap_ms);
create index if not exists lap_times_player_recent_idx on public.lap_times (player_id, created_at desc);

alter table public.lap_times enable row level security;

drop policy if exists "anyone can read lap times" on public.lap_times;
create policy "anyone can read lap times" on public.lap_times
  for select to anon, authenticated using (true);

drop policy if exists "anyone can submit lap times" on public.lap_times;
create policy "anyone can submit lap times" on public.lap_times
  for insert to anon, authenticated with check (created_at > now() - interval '1 minute');

grant select, insert on public.lap_times to anon, authenticated;

-- Anti-spam: at most 30 submissions per player per 10 minutes.
create or replace function public.lap_times_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.lap_times
        where player_id = new.player_id
          and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate limit: too many lap submissions';
  end if;
  new.created_at := now(); -- clients can't backdate
  return new;
end $$;

drop trigger if exists lap_times_rate_limit on public.lap_times;
create trigger lap_times_rate_limit before insert on public.lap_times
  for each row execute function public.lap_times_rate_limit();

-- Best lap per player per track.
create or replace view public.best_laps with (security_invoker = true) as
  select distinct on (track_id, player_id)
         track_id, player_id, name, lap_ms, color, car_id, mode, created_at
    from public.lap_times
   order by track_id, player_id, lap_ms asc, created_at asc;

grant select on public.best_laps to anon, authenticated;
