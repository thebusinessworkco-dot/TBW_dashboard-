-- ONLY run after users table has been migrated and checked.
-- Assumes the existing application users are in public.users and their numeric IDs are preserved.
-- Does not change/create the business tables.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tbw_cloud;
CREATE TABLE IF NOT EXISTS tbw_cloud.auth_links (
  supabase_user_id uuid PRIMARY KEY,
  legacy_user_id bigint NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA tbw_cloud FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tbw_cloud FROM PUBLIC, anon, authenticated;
COMMIT;

-- IMPORTANT: Once the owner has been verified, insert the mapping manually using
-- a parameterized admin migration or SQL Editor, after validating the target user.
-- Never auto-assign 'owner' based on email, and never paste access tokens here.
