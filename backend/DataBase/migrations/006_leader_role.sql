-- =====================================================================
-- Astra Health · 006 · Leader role
-- Adds the 'leader' role: a crew member with one extra permission
-- (see 007). It is a separate migration because Postgres cannot use a
-- new enum value in the same transaction that adds it.
-- =====================================================================

alter type public.user_role add value if not exists 'leader';
