-- =====================================================================
-- Astra Health · 016 · Mission codes, a single admin, moving members
-- * Every mission has a readable code: MSN- + 1 to 14 capitals or digits
--   (e.g. MSN-01, MSN-ORION), like crews use ASTRA- and accounts ASP-/LDR-/ADM-.
--   The internal uuid id does not change.
-- * Only ONE admin account can exist (ground), now and in the future.
-- * move_to_mission(): the admin moves a person to another mission (or out
--   of their current ones). Moving between crews already exists
--   (set_user_crew). Leaders and crew members cannot do either.
-- * The views also show the mission code.
-- Applied on an empty missions table.
-- =====================================================================

-- ---------- Mission codes -------------------------------------------------

alter table public.missions
  add column code text not null unique
    check (code ~ '^MSN-[A-Z0-9]{1,14}$');

comment on column public.missions.code is
  'Readable mission Id shown in the app, e.g. MSN-01.';

-- ---------- Only one admin --------------------------------------------------

create unique index one_admin on public.profiles (role) where role = 'admin';

create or replace function public.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  code      text;
  new_role  public.user_role := 'crew';
begin
  -- asp-1001@crew.astra-health.test -> ASP-1001
  if lower(new.email) ~ '^(asp|ldr|adm)-[0-9]{4}@crew\.astra-health\.test$' then
    code := upper(split_part(new.email, '@', 1));
  end if;

  if code like 'ADM-%' then
    if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin' then
      raise exception 'ADM accounts can only be created by the registration process (app_metadata.role = admin)'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from public.profiles where role = 'admin') then
      raise exception 'There is already an admin: only one ADM account is allowed'
        using errcode = 'unique_violation';
    end if;
    new_role := 'admin';
  elsif code like 'LDR-%' then
    new_role := 'leader';
  end if;

  insert into public.profiles (id, name, astronaut_code, role)
  values (new.id,
          coalesce(left(new.raw_user_meta_data ->> 'name', 120), ''),
          code,
          new_role);
  return new;
end;
$$;

-- ---------- Admin: move a person to another mission ---------------------------

-- target_mission = mission code (MSN-...), or null to only leave the current ones.
-- The person leaves every mission that has not finished yet (post-flight
-- included) and joins the new one. Finished missions are kept (history).
-- The 4-participant limit still applies.
create function public.move_to_mission(target_user uuid, target_mission text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_mission uuid;
  user_role_now public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can move people between missions'
      using errcode = 'insufficient_privilege';
  end if;

  select role into user_role_now from public.profiles where id = target_user;
  if not found then
    raise exception 'User % not found', target_user using errcode = 'no_data_found';
  end if;
  if user_role_now = 'admin' then
    raise exception 'The ground admin does not take part in missions'
      using errcode = 'check_violation';
  end if;

  if target_mission is not null then
    select id into new_mission from public.missions where code = upper(target_mission);
    if new_mission is null then
      raise exception 'Mission % not found', target_mission using errcode = 'no_data_found';
    end if;
  end if;

  delete from public.mission_participants mp
  using public.missions m
  join public.mission_types t on t.code = m.mission_type
  where mp.mission_id = m.id
    and mp.user_id = target_user
    and mp.mission_id is distinct from new_mission
    and coalesce(m.actual_return_at, m.planned_return_at)
        + make_interval(days => t.post_flight_days) > now();

  if new_mission is not null then
    insert into public.mission_participants (mission_id, user_id)
    values (new_mission, target_user)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.move_to_mission(uuid, text) from public, anon;
grant execute on function public.move_to_mission(uuid, text) to authenticated, service_role;
revoke execute on function public.create_profile() from public, anon, authenticated;

-- ---------- Views: show the mission code ---------------------------------------

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
  m.crew_id,
  c.name                                      as crew_name,
  m.exercising,
  p.astronaut_code,
  mi.code                                     as mission_code   -- e.g. MSN-01
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
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'heart_rate'))[1]         as heart_rate,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'hrv'))[1]                as hrv,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'spo2'))[1]               as spo2,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'systolic_pressure'))[1]  as systolic_pressure,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'diastolic_pressure'))[1] as diastolic_pressure,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'temperature'))[1]        as temperature,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'glucose'))[1]            as glucose,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'sleep_min'))[1]          as sleep_min,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'positive_mood'))[1]      as positive_mood,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'negative_mood'))[1]      as negative_mood,
  (array_agg(r.value order by r.taken_at desc) filter (where r.indicator = 'radiation_dose'))[1]     as radiation_dose,
  bool_or(r.is_simulated)                                                  as has_simulated,
  (array_agg(r.crew_id order by r.taken_at desc))[1]                       as crew_id,
  coalesce((array_agg(r.exercising order by r.taken_at desc)
            filter (where r.indicator in ('temperature', 'heart_rate', 'hrv')))[1], false)
                                                                           as exercising,
  max(r.astronaut_code)                                                    as astronaut_code,
  (array_agg(r.mission_code order by r.taken_at desc))[1]                  as mission_code
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;
