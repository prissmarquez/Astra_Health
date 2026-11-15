-- =====================================================================
-- Astra Health · 001 · Initial schema
-- Tables: profiles, mission_types, missions, mission_participants,
--         indicators, sensors, sensor_indicators, measurements,
--         daily_adaptation.
-- Views:  readings_detailed (one row per measurement)
--         daily_readings    (one row per astronaut per day)
-- Run ONCE, in order, before 002 and 003.
-- =====================================================================

-- ---------- Fixed types ----------------------------------------------

-- Who the user is in the app. Only the admin sees everyone's data.
create type public.user_role as enum ('crew', 'admin');

-- Was the measurement taken? Only 'taken' carries a value.
create type public.measurement_status as enum ('taken', 'failed', 'cancelled');

-- How a value gets into the system.
create type public.entry_method as enum (
  'bluetooth',      -- sent by a Bluetooth device
  'system',         -- filled in by the system
  'calculated',     -- computed from other data
  'questionnaire',  -- answered by the astronaut in the app
  'manual'          -- typed in by hand
);

create type public.sensor_type as enum (
  'wearable', 'questionnaire', 'manual', 'simulator'
);

-- ---------- Profiles (one per Supabase Auth user) --------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 120),
  role       public.user_role not null default 'crew',
  created_at timestamptz not null default now()
);

-- Creates the profile automatically when someone signs up (always as crew).
-- The front-end can send the name in the signUp options.data.name field.
create function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'name', 120), ''));
  return new;
end;
$$;

create trigger on_user_created
  after insert on auth.users
  for each row execute function public.create_profile();

-- True when the signed-in user is an admin. Used by the RLS policies.
-- security definer: it can read profiles without being blocked by RLS.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ---------- Mission types ----------------------------------------------

-- short = 14 flight days, standard = 180, long = 365.
-- Every mission has 10 pre-flight days; post-flight depends on the type.
create table public.mission_types (
  code             text primary key,
  name             text not null,
  pre_flight_days  integer not null check (pre_flight_days >= 0),
  flight_days      integer not null check (flight_days > 0),
  post_flight_days integer not null check (post_flight_days >= 0)
);

-- ---------- Missions ---------------------------------------------------

create table public.missions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  mission_type      text not null references public.mission_types (code),
  launch_at         timestamptz not null,
  -- Set automatically: launch_at + flight_days of the mission type.
  planned_return_at timestamptz not null,
  -- Filled in when the crew actually returns (may differ from the plan).
  actual_return_at  timestamptz,
  actual_duration_days numeric generated always as (
    round(extract(epoch from (actual_return_at - launch_at)) / 86400, 2)
  ) stored,
  created_at        timestamptz not null default now(),
  check (actual_return_at is null or actual_return_at > launch_at)
);

create function public.set_planned_return()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select new.launch_at + make_interval(days => t.flight_days)
    into new.planned_return_at
  from public.mission_types t where t.code = new.mission_type;
  return new;
end;
$$;

create trigger set_planned_return
  before insert or update of mission_type, launch_at on public.missions
  for each row execute function public.set_planned_return();

-- Who takes part in each mission (managed by the admin).
create table public.mission_participants (
  mission_id uuid not null references public.missions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (mission_id, user_id)
);

create index mission_participants_user on public.mission_participants (user_id);

-- ---------- Catalogs ---------------------------------------------------

-- Fixed list of indicators, each with a single unit.
-- min_value / max_value only catch data-entry errors: they are NOT clinical thresholds.
create table public.indicators (
  code         text primary key,
  name         text not null,
  unit         text not null,
  min_value    numeric not null,
  max_value    numeric not null,
  entry_method public.entry_method not null,  -- how it normally gets in
  description  text not null,
  check (min_value < max_value)
);

-- Sensors and where they have flown.
create table public.sensors (
  id          text primary key,             -- e.g. 'astroskin'
  name        text not null,
  type        public.sensor_type not null,
  flown_on    text,                         -- where it has been used in spaceflight
  source_url  text,                         -- reference for flown_on
  notes       text not null default ''
);

-- Which indicators each sensor can measure (and how).
create table public.sensor_indicators (
  sensor_id      text not null references public.sensors (id) on delete cascade,
  indicator_code text not null references public.indicators (code),
  method         text not null,
  primary key (sensor_id, indicator_code)
);

-- ---------- Measurements (one row per indicator) ----------------------

create table public.measurements (
  -- UUID generated ON THE DEVICE: if sync resends the same measurement,
  -- it hits this key and is ignored (never duplicated).
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  indicator    text not null references public.indicators (code),
  sensor_id    text not null,                      -- which sensor took it
  status       public.measurement_status not null default 'taken',
  value        numeric,                            -- the value it took
  taken_at     timestamptz not null,               -- date and time (device clock, UTC)
  received_at  timestamptz not null default now(), -- arrival at the server
  -- Filled in automatically with the user's mission for that date (if any).
  mission_id   uuid references public.missions (id),
  source       public.entry_method not null,       -- how this value got in
  is_simulated boolean not null default false,
  context      text check (char_length(context) <= 200),
  -- Repeat = new row pointing to the original. The original is never changed.
  repeats_id   uuid,

  -- The sensor must actually measure that indicator.
  foreign key (sensor_id, indicator)
    references public.sensor_indicators (sensor_id, indicator_code),
  -- Deferred: allows sending the original and its repeat in the same batch.
  foreign key (repeats_id) references public.measurements (id)
    deferrable initially deferred,

  check ((status = 'taken') = (value is not null)),  -- value only when taken
  check (repeats_id is null or repeats_id <> id)
);

create index measurements_user_indicator_time
  on public.measurements (user_id, indicator, taken_at desc);
