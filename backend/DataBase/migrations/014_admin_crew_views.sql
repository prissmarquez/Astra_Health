-- =====================================================================
-- Astra Health · 014 · Admin crew views
-- Two read-only views to build the admin panel:
--   crew_overview         -> one row per crew: leader, members, total and
--                            free slots (out of 4).
--   unassigned_astronauts -> ASP / LDR accounts that are not in a crew,
--                            to fill the "add member" list.
-- Both respect RLS (security_invoker):
--   admin  -> every crew / every unassigned astronaut;
--   crew   -> only their own crew / only themselves if unassigned.
-- Creating crews needs no change: admins can already insert into
-- public.crews (policy "crews: admin creates", migration 005).
-- =====================================================================

create view public.crew_overview
with (security_invoker = true) as
select
  c.id                                                            as crew_id,
  c.name,
  max(coalesce(p.astronaut_code, p.name))
    filter (where p.role = 'leader')                              as leader,
  (array_agg(p.id) filter (where p.role = 'leader'))[1]           as leader_id,
  coalesce(array_agg(coalesce(p.astronaut_code, p.name) order by p.astronaut_code)
    filter (where p.role = 'crew'), '{}')                         as members,
  count(p.id)::integer                                            as total,
  (4 - count(p.id))::integer                                      as free_slots,
  c.created_at
from public.crews c
left join public.profiles p on p.crew_id = c.id
group by c.id, c.name, c.created_at;

create view public.unassigned_astronauts
with (security_invoker = true) as
select
  p.id              as astronaut_id,
  p.astronaut_code,
  p.name,
  p.role,
  p.created_at
from public.profiles p
where p.crew_id is null
  and p.role in ('crew', 'leader');

-- ---------- Permissions -------------------------------------------------------

revoke all on public.crew_overview, public.unassigned_astronauts from anon, authenticated;
grant select on public.crew_overview, public.unassigned_astronauts to authenticated;
grant select on public.crew_overview, public.unassigned_astronauts to service_role;
