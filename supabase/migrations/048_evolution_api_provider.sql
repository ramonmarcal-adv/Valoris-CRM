-- ============================================================
-- 048_evolution_api_provider.sql
--
-- Adds Evolution API (unofficial, self-hosted, Baileys/WhatsApp-Web
-- protocol) as a second WhatsApp provider alongside the existing Meta
-- Cloud API integration. Primary driver: WhatsApp GROUP chat support,
-- which the Meta Cloud API cannot do at all.
--
-- whatsapp_config was UNIQUE(account_id) — one row per account, full
-- stop (017_account_sharing.sql:312-325, whose own comment already
-- anticipated this: "If multi-number-per-account is ever wanted, drop
-- the unique and add a 'primary' boolean"). This migration does
-- exactly that: one row PER PROVIDER per account, with `is_primary`
-- marking which one handles 1:1 sends. Existing rows default
-- api_type='meta_cloud' and is_primary=true, so every account with
-- Meta already configured keeps behaving identically — Evolution
-- rows always start non-primary, so adding one never silently
-- redirects existing 1:1 traffic.
--
-- Group conversations always route to Evolution regardless of
-- is_primary (see resolveProviderConfig in
-- src/lib/whatsapp/resolve-provider-config.ts) — Meta simply cannot
-- send/receive group messages, so that half of the routing isn't a
-- setting, it's a hard constraint.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Meta-only NOT NULLs relaxed — an Evolution row has neither.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token   DROP NOT NULL;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS api_type TEXT NOT NULL DEFAULT 'meta_cloud'
    CHECK (api_type IN ('meta_cloud', 'evolution')),
  ADD COLUMN IF NOT EXISTS instance_name TEXT,
  ADD COLUMN IF NOT EXISTS api_url TEXT,
  -- Encrypted the same way as access_token (src/lib/whatsapp/encryption.ts
  -- encrypt()/decrypt() — reused as-is, no new crypto scheme).
  ADD COLUMN IF NOT EXISTS api_key TEXT,
  -- Encrypted, random per row. Checked (constant-time) on every
  -- inbound POST to /api/whatsapp/evolution-webhook/[configId] since
  -- Evolution has no HMAC-over-body scheme like Meta's
  -- x-hub-signature-256 to verify against instead.
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;

-- Guards a half-filled row of either kind from sitting there silently
-- and only failing at send time instead of at save time.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_fields_chk;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_fields_chk CHECK (
    (api_type = 'meta_cloud' AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
    OR
    (api_type = 'evolution'  AND instance_name IS NOT NULL AND api_url IS NOT NULL AND api_key IS NOT NULL)
  );

-- Exactly one "primary" (1:1 default) row per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_primary_per_account
  ON whatsapp_config(account_id) WHERE is_primary;

-- Was: one row per account, period. Now: one row per (account, provider).
-- UNIQUE(phone_number_id) from 013_whatsapp_config_phone_number_id_unique.sql
-- is untouched and still safe — Postgres treats each NULL as distinct,
-- so N Evolution rows (phone_number_id always NULL) never collide.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_account_id_api_type_key'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_id_api_type_key UNIQUE (account_id, api_type);
  END IF;
END $$;

-- No RLS policy changes — whatsapp_config_select/_insert/_update/_delete
-- (017_account_sharing.sql) are account-scoped, not column-restricted;
-- every new column rides on the existing policies unchanged.
