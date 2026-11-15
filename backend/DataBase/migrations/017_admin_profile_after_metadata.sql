-- =====================================================================
-- Astra Health · 017 · Admin profile after app_metadata
-- Supabase Auth creates an account in two steps: it INSERTS the user and
-- then UPDATES its app_metadata. The profile trigger ran on the insert,
-- when app_metadata.role was still missing, so ADM accounts were refused.
-- Now:
--   * ADM account inserted without app_metadata.role = admin -> no profile
--     yet (no error);
--   * when app_metadata.role becomes 'admin' (only the secret key can set
--     it) -> the admin profile is created, if there is no other admin.
-- An ADM email whose app_metadata never says admin gets no profile, so it
-- can see nothing (RLS) and cannot use the app. ASP / LDR accounts are
-- unchanged.
-- =====================================================================

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
      return new;  -- wait for app_metadata (see create_admin_profile below)
    end if;
    if exists (select 1 from public.profiles where role = 'admin') then
      raise exception 'There is already an admin: only one ADM account is allowed'
        using errcode = 'unique_violation';
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

-- Second step: app_metadata.role = 'admin' arrives -> create the admin profile.
create function public.create_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(new.email) ~ '^adm-[0-9]{4}@crew\.astra-health\.test$'
     and coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin'
     and not exists (select 1 from public.profiles where id = new.id) then
    if exists (select 1 from public.profiles where role = 'admin') then
      raise exception 'There is already an admin: only one ADM account is allowed'
        using errcode = 'unique_violation';
    end if;
    insert into public.profiles (id, name, astronaut_code, role)
    values (new.id,
            coalesce(left(new.raw_user_meta_data ->> 'name', 120), ''),
            upper(split_part(new.email, '@', 1)),
            'admin');
  end if;
  return new;
end;
$$;

create trigger on_user_app_metadata_updated
  after update of raw_app_meta_data on auth.users
  for each row execute function public.create_admin_profile();

revoke execute on function public.create_profile(), public.create_admin_profile()
  from public, anon, authenticated;
