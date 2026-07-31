-- ============================================================
-- 052_profile_signature.sql
--
-- Global "sign my messages with my name" preference (Settings → Profile).
-- Defaults to false so nothing changes for anyone until they opt in.
-- The per-conversation composer toggle (message-composer.tsx) reads
-- this as its own default when a thread is first opened, then holds
-- its own local override for that session.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signature_enabled BOOLEAN NOT NULL DEFAULT false;
