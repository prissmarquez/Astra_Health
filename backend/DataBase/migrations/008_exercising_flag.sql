-- =====================================================================
-- Astra Health · 008 · Exercising flag
-- Stores whether the astronaut was exercising when a measurement was
-- taken. The ML health engine (backend/ml/health_engine.py) reads it to
-- choose which ranges apply: during exercise a high temperature or heart
-- rate is expected, so it is not compared with the resting baseline.
-- The ranges themselves live in the ML, not in the database.
-- Measurements are never edited, so the flag is set when the reading is
-- taken. Rows recorded before this migration default to false.
-- =====================================================================

alter table public.measurements
  add column exercising boolean not null default false;

comment on column public.measurements.exercising is
  'True if the astronaut was exercising (or had just finished) when the reading was taken. Used by the ML to apply exercise ranges.';

-- ---------- Views: add the flag at the end ------------------------------

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
  m.exercising                                -- was exercising when taken
from public.measurements m
join public.profiles p        on p.id = m.user_id
join public.indicators i      on i.code = m.indicator
join public.sensors s         on s.id = m.sensor_id
left join public.missions mi  on mi.id = m.mission_id
left join public.crews c      on c.id = m.crew_id
left join public.daily_adaptation a
       on a.user_id = m.user_id and a.day = (m.taken_at at time zone 'UTC')::date;

-- exercising (daily): flag of the day's latest reading of the indicators
-- that exercise changes in the ML (temperature, heart rate, HRV).
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
  (array_agg(r.crew_id order by r.taken_at desc))[1]                       as crew_id,
  coalesce((array_agg(r.exercising order by r.taken_at desc)
            filter (where r.indicator in ('temperature', 'heart_rate', 'hrv')))[1], false)
                                                                           as exercising
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;
