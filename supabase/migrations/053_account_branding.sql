-- ============================================================
-- 053_account_branding.sql
--
-- Lets an account customize the app name/logo shown in the sidebar's
-- top-left corner (Settings → Branding, admin-only to edit). Both
-- columns are nullable — NULL means "use the app's built-in default"
-- (name: "Valoris CRM", logo: the bundled mark), so nothing changes
-- for any account until an admin explicitly sets one.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS branding_name TEXT,
  ADD COLUMN IF NOT EXISTS branding_logo_url TEXT;
