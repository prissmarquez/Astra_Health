-- =====================================================================
-- Astra Health · 002 · Seguridad (Row Level Security)
-- Regla general: sin sesión no se ve nada; con sesión, cada usuario
-- solo ve y registra lo suyo. Las mediciones no se editan ni se borran.
-- =====================================================================

alter table public.perfiles             enable row level security;
alter table public.misiones             enable row level security;
alter table public.participantes_mision enable row level security;
alter table public.indicadores          enable row level security;
alter table public.sensores             enable row level security;
alter table public.sensor_indicadores   enable row level security;
alter table public.mediciones           enable row level security;

-- Visitantes sin sesión (rol anon): ningún acceso a estas tablas.
revoke all on public.perfiles, public.misiones, public.participantes_mision,
              public.indicadores, public.sensores, public.sensor_indicadores,
              public.mediciones
  from anon;

-- Usuarios con sesión: solo lectura en general...
revoke all on public.perfiles, public.misiones, public.participantes_mision,
              public.indicadores, public.sensores, public.sensor_indicadores,
              public.mediciones
  from authenticated;
grant select on public.perfiles, public.misiones, public.participantes_mision,
                public.indicadores, public.sensores, public.sensor_indicadores,
                public.mediciones
  to authenticated;
-- ...más lo mínimo para escribir: su nombre y registrar mediciones.
grant update (nombre) on public.perfiles to authenticated;
grant insert on public.mediciones to authenticated;
-- (Sin UPDATE ni DELETE en mediciones: corregir = repetir con repite_a.)

-- ---------- Perfiles --------------------------------------------------
create policy "perfil: ver el propio" on public.perfiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "perfil: cambiar el nombre propio" on public.perfiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------- Misiones --------------------------------------------------
create policy "participantes: ver mis misiones" on public.participantes_mision
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy "misiones: ver solo en las que participo" on public.misiones
  for select to authenticated
  using (exists (
    select 1 from public.participantes_mision p
    where p.mision_id = misiones.id and p.usuario_id = (select auth.uid())
  ));

-- ---------- Catálogos (solo lectura) ----------------------------------
create policy "indicadores: lectura" on public.indicadores
  for select to authenticated using (true);
create policy "sensores: lectura" on public.sensores
  for select to authenticated using (true);
create policy "sensor_indicadores: lectura" on public.sensor_indicadores
  for select to authenticated using (true);

-- ---------- Mediciones ------------------------------------------------
create policy "mediciones: consultar las propias" on public.mediciones
  for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy "mediciones: registrar las propias" on public.mediciones
  for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and (
      mision_id is null
      or exists (
        select 1 from public.participantes_mision p
        where p.mision_id = mediciones.mision_id
          and p.usuario_id = (select auth.uid())
      )
    )
  );
