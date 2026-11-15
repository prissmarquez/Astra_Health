-- =====================================================================
-- Astra Health · 013 · Health analyses are written by the backend only
-- Migration 010 let any authenticated user INSERT their own analysis row.
-- That let a user forge the ML verdict: POST a 'green' result with empty
-- reasons and a made-up model_version straight to the REST API, without
-- ever running the health engine. The traffic light is a medical record
-- that leaders and admins trust, so it must never be client-writable.
--
-- From now on only the backend (service_role, with the secret key) inserts
-- analyses. The backend still trusts the caller's identity (the JWT owner)
-- and sets astronaut_id from it, so a user can only get a result that the
-- ML actually produced for them. Reading stays exactly as before
-- (own + leader's crew + admin).
--
-- Measurements stay user-writable on purpose: the device reports them as
-- the user. That is why the derived analysis must be the trusted record.
-- =====================================================================

-- Authenticated users keep SELECT (the read policies in 010), but lose INSERT.
revoke insert on public.health_analyses from authenticated;

-- The "insert own" policy no longer has anything to allow: drop it.
-- service_role bypasses RLS, so it needs no policy to keep inserting.
drop policy if exists "health_analyses: insert own" on public.health_analyses;
