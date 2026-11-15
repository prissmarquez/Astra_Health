-- =====================================================================
-- Astra Health · 011 · Astronaut codes (login with ASP-xxxx / ADM-xxxx)
-- * Every account gets a short code shown in the app as its Id:
--     ASP-xxxx -> astronauts (crew / leader)
--     ADM-xxxx -> ground admins
-- * Supabase Auth always needs an email, so each account uses a
--   technical email derived from its code that nobody sees or types:
--     ASP-1001 -> asp-1001@crew.astra-health.test
--   The login screen asks for the code and builds that email.
-- * The code is read from the email when the account is created, so the
--   code and the account can never get out of step. Nobody can edit it.
-- * Accounts are created by the external registration process with the
--   secret key. An ADM account must also carry app_metadata.role = 'admin'
--   (only the secret key can set app_metadata), otherwise it is rejected:
--   nobody becomes admin just by choosing an ADM email.
-- =====================================================================

alter table public.profiles
  add column astronaut_code text unique
    check (astronaut_code ~ '^(ASP|ADM)-[0-9]{4}$'),
  -- ADM codes are always admins and admins always have an ADM code.
  add constraint code_matches_role
    check (astronaut_code is null or ((astronaut_code like 'ADM-%') = (role = 'admin')));

comment on column public.profiles.astronaut_code is
  'Login Id shown in the app (ASP-xxxx astronaut, ADM-xxxx ground admin). Taken from the technical email.';

-- ---------- Profile creation reads the code -------------------------------

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
  if lower(new.email) ~ '^(asp|adm)-[0-9]{4}@crew\.astra-health\.test$' then
    code := upper(split_part(new.email, '@', 1));
  end if;

  if code like 'ADM-%' then
    if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin' then
      raise exception 'ADM accounts can only be created by the registration process (app_metadata.role = admin)'
        using errcode = 'insufficient_privilege';
    end if;
    new_role := 'admin';
  end if;

  insert into public.profiles (id, name, astronaut_code, role)
  values (new.id,
          coalesce(left(new.raw_user_meta_data ->> 'name', 120), ''),
          code,
          new_role);
  return new;
end;
$$;

revoke execute on function public.create_profile() from public, anon, authenticated;

-- ---------- Views: show the code ------------------------------------------

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
  p.astronaut_code                            -- login Id, e.g. ASP-1001
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
  max(r.astronaut_code)                                                    as astronaut_code
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;

-- ---------- crew_latest: also return the code ------------------------------
-- The return type changes, so the function is recreated with its permissions.

drop function public.crew_latest(text);

create function public.crew_latest(p_indicator text default null)
returns table (
  astronaut_id   uuid,
  astronaut      text,
  role           public.user_role,
  indicator      text,
  indicator_name text,
  unit           text,
  value          numeric,
  sensor_id      text,
  taken_at       timestamptz,
  adaptation     numeric,
  adaptation_day date,
  astronaut_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select crew_id from public.profiles where id = (select auth.uid())
  ),
  mates as (
    select p.id, p.name, p.role, p.astronaut_code
    from public.profiles p, me
    where me.crew_id is not null
      and p.crew_id = me.crew_id
      and p.id <> (select auth.uid())
  ),
  latest as (
    select distinct on (m.user_id, m.indicator)
           m.user_id, m.indicator, m.value, m.sensor_id, m.taken_at
    from public.measurements m, me
    where m.user_id in (select id from mates)
      and m.crew_id = me.crew_id
      and m.status = 'taken'
      and (p_indicator is null or m.indicator = p_indicator)
    order by m.user_id, m.indicator, m.taken_at desc
  )
  select mt.id, mt.name, mt.role, l.indicator, i.name, i.unit, l.value,
         l.sensor_id, l.taken_at, a.adaptation, a.day, mt.astronaut_code
  from mates mt
  left join latest l on l.user_id = mt.id
  left join public.indicators i on i.code = l.indicator
  left join lateral (
    select d.adaptation, d.day from public.daily_adaptation d
    where d.user_id = mt.id order by d.day desc limit 1
  ) a on true
  order by mt.astronaut_code, l.indicator;
$$;

revoke all on function public.crew_latest(text) from public, anon;
grant execute on function public.crew_latest(text) to authenticated, service_role;
