-- =====================================================================
-- Astra Health · 001 · Esquema inicial
-- Tablas: perfiles, misiones, participantes_mision, indicadores,
--         sensores, sensor_indicadores, mediciones.
-- Se ejecuta UNA vez, en orden, antes de 002 y 003.
-- =====================================================================

-- ---------- Tipos fijos ----------------------------------------------

-- Etapa de la misión en la que se tomó la medición.
create type public.etapa_mision as enum (
  'prevuelo',     -- entrenamiento y preparación en tierra
  'lanzamiento',  -- día del lanzamiento / ascenso
  'en_orbita',    -- durante el vuelo
  'reingreso',    -- descenso y amerizaje/aterrizaje
  'postvuelo'     -- recuperación en tierra
);

-- ¿Se tomó la medición? Solo 'tomada' lleva valor.
create type public.estado_medicion as enum ('tomada', 'fallida', 'cancelada');

create type public.tipo_sensor as enum (
  'wearable', 'dispositivo', 'cuestionario', 'manual', 'simulador'
);

-- ---------- Perfiles (uno por usuario de Supabase Auth) --------------

create table public.perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  nombre    text not null default '' check (char_length(nombre) <= 120),
  creado_en timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra.
-- El front-end puede mandar el nombre en options.data.nombre del signUp.
create function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'nombre', 120), ''));
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ---------- Misiones y su duración ------------------------------------

create table public.misiones (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null unique,
  fecha_lanzamiento      timestamptz not null,
  fecha_regreso_planeada timestamptz not null,
  fecha_regreso_real     timestamptz,
  -- Se calculan solas a partir de las fechas (en días, con 2 decimales).
  duracion_planeada_dias numeric generated always as (
    round(extract(epoch from (fecha_regreso_planeada - fecha_lanzamiento)) / 86400, 2)
  ) stored,
  duracion_real_dias numeric generated always as (
    round(extract(epoch from (fecha_regreso_real - fecha_lanzamiento)) / 86400, 2)
  ) stored,
  check (fecha_regreso_planeada > fecha_lanzamiento),
  check (fecha_regreso_real is null or fecha_regreso_real > fecha_lanzamiento)
);

-- Quién participa en cada misión (lo administra el equipo de backend).
create table public.participantes_mision (
  mision_id  uuid not null references public.misiones (id) on delete cascade,
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  primary key (mision_id, usuario_id)
);

-- ---------- Catálogos fijos -------------------------------------------

-- Lista fija de indicadores, cada uno con su unidad única.
-- valor_min / valor_max solo filtran errores de captura: NO son umbrales clínicos.
create table public.indicadores (
  codigo      text primary key,
  nombre      text not null,
  unidad      text not null,
  valor_min   numeric not null,
  valor_max   numeric not null,
  descripcion text not null,
  check (valor_min < valor_max)
);

-- Sensores reales (o tipos de registro) con su procedencia.
create table public.sensores (
  id          text primary key,           -- p. ej. 'astroskin'
  nombre      text not null,
  fabricante  text not null,
  agencia     text not null,              -- quién lo usó / desarrolló
  mision_ref  text not null,              -- dónde se usó en vuelo
  tipo        public.tipo_sensor not null,
  verificado  boolean not null,           -- ¿uso en vuelo confirmado por una fuente?
  fuente_url  text,
  notas       text not null default ''
);

-- Qué indicadores puede medir cada sensor (y con qué método).
create table public.sensor_indicadores (
  sensor_id        text not null references public.sensores (id) on delete cascade,
  indicador_codigo text not null references public.indicadores (codigo),
  metodo           text not null,
  primary key (sensor_id, indicador_codigo)
);

-- ---------- Mediciones (una fila por indicador) -----------------------

create table public.mediciones (
  -- UUID generado EN EL DISPOSITIVO: si la sincronización reenvía la misma
  -- medición, choca con esta llave y se ignora (no se duplica).
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid()
              references public.perfiles (id) on delete cascade,
  indicador   text not null references public.indicadores (codigo),
  sensor_id   text not null,                    -- de qué sensor se tomó
  estado      public.estado_medicion not null default 'tomada',  -- si se tomó
  valor       numeric,                          -- el valor que tomó
  tomada_en   timestamptz not null,             -- reloj del dispositivo
  recibida_en timestamptz not null default now(), -- llegada al servidor
  mision_id   uuid references public.misiones (id),
  etapa       public.etapa_mision,
  contexto    text check (char_length(contexto) <= 200),
  origen      text not null default 'app'
              check (origen in ('app', 'sensor_automatico', 'importacion', 'simulador')),
  es_simulado boolean not null default false,
  -- Repetir = fila nueva que apunta a la original. La original no se toca.
  repite_a    uuid,

  -- El sensor debe medir realmente ese indicador.
  foreign key (sensor_id, indicador)
    references public.sensor_indicadores (sensor_id, indicador_codigo),
  -- Diferida: permite enviar original y repetición en el mismo lote.
  foreign key (repite_a) references public.mediciones (id)
    deferrable initially deferred,

  check ((estado = 'tomada') = (valor is not null)),  -- valor solo si se tomó
  check ((mision_id is null) = (etapa is null)),      -- etapa va con su misión
  check (repite_a is null or repite_a <> id)
);

create index mediciones_usuario_indicador_fecha
  on public.mediciones (usuario_id, indicador, tomada_en desc);
create index mediciones_mision_etapa
  on public.mediciones (mision_id, etapa) where mision_id is not null;
create index mediciones_repite_a
  on public.mediciones (repite_a) where repite_a is not null;

-- ---------- Validaciones de mediciones --------------------------------

-- El valor debe caer en el rango del indicador.
create function public.validar_rango_medicion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  minimo numeric;
  maximo numeric;
begin
  if new.valor is not null then
    select valor_min, valor_max into minimo, maximo
    from public.indicadores where codigo = new.indicador;
    if new.valor < minimo or new.valor > maximo then
      raise exception 'Valor % fuera del rango permitido [%, %] para %',
        new.valor, minimo, maximo, new.indicador
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger validar_rango
  before insert on public.mediciones
  for each row execute function public.validar_rango_medicion();

-- Una repetición debe ser del mismo usuario y del mismo indicador.
-- Se revisa al final de la transacción (lotes offline en cualquier orden).
create function public.validar_repeticion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original record;
begin
  if new.repite_a is not null then
    select usuario_id, indicador into original
    from public.mediciones where id = new.repite_a;
    if not found
       or original.usuario_id <> new.usuario_id
       or original.indicador <> new.indicador then
      raise exception 'La medición % no puede repetir a %: debe ser del mismo usuario e indicador',
        new.id, new.repite_a
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger validar_repeticion
  after insert on public.mediciones
  deferrable initially deferred
  for each row execute function public.validar_repeticion();
