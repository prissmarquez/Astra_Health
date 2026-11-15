-- =====================================================================
-- Astra Health · 002 · Security (Row Level Security and permissions)
-- Rules:
--   * Without a session nothing is visible.
--   * Crew: see and record only their own data.
--   * Admin (global): sees everyone's data and manages missions.
--   * Nobody edits or deletes measurements.
--   * Only the backend/ML process (secret key) writes daily_adaptation.
-- =====================================================================

alter table public.profiles             enable row level security;
alter table public.mission_types        enable row level security;
alter table public.missions             enable row level security;
alter table public.mission_participants enable row level security;
alter table public.indicators           enable row level security;
alter table public.sensors              enable row level security;
alter table public.sensor_indicators    enable row level security;
alter table public.measurements         enable row level security;
alter table public.daily_adaptation     enable row level security;

-- Start from zero: remove every default privilege from the API roles.
revoke all on public.profiles, public.mission_types, public.missions,
              public.mission_participants, public.indicators, public.sensors,
              public.sensor_indicators, public.measurements, public.daily_adaptation,
              public.readings_detailed, public.daily_readings
  from anon, authenticated;

-- Signed-in users can read (RLS decides which rows)...
grant select on public.profiles, public.mission_types, public.missions,
                public.mission_participants, public.indicators, public.sensors,
                public.sensor_indicators, public.measurements, public.daily_adaptation,
                public.readings_detailed, public.daily_readings
  to authenticated;
-- ...change their own name (never their role)...
grant update (name) on public.profiles to authenticated;
-- ...record measurements (no UPDATE or DELETE: correct by repeating)...
grant insert on public.measurements to authenticated;
-- ...and, if they are admin (checked by RLS), manage missions.
grant insert, update on public.missions to authenticated;
grant insert, delete on public.mission_participants to authenticated;

-- The admin check used inside the policies.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Backend/ML process (secret key, server only): full access for admin tasks
-- such as writing daily_adaptation or loading data. Never use it in the front-end.
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on function public.is_admin() to service_role;

-- ---------- Profiles --------------------------------------------------
create policy "profiles: read own, admin reads all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: update own name" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------- Mission types (read-only catalog) -------------------------
create policy "mission_types: read" on public.mission_types
  for select to authenticated using (true);

-- ---------- Missions --------------------------------------------------
create policy "missions: read own, admin reads all" on public.missions
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.mission_participants p
      where p.mission_id = missions.id and p.user_id = (select auth.uid())
    )
  );

create policy "missions: admin creates" on public.missions
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "missions: admin updates" on public.missions
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------- Mission participants ---------------------------------------
create policy "mission_participants: read own, admin reads all" on public.mission_participants
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "mission_participants: admin adds" on public.mission_participants
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "mission_participants: admin removes" on public.mission_participants
  for delete to authenticated
  using ((select public.is_admin()));

-- ---------- Catalogs (read-only) --------------------------------------
create policy "indicators: read" on public.indicators
  for select to authenticated using (true);
create policy "sensors: read" on public.sensors
  for select to authenticated using (true);
create policy "sensor_indicators: read" on public.sensor_indicators
  for select to authenticated using (true);

-- ---------- Measurements ----------------------------------------------
create policy "measurements: read own, admin reads all" on public.measurements
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Everyone (admin included) records only their own measurements.
create policy "measurements: insert own" on public.measurements
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      mission_id is null
      or exists (
        select 1 from public.mission_participants p
        where p.mission_id = measurements.mission_id
          and p.user_id = (select auth.uid())
      )
    )
  );

-- ---------- Daily adaptation (read-only for users) ---------------------
create policy "daily_adaptation: read own, admin reads all" on public.daily_adaptation
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
