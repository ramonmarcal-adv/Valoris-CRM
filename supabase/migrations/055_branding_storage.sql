-- ============================================================
-- 055_branding_storage.sql
--
-- Creates the `branding` Storage bucket for the account's custom logo
-- (Settings → Branding, migration 053's accounts.branding_logo_url).
-- Public reads (the logo renders in every agent's sidebar, no signed
-- URLs), writes restricted to account ADMINS — same
-- `is_account_member(account_id, 'admin')` helper already gating
-- `accounts_update` (017) and other admin-only tables, since this is
-- an account-wide asset, not a personal one.
--
-- File path convention: branding/account-<account_id>/logo-<timestamp>.<ext>
-- — same `account-<account_id>` first-segment convention as chat-media
-- (023) and flow-media (020).
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  TRUE,
  2097152, -- 2 MB, same cap as avatars
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Branding is publicly readable" ON storage.objects;
CREATE POLICY "Branding is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "Admins can upload branding" ON storage.objects;
CREATE POLICY "Admins can upload branding"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND is_account_member(
      substring((storage.foldername(name))[1] from 9)::uuid, -- strip 'account-' prefix
      'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update branding" ON storage.objects;
CREATE POLICY "Admins can update branding"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND is_account_member(
      substring((storage.foldername(name))[1] from 9)::uuid,
      'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete branding" ON storage.objects;
CREATE POLICY "Admins can delete branding"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'branding'
    AND is_account_member(
      substring((storage.foldername(name))[1] from 9)::uuid,
      'admin'
    )
  );
