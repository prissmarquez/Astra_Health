-- =====================================================================
-- Astra Health · 005 · Crews
-- * Each astronaut belongs to ONE crew at a time (profiles.crew_id).
-- * The crew id is a short readable code, e.g. 'ASTRA-A'.
-- * Each measurement keeps the crew the astronaut had when it was taken,
--   so history does not move if someone changes crew later.
-- * A mission can be assigned to a crew: all its members become
--   participants automatically (and so do people who join that crew
--   before the mission ends).
-- * Sign-up and joining a crew happen outside the database: the external
--   process uses the secret key, or an admin calls set_user_crew().
-- =====================================================================

-- ---------- Crews -----------------------------------------------------

create table public.crews (
  id         text primary key
             check (id ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),  -- e.g. 'ASTRA-A'
  name       text not null check (char_length(name) <= 120),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column crew_id text references public.crews (id)
    on update cascade on delete set null;

alter table public.missions
  add column crew_id text references public.crews (id)
    on update cascade on delete restrict;

-- Snapshot of the astronaut's crew when the measurement was taken.
alter table public.measurements
  add column crew_id text references public.crews (id)
    on update cascade on delete restrict;

create index profiles_crew     on public.profiles (crew_id) where crew_id is not null;
create index missions_crew     on public.missions (crew_id) where crew_id is not null;
create index measurements_crew on public.measurements (crew_id) where crew_id is not null;

-- ---------- Triggers ----------------------------------------------------

-- 1) Every measurement records the astronaut's current crew.
--    Whatever the client sends in crew_id is ignored.
create function public.set_measurement_crew()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select crew_id into new.crew_id
  from public.profiles where id = new.user_id;
  return new;
end;
$$;

create trigger set_measurement_crew
  before insert on public.measurements
  for each row execute function public.set_measurement_crew();

-- 2) Assigning a crew to a mission adds all its members as participants.
create function public.add_crew_to_mission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.crew_id is not null then
    insert into public.mission_participants (mission_id, user_id)
    select new.id, p.id from public.profiles p where p.crew_id = new.crew_id
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger add_crew_to_mission
  after insert or update of crew_id on public.missions
  for each row execute function public.add_crew_to_mission();

-- 3) Joining a crew adds the astronaut to that crew's missions that have
--    not finished yet (post-flight included). Past participations are kept.
create function public.add_member_to_crew_missions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.crew_id is not null
     and (tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id) then
    insert into public.mission_participants (mission_id, user_id)
    select m.id, new.id
    from public.missions m
    join public.mission_types t on t.code = m.mission_type
    where m.crew_id = new.crew_id
      and coalesce(m.actual_return_at, m.planned_return_at)
          + make_interval(days => t.post_flight_days) > now()
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger add_member_to_crew_missions
  after insert or update of crew_id on public.profiles
  for each row execute function public.add_member_to_crew_missions();

-- ---------- Changing someone's crew (admin) -----------------------------

-- Only an admin may call it. The external sign-up process can also set
-- profiles.crew_id directly with the secret key.
create function public.set_user_crew(target_user uuid, target_crew text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change a crew'
      using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set crew_id = target_crew where id = target_user;
  if not found then
    raise exception 'User % not found', target_user
      using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------- Permissions ---------------------------------------------------

alter table public.crews enable row level security;

revoke all on public.crews from anon, authenticated;
grant select, insert, update on public.crews to authenticated;
grant select, insert, update, delete on public.crews to service_role;

-- Crew members see their own crew; the admin sees and manages all of them.
create policy "crews: read own, admin reads all" on public.crews
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.crew_id = crews.id
    )
  );

create policy "crews: admin creates" on public.crews
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "crews: admin updates" on public.crews
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Nobody changes their own crew_id from the app (no column grant);
-- only set_user_crew() (admin) or the secret key can.
revoke all on function public.set_user_crew(uuid, text) from public, anon;
grant execute on function public.set_user_crew(uuid, text) to authenticated, service_role;

-- Trigger functions are not part of the API (same rule as 004).
revoke execute on function
  public.set_measurement_crew(),
  public.add_crew_to_mission(),
  public.add_member_to_crew_missions()
from public, anon, authenticated;

-- ---------- Views: add the crew at the end ------------------------------

create or replace view public.readings_detailed
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
  end                                         as mission_day,
  (m.taken_at at time zone 'UTC')::date       as taken_date,
  (m.taken_at at time zone 'UTC')::time(0)    as taken_time,
  m.taken_at,
  a.adaptation,
  m.repeats_id,
  m.is_simulated,
  m.context,
  m.received_at,
  m.crew_id,                                  -- crew when the measurement was taken
  c.name                                      as crew_name
from public.measurements m
join public.profiles p        on p.id = m.user_id
join public.indicators i      on i.code = m.indicator
join public.sensors s         on s.id = m.sensor_id
left join public.missions mi  on mi.id = m.mission_id
left join public.crews c      on c.id = m.crew_id
left join public.daily_adaptation a
       on a.user_id = m.user_id and a.day = (m.taken_at at time zone 'UTC')::date;

create or replace view public.daily_readings
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
  bool_or(r.is_simulated)                                                  as has_simulated,
  (array_agg(r.crew_id order by r.taken_at desc))[1]                       as crew_id
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;
