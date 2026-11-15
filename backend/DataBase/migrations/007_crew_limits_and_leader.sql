-- =====================================================================
-- Astra Health · 007 · Crew limits and leader
-- * At most 4 members per crew and 4 participants per mission.
-- * Roles: crew, leader (crew member with one extra permission) and the
--   ground admin. Admins cannot join a crew.
-- * A crew with members ALWAYS has exactly one leader:
--     - the first person to join an empty crew becomes its leader;
--     - the admin transfers leadership with set_crew_leader();
--     - a leader cannot leave (or be removed) while other members remain:
--       leadership must be transferred first.
-- * A mission can only be assigned to a crew that has a leader.
-- * What crewmates see of each other:
--     crew   -> crewmates' names + the LATEST value of the selected
--               indicator (crew_latest) + their latest adaptation;
--     leader -> the same + the FULL history of the crew (measurements
--               taken while in this crew) and their adaptation history;
--     admin  -> everything (unchanged).
-- * Realtime is enabled on measurements so leaders and admins can follow
--   new readings live (Realtime respects these same RLS rules).
-- =====================================================================

-- ---------- Rules on profiles ---------------------------------------------

-- A leader always belongs to a crew; ground admins never do.
alter table public.profiles
  add constraint leader_has_crew check (role <> 'leader' or crew_id is not null),
  add constraint admin_has_no_crew check (role <> 'admin' or crew_id is null);

-- At most one leader per crew.
create unique index one_leader_per_crew
  on public.profiles (crew_id) where role = 'leader';

-- Joining / leaving a crew:
--  * at most 4 members;
--  * first member of an empty crew becomes its leader;
--  * a leader who leaves goes back to 'crew' (the check below makes sure
--    nobody is left behind without a leader).
create function public.handle_crew_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  members integer;
begin
  if tg_op = 'UPDATE' and new.crew_id is not distinct from old.crew_id then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.role = 'leader' then
    new.role := 'crew';
  end if;

  if new.crew_id is not null then
    -- Lock the crew so two people cannot take the 4th place at once.
    perform 1 from public.crews where id = new.crew_id for update;
    select count(*) into members
    from public.profiles where crew_id = new.crew_id and id <> new.id;
    if members >= 4 then
      raise exception 'Crew % is full (4 members)', new.crew_id
        using errcode = 'check_violation';
    end if;
    if members = 0 and new.role = 'crew' then
      new.role := 'leader';
    end if;
  end if;
  return new;
end;
$$;

create trigger handle_crew_change
  before insert or update of crew_id on public.profiles
  for each row execute function public.handle_crew_change();

-- At the end of each transaction: every crew with members has exactly one leader.
create function public.check_crew_has_leader()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  crew text;
  members integer;
  leaders integer;
begin
  foreach crew in array array[
    case when tg_op <> 'INSERT' then old.crew_id end,
    case when tg_op <> 'DELETE' then new.crew_id end
  ] loop
    continue when crew is null;
    select count(*), count(*) filter (where role = 'leader')
      into members, leaders
    from public.profiles where crew_id = crew;
    if members > 0 and leaders <> 1 then
      raise exception 'Crew % must have exactly one leader: transfer leadership with set_crew_leader() first', crew
        using errcode = 'check_violation';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger check_crew_has_leader
  after insert or update or delete on public.profiles
  deferrable initially deferred
  for each row execute function public.check_crew_has_leader();

-- ---------- Rules on missions ---------------------------------------------

-- At most 4 participants per mission (re-adding an existing one is fine).
create function public.check_mission_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  participants integer;
begin
  if exists (select 1 from public.mission_participants
             where mission_id = new.mission_id and user_id = new.user_id) then
    return new;  -- already in: ON CONFLICT will skip it
  end if;
  perform 1 from public.missions where id = new.mission_id for update;
  select count(*) into participants
  from public.mission_participants where mission_id = new.mission_id;
  if participants >= 4 then
    raise exception 'Mission is full (4 participants)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger check_mission_capacity
  before insert on public.mission_participants
  for each row execute function public.check_mission_capacity();

