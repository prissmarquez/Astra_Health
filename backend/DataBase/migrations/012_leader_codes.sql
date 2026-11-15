-- =====================================================================
-- Astra Health · 012 · Leader codes (LDR-xxxx)
-- The code now defines the role:
--   ASP-xxxx -> crew      (never leader)
--   LDR-xxxx -> leader    (always leader)
--   ADM-xxxx -> admin     (ground, never in a crew)
-- Technical email: ldr-1001@crew.astra-health.test
-- Rules:
--   * Each crew has exactly one LDR. An empty crew accepts no ASP until
--     its LDR joins, so a crew with members always has a leader.
--   * An LDR cannot leave while ASP members remain. To change the leader
--     the admin calls replace_crew_leader(crew, new_ldr): in one step the
--     old LDR leaves the crew and the new one joins.
--   * Whoever leaves a crew is also removed from that crew's missions that
--     have not launched yet (missions in flight or finished keep their
--     participants, for history). This keeps the 4-person limit workable.
--   * Accounts without a code (created before 011) keep the old behaviour.
--   * set_crew_leader() is removed: leadership is no longer transferred
--     to an ASP; replace_crew_leader() takes its place.
-- =====================================================================

-- ---------- Codes and roles ------------------------------------------------

alter table public.profiles
  drop constraint profiles_astronaut_code_check,
  add constraint profiles_astronaut_code_check
    check (astronaut_code ~ '^(ASP|LDR|ADM)-[0-9]{4}$'),
  drop constraint code_matches_role,
  add constraint code_matches_role
    check (astronaut_code is null or role = case left(astronaut_code, 3)
                                              when 'ADM' then 'admin'::public.user_role
                                              when 'LDR' then 'leader'::public.user_role
                                              else 'crew'::public.user_role end),
  -- An LDR may wait without a crew; uncoded leaders still need one.
  drop constraint leader_has_crew,
  add constraint leader_has_crew
    check (role <> 'leader' or crew_id is not null or astronaut_code like 'LDR-%');

comment on column public.profiles.astronaut_code is
  'Login Id shown in the app (ASP-xxxx crew, LDR-xxxx leader, ADM-xxxx ground admin). Taken from the technical email.';

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

-- ---------- Joining / leaving a crew ----------------------------------------

create or replace function public.handle_crew_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  members integer;
  has_leader boolean;
begin
  if tg_op = 'UPDATE' and new.crew_id is not distinct from old.crew_id then
    return new;
  end if;

  -- Accounts without a code keep the previous rules.
  if new.astronaut_code is null and tg_op = 'UPDATE' and old.role = 'leader' then
    new.role := 'crew';
  end if;

  if new.crew_id is not null then
    -- Lock the crew so two people cannot take the 4th place at once.
    perform 1 from public.crews where id = new.crew_id for update;
    select count(*), bool_or(role = 'leader')
      into members, has_leader
    from public.profiles where crew_id = new.crew_id and id <> new.id;
    has_leader := coalesce(has_leader, false);

    if members >= 4 then
      raise exception 'Crew % is full (4 members)', new.crew_id
        using errcode = 'check_violation';
    end if;

    if new.astronaut_code like 'LDR-%' and has_leader then
      raise exception 'Crew % already has a leader: use replace_crew_leader()', new.crew_id
        using errcode = 'check_violation';
    end if;

    if new.astronaut_code like 'ASP-%' and not has_leader then
      raise exception 'Crew % has no leader yet: its LDR must join first', new.crew_id
        using errcode = 'check_violation';
    end if;

    if new.astronaut_code is null and members = 0 and new.role = 'crew' then
      new.role := 'leader';
    end if;
  end if;
  return new;
end;
$$;

-- Leaving a crew removes the person from that crew's missions that have not
-- launched yet. Missions in flight or finished keep them (history).
create function public.leave_crew_missions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.crew_id is not null and new.crew_id is distinct from old.crew_id then
    delete from public.mission_participants mp
    using public.missions m
    where mp.mission_id = m.id
      and mp.user_id = new.id
      and m.crew_id = old.crew_id
      and m.launch_at > now();
  end if;
  return null;
end;
$$;

-- Runs before add_member_to_crew_missions (triggers fire in name order).
create trigger aa_leave_crew_missions
  after update of crew_id on public.profiles
  for each row execute function public.leave_crew_missions();

-- ---------- Admin: replace the leader ---------------------------------------

drop function public.set_crew_leader(uuid);

create function public.replace_crew_leader(target_crew text, new_leader uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_code text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can replace a crew leader'
      using errcode = 'insufficient_privilege';
  end if;
  select astronaut_code into new_code from public.profiles where id = new_leader;
  if new_code is null or new_code not like 'LDR-%' then
    raise exception 'The new leader must be an LDR account'
      using errcode = 'check_violation';
  end if;
  -- The old LDR leaves the crew, then the new one joins (same transaction).
  update public.profiles set crew_id = null
  where crew_id = target_crew and role = 'leader' and id <> new_leader;
  update public.profiles set crew_id = target_crew where id = new_leader;
  if not found then
    raise exception 'User % not found', new_leader using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------- Permissions -------------------------------------------------------

revoke all on function public.replace_crew_leader(text, uuid) from public, anon;
grant execute on function public.replace_crew_leader(text, uuid) to authenticated, service_role;

revoke execute on function public.leave_crew_missions() from public, anon, authenticated;
revoke execute on function public.create_profile() from public, anon, authenticated;
