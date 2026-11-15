-- =====================================================================
-- Astra Health · 004 · Lock trigger functions
-- These functions only run as triggers. Removing EXECUTE from the API
-- roles hides them from /rest/v1/rpc; the triggers keep working because
-- Postgres does not check EXECUTE when a trigger fires.
-- (is_admin() stays executable by signed-in users: the RLS policies need it.)
-- =====================================================================

revoke execute on function
  public.create_profile(),
  public.set_planned_return(),
  public.assign_mission(),
  public.validate_measurement_range(),
  public.validate_repeat()
from public, anon, authenticated;