-- A mission can only be assigned to a crew that has a leader.
create function public.check_mission_crew_has_leader()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.crew_id is not null and not exists (
    select 1 from public.profiles where crew_id = new.crew_id and role = 'leader'
  ) then
    raise exception 'Crew % has no leader yet: it cannot be assigned to a mission', new.crew_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger check_mission_crew_has_leader
  before insert or update of crew_id on public.missions
  for each row execute function public.check_mission_crew_has_leader();

-- ---------- Helpers used by the policies -----------------------------------

-- The signed-in user's current crew (null if none).
create function public.current_crew_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select crew_id from public.profiles where id = (select auth.uid());
$$;

-- True when the signed-in user is the leader of their crew.
create function public.is_crew_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'leader'
  );
$$;

-- ---------- Admin: transfer leadership --------------------------------------

create function public.set_crew_leader(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_crew text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can choose a crew leader'
      using errcode = 'insufficient_privilege';
  end if;
  select crew_id into target_crew from public.profiles where id = target_user;
  if target_crew is null then
    raise exception 'User % is not in a crew', target_user
      using errcode = 'check_violation';
  end if;
  update public.profiles set role = 'crew'
  where crew_id = target_crew and role = 'leader' and id <> target_user;
  update public.profiles set role = 'leader' where id = target_user;
end;
$$;

-- ---------- Crewmates: latest value of the selected indicator ---------------

-- For each crewmate (not the caller): the latest value of each indicator
-- (or only p_indicator), taken while in the caller's crew, plus their
-- latest adaptation score.
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
  adaptation_day date
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
    select p.id, p.name, p.role
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
         l.sensor_id, l.taken_at, a.adaptation, a.day
  from mates mt
  left join latest l on l.user_id = mt.id
  left join public.indicators i on i.code = l.indicator
  left join lateral (
    select d.adaptation, d.day from public.daily_adaptation d
    where d.user_id = mt.id order by d.day desc limit 1
  ) a on true
  order by mt.name, l.indicator;
$$;

-- ---------- Policies (added to the existing ones) ---------------------------

-- Crewmates can see each other's profile (name and role).
create policy "profiles: crewmates read each other" on public.profiles
  for select to authenticated
  using (crew_id is not null and crew_id = (select public.current_crew_id()));

-- The leader reads the crew's full history (measurements taken in this crew).
create policy "measurements: leader reads crew history" on public.measurements
  for select to authenticated
  using ((select public.is_crew_leader()) and crew_id = (select public.current_crew_id()));

-- The leader reads the crew's adaptation history.
create policy "daily_adaptation: leader reads crew" on public.daily_adaptation
  for select to authenticated
  using (
    (select public.is_crew_leader())
    and exists (
      select 1 from public.profiles p
      where p.id = daily_adaptation.user_id
        and p.crew_id = (select public.current_crew_id())
    )
  );

-- ---------- Function permissions --------------------------------------------

revoke all on function
  public.current_crew_id(), public.is_crew_leader(),
  public.set_crew_leader(uuid), public.crew_latest(text)
from public, anon;
grant execute on function
  public.current_crew_id(), public.is_crew_leader(),
  public.set_crew_leader(uuid), public.crew_latest(text)
to authenticated, service_role;

-- Trigger functions are not part of the API (same rule as 004).
revoke execute on function
  public.handle_crew_change(), public.check_crew_has_leader(),
  public.check_mission_capacity(), public.check_mission_crew_has_leader()
from public, anon, authenticated;

-- ---------- Realtime --------------------------------------------------------

-- New measurements are pushed live to subscribed clients, filtered by RLS.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime'
                       and schemaname = 'public' and tablename = 'measurements') then
    alter publication supabase_realtime add table public.measurements;
  end if;
end;
$$;