create index measurements_mission
  on public.measurements (mission_id) where mission_id is not null;
create index measurements_repeats_id
  on public.measurements (repeats_id) where repeats_id is not null;

-- ---------- Daily adaptation score (0 to 1) ---------------------------

-- One score per astronaut per day (UTC). Written only by the backend/ML
-- process with the secret key; crew members can only read their own.
create table public.daily_adaptation (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  day           date not null,
  adaptation    numeric not null check (adaptation between 0 and 1),
  model_version text not null default 'v0',
  computed_at   timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------- Measurement triggers --------------------------------------

-- 1) The value must fall within the indicator's range.
create function public.validate_measurement_range()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lower_bound numeric;
  upper_bound numeric;
begin
  if new.value is not null then
    select min_value, max_value into lower_bound, upper_bound
    from public.indicators where code = new.indicator;
    if new.value < lower_bound or new.value > upper_bound then
      raise exception 'Value % is outside the allowed range [%, %] for %',
        new.value, lower_bound, upper_bound, new.indicator
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_range
  before insert on public.measurements
  for each row execute function public.validate_measurement_range();

-- 2) Assigns the mission automatically: the user's mission whose window
--    (pre-flight start to post-flight end) contains taken_at.
--    If none matches, mission_id stays empty and the phase is left blank.
create function public.assign_mission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mission_id is null then
    select m.id into new.mission_id
    from public.missions m
    join public.mission_types t on t.code = m.mission_type
    join public.mission_participants p on p.mission_id = m.id
    where p.user_id = new.user_id
      and new.taken_at >= m.launch_at - make_interval(days => t.pre_flight_days)
      and new.taken_at <  coalesce(m.actual_return_at, m.planned_return_at)
                          + make_interval(days => t.post_flight_days)
    order by m.launch_at desc
    limit 1;
  end if;
  return new;
end;
$$;

create trigger assign_mission
  before insert on public.measurements
  for each row execute function public.assign_mission();

-- 3) A repeat must belong to the same user and the same indicator.
--    Checked at the end of the transaction (offline batches in any order).
create function public.validate_repeat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original record;
begin
  if new.repeats_id is not null then
    select user_id, indicator into original
    from public.measurements where id = new.repeats_id;
    if not found
       or original.user_id <> new.user_id
       or original.indicator <> new.indicator then
      raise exception 'Measurement % cannot repeat %: it must belong to the same user and indicator',
        new.id, new.repeats_id
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger validate_repeat
  after insert on public.measurements
  deferrable initially deferred
  for each row execute function public.validate_repeat();

-- ---------- Views -------------------------------------------------------
-- security_invoker = true: the views respect RLS of the person asking
-- (crew see only their rows, the admin sees everyone).

-- One row per measurement with all the essentials:
-- astronaut, indicator, sensor, value, mission type, phase, date, time,
-- mission day and adaptation.
create view public.readings_detailed
with (security_invoker = true) as
select
  m.id,
  m.user_id                                   as astronaut_id,
  p.name                                      as astronaut,
  m.indicator,
  i.name                                      as indicator_name,
  i.unit,
  m.sensor_id,
  s.name                                      as sensor_name,
  m.value,
  m.status,
  m.source,
  mi.id                                       as mission_id,
  mi.name                                     as mission,
  mi.mission_type,
  case
    when mi.id is null then null
    when m.taken_at < mi.launch_at then 'pre_flight'
    when m.taken_at < coalesce(mi.actual_return_at, mi.planned_return_at) then 'flight'
    else 'post_flight'
  end                                         as phase,
  case when mi.id is null then null
       else floor(extract(epoch from (m.taken_at - mi.launch_at)) / 86400)::integer
  end                                         as mission_day,  -- 0 = launch day, negative = pre-flight
  (m.taken_at at time zone 'UTC')::date       as taken_date,
  (m.taken_at at time zone 'UTC')::time(0)    as taken_time,
  m.taken_at,
  a.adaptation,
  m.repeats_id,
  m.is_simulated,
  m.context,
  m.received_at
from public.measurements m
join public.profiles p        on p.id = m.user_id
join public.indicators i      on i.code = m.indicator
join public.sensors s         on s.id = m.sensor_id
left join public.missions mi  on mi.id = m.mission_id
left join public.daily_adaptation a
       on a.user_id = m.user_id and a.day = (m.taken_at at time zone 'UTC')::date;

-- One row per astronaut per day (UTC) with the LATEST value of each
-- indicator. The full history of a day is in readings_detailed.
create view public.daily_readings
with (security_invoker = true) as
select
  r.astronaut_id,
  max(r.astronaut)                                                         as astronaut,
  r.taken_date                                                             as day,
  (array_agg(r.mission      order by r.taken_at desc))[1]                  as mission,
  (array_agg(r.mission_type order by r.taken_at desc))[1]                  as mission_type,
  (array_agg(r.phase        order by r.taken_at desc))[1]                  as phase,
  (array_agg(r.mission_day  order by r.taken_at desc))[1]                  as mission_day,
  max(r.adaptation)                                                        as adaptation,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'heart_rate'))[1]     as heart_rate,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'hrv'))[1]            as hrv,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'spo2'))[1]           as spo2,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'systolic_bp'))[1]    as systolic_bp,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'diastolic_bp'))[1]   as diastolic_bp,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'temperature'))[1]    as temperature,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'glucose'))[1]        as glucose,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'sleep_min'))[1]      as sleep_min,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'mood_positive'))[1]  as mood_positive,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'mood_negative'))[1]  as mood_negative,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'radiation_dose'))[1] as radiation_dose,
  bool_or(r.is_simulated)                                                  as has_simulated
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;
