-- =====================================================================
-- Astra Health · 003 · Catálogos: indicadores, sensores y qué mide cada uno
-- Los rangos solo detectan errores de captura; NO son umbrales clínicos.
-- =====================================================================

insert into public.indicadores (codigo, nombre, unidad, valor_min, valor_max, descripcion) values
  ('frecuencia_cardiaca', 'Frecuencia cardiaca',        'lpm',       20,  250, 'Latidos por minuto.'),
  ('spo2',                'Saturación de oxígeno',      '%',         50,  100, 'Saturación periférica de oxígeno (SpO2).'),
  ('presion_sistolica',   'Presión arterial sistólica', 'mmHg',      50,  260, 'Presión sistólica.'),
  ('glucosa',             'Glucosa',                    'mg/dL',     20,  600, 'Glucosa en sangre o líquido intersticial (CGM).'),
  ('temperatura_central', 'Temperatura central',        '°C',        30,   45, 'Temperatura del núcleo corporal.'),
  ('temperatura_piel',    'Temperatura de la piel',     '°C',        20,   45, 'Temperatura superficial de la piel.'),
  ('sueno',               'Sueño',                      'horas',      0,   24, 'Duración del último periodo de sueño.'),
  ('animo',               'Estado de ánimo',            'escala 1-5', 1,    5, 'Autorreporte: 1 muy bajo a 5 muy alto. Escala propia, no validada clínicamente.'),
  ('radiacion_dosis',     'Dosis de radiación',         'mGy',        0, 5000, 'Dosis absorbida acumulada en la misión, según el dosímetro personal.');

insert into public.sensores (id, nombre, fabricante, agencia, mision_ref, tipo, verificado, fuente_url, notas) values
  ('astroskin', 'Astroskin (Bio-Monitor)', 'Carré Technologies', 'Agencia Espacial Canadiense (CSA)',
   'ISS, Expedición 58 (2018-2019)', 'wearable', true,
   'https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp',
   'Camiseta y banda con sensores. La presión sistólica se estima combinando varios sensores.'),
  ('thermolab', 'Thermolab (sensor doble de flujo de calor)', 'Dräger', 'DLR / ESA (Charité Berlín)',
   'ISS, desde 2009', 'wearable', true,
   'https://www.esa.int/es/articles/space-fever',
   'Sensores en frente y esternón; calcula la temperatura central sin sonda.'),
  ('actiwatch', 'Actiwatch (actígrafo de muñeca)', 'Philips Respironics (Mini Mitter)', 'NASA',
   'ISS, estudio Sleep-Long', 'wearable', true,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC4188436',
   'Acelerómetro y sensor de luz; estima sueño/vigilia. Modelo exacto varía por estudio.'),
  ('dexcom_g6', 'Dexcom G6 (monitor continuo de glucosa)', 'Dexcom', 'SpaceX (misión privada)',
   'Polaris Dawn (2024)', 'wearable', true,
   'https://www.businesswire.com/news/home/20240827030657/en/Dexcom-CGM-Worn-in-Outer-Space-as-Part-of-First-of-its-Kind-Polaris-Dawn-Mission',
   'Mide glucosa en líquido intersticial.'),
  ('apple_watch_s6', 'Apple Watch Series 6', 'Apple', 'SpaceX / Penn Medicine / TRISH',
   'Inspiration4 (2021)', 'wearable', true,
   'https://appleinsider.com/articles/21/09/04/spacex-mission-turns-to-apple-watch-iphone-ipad-for-health-study',
   'Usado en la misión del dataset real de este proyecto.'),
  ('crew_active_dosimeter', 'Crew Active Dosimeter (CAD)', 'Mirion', 'NASA (Space Radiation Analysis Group)',
   'ISS desde 2020; Artemis II (2026)', 'dispositivo', true,
   'https://srag.jsc.nasa.gov/spaceradiation/how/how.cfm',
   'Dosímetro personal activo; reporta dosis acumulada y tasa de dosis.'),
  ('cuestionario_animo', 'Cuestionario de ánimo de la app', 'Astra Health', 'Inspirado en NASA APEX (POMS)',
   'No aplica', 'cuestionario', false,
   'https://ntrs.nasa.gov/api/citations/20260002661/downloads/Bell_APEX_IWS_2026_final.pdf',
   'Escala propia 1-5. NO es el puntaje POMS.'),
  ('registro_manual', 'Registro manual', 'No aplica', 'No aplica',
   'No aplica', 'manual', false, null,
   'Valor capturado a mano por el usuario.'),
  ('simulador_orbit_health', 'Simulador Orbit Health', 'Astra Health', 'No aplica',
   'Datos sintéticos', 'simulador', false, null,
   'Solo para pruebas; usar con es_simulado = true.');

insert into public.sensor_indicadores (sensor_id, indicador_codigo, metodo) values
  ('astroskin',             'frecuencia_cardiaca', 'Electrocardiograma (ECG)'),
  ('astroskin',             'spo2',                'Oximetría óptica en banda de cabeza'),
  ('astroskin',             'presion_sistolica',   'Estimada combinando varios sensores'),
  ('astroskin',             'temperatura_piel',    'Sensor de temperatura cutánea'),
  ('thermolab',             'temperatura_central', 'Flujo de calor (frente y esternón)'),
  ('actiwatch',             'sueno',               'Actigrafía'),
  ('dexcom_g6',             'glucosa',             'Sensor electroquímico subcutáneo'),
  ('apple_watch_s6',        'frecuencia_cardiaca', 'Fotopletismografía / ECG'),
  ('apple_watch_s6',        'spo2',                'Oximetría óptica de muñeca'),
  ('apple_watch_s6',        'sueno',               'Acelerómetro y frecuencia cardiaca'),
  ('crew_active_dosimeter', 'radiacion_dosis',     'Direct Ion Storage'),
  ('cuestionario_animo',    'animo',               'Autorreporte en la app');

-- Registro manual y simulador pueden capturar cualquier indicador.
insert into public.sensor_indicadores (sensor_id, indicador_codigo, metodo)
select s.id, i.codigo,
       case s.id when 'registro_manual' then 'Captura manual' else 'Generador sintético' end
from public.sensores s cross join public.indicadores i
where s.id in ('registro_manual', 'simulador_orbit_health');
