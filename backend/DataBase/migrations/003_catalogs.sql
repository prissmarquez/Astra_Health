-- =====================================================================
-- Astra Health · 003 · Catalogs: mission types, indicators, sensors
-- Sensors: the ones chosen by the team, each with where it has flown.
-- Indicator ranges only catch data-entry errors; they are NOT clinical thresholds.
-- =====================================================================

insert into public.mission_types (code, name, pre_flight_days, flight_days, post_flight_days) values
  ('short',    'Short',    10,  14,  7),
  ('standard', 'Standard', 10, 180, 14),
  ('long',     'Long',     10, 365, 21);

insert into public.indicators (code, name, unit, min_value, max_value, entry_method, description) values
  ('heart_rate',     'Heart rate',               'bpm',      20,  250, 'bluetooth',     'Beats per minute.'),
  ('hrv',            'Heart rate variability',   'ms',        1,  300, 'bluetooth',     'Heart rate variability.'),
  ('spo2',           'Oxygen saturation',        '%',        50,  100, 'bluetooth',     'Peripheral oxygen saturation (SpO2).'),
  ('systolic_bp',    'Systolic blood pressure',  'mmHg',     50,  260, 'bluetooth',     'Systolic blood pressure.'),
  ('diastolic_bp',   'Diastolic blood pressure', 'mmHg',     30,  160, 'bluetooth',     'Diastolic blood pressure.'),
  ('temperature',    'Body temperature',         '°C',       30,   45, 'bluetooth',     'Body temperature (skin temperature with Astroskin).'),
  ('glucose',        'Glucose',                  'mg/dL',    20,  600, 'bluetooth',     'Blood or interstitial-fluid glucose.'),
  ('sleep_min',      'Sleep',                    'minutes',   0, 1440, 'calculated',    'Minutes of sleep in the last sleep period (calculated or typed in).'),
  ('mood_positive',  'Positive mood',            'score',    10,   50, 'questionnaire', 'Positive-affect score from the mood questionnaire (10 to 50).'),
  ('mood_negative',  'Negative mood',            'score',    10,   50, 'questionnaire', 'Negative-affect score from the mood questionnaire (10 to 50).'),
  ('radiation_dose', 'Radiation dose',           'mGy',       0, 5000, 'manual',        'Cumulative absorbed dose during the mission, typed in by hand.');

insert into public.sensors (id, name, type, flown_on, source_url, notes) values
  ('astroskin', 'Astroskin', 'wearable',
   'ISS, since 2018', 'https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp',
   'Smart vest developed for the Canadian Space Agency (CSA). Systolic pressure is estimated without a cuff.'),
  ('oura_ring', 'Oura Ring', 'wearable',
   'Axiom Ax-4, 2025', 'https://issnationallab.org/?p=48894',
   'Sleep ring tested on the ISS during the Ax-4 private mission.'),
  ('continuous_glucose_monitor', 'Continuous glucose monitor (CGM)', 'wearable',
   'Axiom Ax-4, 2025 (diabetes study)', 'https://axiomspace.com/release/suite-ride-research-unlocks-potential-for-first-astronaut-with-diabetes',
   'Suite Ride diabetes study.'),
  ('mood_questionnaire', 'Mood questionnaire', 'questionnaire',
   null, null,
   'Text questionnaire in the app: positive and negative scores (10 to 50).'),
  ('manual_entry', 'Manual entry', 'manual',
   null, null,
   'Value typed in by hand (e.g. radiation dose, or diastolic pressure until a sensor is chosen).'),
  ('orbit_health_simulator', 'Orbit Health simulator', 'simulator',
   null, null,
   'Testing only; use with is_simulated = true.');

insert into public.sensor_indicators (sensor_id, indicator_code, method) values
  ('astroskin',                  'heart_rate',    'Vest ECG'),
  ('astroskin',                  'hrv',           'R-R intervals from the vest ECG'),
  ('astroskin',                  'spo2',          'Forehead optical sensor'),
  ('astroskin',                  'systolic_bp',   'Estimated, no cuff'),
  ('astroskin',                  'temperature',   'Skin temperature'),
  ('oura_ring',                  'sleep_min',     'Calculated by the ring'),
  ('continuous_glucose_monitor', 'glucose',       'Continuous glucose monitoring'),
  ('mood_questionnaire',         'mood_positive', 'Text questionnaire'),
  ('mood_questionnaire',         'mood_negative', 'Text questionnaire');

-- Manual entry and the simulator can record any indicator.
insert into public.sensor_indicators (sensor_id, indicator_code, method)
select s.id, i.code,
       case s.id when 'manual_entry' then 'Typed in by hand' else 'Synthetic generator' end
from public.sensors s cross join public.indicators i
where s.id in ('manual_entry', 'orbit_health_simulator');
