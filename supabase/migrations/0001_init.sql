-- ============================================================================
-- Planify — schema, Row Level Security, realtime and account deletion.
--
-- Apply with:  supabase db push      (or paste into the SQL editor)
--
-- Security model
--   • Every table is RLS-protected and keyed on `user_id = auth.uid()`.
--   • The anon/publishable key is safe to ship to the browser *because* these
--     policies are the authorisation layer — not the key.
--   • No Google password or OAuth token is ever stored here. Google Calendar
--     refresh tokens live server-side only (see server/index.mjs).
--   • Deletes are soft (a `deleted` tombstone) so removals propagate to other
--     signed-in devices; `delete_account()` performs the hard, irreversible wipe.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null default '',
  name               text not null default '',
  avatar_url         text,
  provider           text not null default 'google',
  onboarding_complete boolean not null default false,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own"  on public.profiles;
drop policy if exists "profiles: update own"  on public.profiles;

create policy "profiles: read own"  on public.profiles for select using (id = auth.uid());
create policy "profiles: insert own" on public.profiles for insert with check (id = auth.uid());
create policy "profiles: update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,

  title              text not null default '',
  description        text not null default '',

  -- Timed events: absolute UTC instants. All-day events: 'YYYY-MM-DD'.
  -- Mirrors Google Calendar's dateTime vs date distinction, and keeps one
  -- column instead of two nullable ones.
  start_time         text not null,
  end_time           text not null,

  all_day            boolean not null default false,
  timezone           text not null default 'UTC',
  location           text not null default '',
  category_id        text not null default 'personal',

  reminders          integer[] not null default '{}',
  recurrence         jsonb,
  exceptions         text[] not null default '{}',

  google_event_id    text,
  google_calendar_id text,

  version            bigint not null default 1,
  deleted            boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A stored event must be internally consistent.
  constraint events_title_length check (char_length(title) <= 200),
  constraint events_location_length check (char_length(location) <= 300),
  constraint events_category check (
    category_id in ('personal','work','health','social','travel','focus','family','other')
  )
);

create index if not exists events_user_start_idx
  on public.events (user_id, start_time)
  where deleted = false;

create index if not exists events_user_updated_idx
  on public.events (user_id, updated_at desc);

create unique index if not exists events_google_dedupe_idx
  on public.events (user_id, google_event_id)
  where google_event_id is not null;

alter table public.events enable row level security;

drop policy if exists "events: read own"   on public.events;
drop policy if exists "events: insert own" on public.events;
drop policy if exists "events: update own" on public.events;
drop policy if exists "events: delete own" on public.events;

create policy "events: read own"   on public.events for select using (user_id = auth.uid());
create policy "events: insert own" on public.events for insert with check (user_id = auth.uid());
create policy "events: update own" on public.events for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "events: delete own" on public.events for delete using (user_id = auth.uid());

-- Keep updated_at honest even if a client forgets to send it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_settings — one row per user
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  theme_mode             text not null default 'dark' check (theme_mode in ('dark','light','system')),
  first_day_of_week      smallint not null default 0 check (first_day_of_week between 0 and 6),
  time_format            text not null default '12h' check (time_format in ('12h','24h')),
  default_reminder_minutes integer not null default 10 check (default_reminder_minutes between 0 and 40320),
  timezone               text not null default 'UTC',
  day_start_hour         smallint not null default 7 check (day_start_hour between 0 and 23),
  week_view_days         smallint not null default 7 check (week_view_days in (5, 7)),
  default_category_id    text not null default 'personal',
  reduce_motion          boolean not null default false,
  notifications_enabled  boolean not null default false,
  accent_hue             smallint not null default 216 check (accent_hue between 0 and 360),
  updated_at             timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "settings: read own"   on public.user_settings;
drop policy if exists "settings: insert own" on public.user_settings;
drop policy if exists "settings: update own" on public.user_settings;

create policy "settings: read own"   on public.user_settings for select using (user_id = auth.uid());
create policy "settings: insert own" on public.user_settings for insert with check (user_id = auth.uid());
create policy "settings: update own" on public.user_settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- chat_messages — the assistant's history
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null default '',
  action      jsonb,
  resolved    boolean not null default false,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists chat_user_created_idx on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "chat: read own"   on public.chat_messages;
drop policy if exists "chat: insert own" on public.chat_messages;
drop policy if exists "chat: update own" on public.chat_messages;
drop policy if exists "chat: delete own" on public.chat_messages;

create policy "chat: read own"   on public.chat_messages for select using (user_id = auth.uid());
create policy "chat: insert own" on public.chat_messages for insert with check (user_id = auth.uid());
create policy "chat: update own" on public.chat_messages for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "chat: delete own" on public.chat_messages for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- google_calendar_links — optional integration state (no tokens stored here)
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_links (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  connected      boolean not null default false,
  email          text,
  calendar_id    text,
  status         text not null default 'idle' check (status in ('idle','syncing','error','paused')),
  mode           text not null default 'two-way' check (mode in ('two-way','import','export')),
  scopes_granted text[] not null default '{}',
  last_sync_at   timestamptz,
  message        text,
  updated_at     timestamptz not null default now()
);

alter table public.google_calendar_links enable row level security;

drop policy if exists "gcal: read own"   on public.google_calendar_links;
drop policy if exists "gcal: insert own" on public.google_calendar_links;
drop policy if exists "gcal: update own" on public.google_calendar_links;

create policy "gcal: read own"   on public.google_calendar_links for select using (user_id = auth.uid());
create policy "gcal: insert own" on public.google_calendar_links for insert with check (user_id = auth.uid());
create policy "gcal: update own" on public.google_calendar_links for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime — this is what makes a change on one device appear on another
-- without a refresh.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Account deletion — irreversible, removes every row the user owns.
-- SECURITY DEFINER so the policy on profiles cannot block its own deletion.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.chat_messages        where user_id = uid;
  delete from public.google_calendar_links where user_id = uid;
  delete from public.user_settings        where user_id = uid;
  delete from public.events               where user_id = uid;
  delete from public.profiles             where id      = uid;

  -- Removing the auth.users row invalidates every session on every device.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;

-- ---------------------------------------------------------------------------
-- New accounts: create the profile and a settings row with safe defaults.
-- Note this does NOT create any events — a new user starts empty.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url, provider)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1),
      'Planify user'
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    'google'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, timezone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'))
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
