-- =====================================================================
-- Astra Health · 009 · Rename indicator codes to match the ML
-- The ML health engine (backend/ml/health_engine.py) and its trained
-- model use these names, so the database adopts them (the model is not
-- retrained):
--   systolic_bp   -> systolic_pressure
--   diastolic_bp  -> diastolic_pressure
--   mood_positive -> positive_mood
--   mood_negative -> negative_mood
-- The foreign keys have no ON UPDATE CASCADE, so each code is copied,
-- references are moved, and the old code is removed.
-- =====================================================================

-- The rename list, used by every step below.
create function pg_temp.indicator_renames()
returns table (old_code text, new_code text)
language sql as $$
  values ('systolic_bp',   'systolic_pressure'),
         ('diastolic_bp',  'diastolic_pressure'),
         ('mood_positive', 'positive_mood'),
         ('mood_negative', 'negative_mood')
$$;

-- 1) New indicator rows (same name, unit, range and description).
insert into public.indicators (code, name, unit, min_value, max_value, entry_method, description)
select r.new_code, i.name, i.unit, i.min_value, i.max_value, i.entry_method, i.description
from public.indicators i
join pg_temp.indicator_renames() r on r.old_code = i.code;

-- 2) Which sensor measures them.
insert into public.sensor_indicators (sensor_id, indicator_code, method)
select si.sensor_id, r.new_code, si.method
from public.sensor_indicators si
join pg_temp.indicator_renames() r on r.old_code = si.indicator_code;

-- 3) Existing measurements (a data fix, not an edit of the reading).
update public.measurements m
set indicator = r.new_code
from pg_temp.indicator_renames() r
where m.indicator = r.old_code;

-- 4) Remove the old codes.
delete from public.sensor_indicators si
using pg_temp.indicator_renames() r
where si.indicator_code = r.old_code;

delete from public.indicators i
using pg_temp.indicator_renames() r
where i.code = r.old_code;

-- ---------- daily_readings: columns renamed ------------------------------
-- A view cannot rename its columns with CREATE OR REPLACE, so it is
-- recreated and its permissions are granted again (as in 002).

drop view public.daily_readings;

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
                                                                           as exercising
from public.readings_detailed r
where r.status = 'taken'
group by r.astronaut_id, r.taken_date;

revoke all on public.daily_readings from anon, authenticated;
grant select on public.daily_readings to authenticated;
grant select, insert, update, delete on public.daily_readings to service_role;
