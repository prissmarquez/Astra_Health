-- =====================================================================
-- Astra Health · 015 · Crew id prefix
-- Every crew id starts with ASTRA-, like profile codes start with
-- ASP- / LDR- / ADM-:
--   ASTRA- + 1 to 14 capitals or digits, e.g. ASTRA-B, ASTRA-07, ASTRA-ORION
-- The API (POST /admin/crews) and the admin page check the same format;
-- this rule also covers crews inserted directly in Supabase.
-- Existing crews must already follow it (the only non-matching one, an
-- empty test crew, was removed before applying this migration).
-- =====================================================================

alter table public.crews
  drop constraint crews_id_check,
  add constraint crews_id_check check (id ~ '^ASTRA-[A-Z0-9]{1,14}$');
