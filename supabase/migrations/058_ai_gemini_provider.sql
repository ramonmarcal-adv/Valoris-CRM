-- ============================================================
-- 058_ai_gemini_provider.sql — add Gemini as a third AI provider
--
-- Widens ai_configs.provider to accept 'gemini' alongside the existing
-- 'openai' / 'anthropic'. Same bring-your-own-key model as the other
-- two — no schema change beyond the CHECK, since `provider`/`model`/
-- `api_key` are already generic text columns.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));
