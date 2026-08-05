-- ============================================================
-- 080_operation_automation_dispatch.sql
--
-- Instant event dispatch + self-scheduled cron, both entirely inside
-- Postgres via pg_net + pg_cron (both confirmed available on this
-- project). This replaces the originally-planned outbox+polling-cron
-- design after the user confirmed automation dispatch needs to be
-- near-instant, not ~1min-latency polling — and avoids the
-- alternative of rewriting Release A/B's client-side Kanban/Task
-- mutations to go through new server API routes, which was ruled out
-- as too large/risky a refactor of code already in production.
--
-- - Event dispatch: a trigger on operation_card_activity calls
--   net.http_post() (async, non-blocking) the instant a row is
--   inserted — sub-second latency in practice, no polling.
-- - wait-resume / time-based sweeps: genuinely can't be instant (they
--   depend on the passage of time, not a write), so those stay
--   periodic — but self-scheduled by pg_cron from inside Postgres,
--   not by an external pinger or Vercel Cron/GitHub Actions. This is
--   NOT how the three PRE-EXISTING cron routes for the Deal/
--   Conversation engine work (they still rely on an undocumented
--   external pinger) — untouched, out of scope here.
--
-- Webhook URL/secrets live in private.automation_webhook_config
-- rather than hardcoded in this migration, so they can be changed
-- per-environment (preview/staging/prod) without a new migration. The
-- `private` schema is never exposed via PostgREST (Supabase only
-- serves schemas explicitly listed in its API config), so this table
-- needs no RLS to stay inaccessible to normal clients.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.automation_webhook_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Populate manually after this migration runs (values are
-- environment-specific and shouldn't live in version control):
--   INSERT INTO private.automation_webhook_config (key, value) VALUES
--     ('dispatch_url', 'https://<app-domain>/api/operations/automations/dispatch'),
--     ('dispatch_secret', '<OPERATION_AUTOMATION_WEBHOOK_SECRET>'),
--     ('cron_resume_url', 'https://<app-domain>/api/operations/automations/resume-cron'),
--     ('cron_sweep_url', 'https://<app-domain>/api/operations/automations/time-sweep-cron'),
--     ('cron_secret', '<OPERATION_AUTOMATION_CRON_SECRET>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Until these rows exist, the trigger/cron functions below degrade to
-- silent no-ops rather than erroring on every Operations write.

CREATE OR REPLACE FUNCTION notify_operation_automation_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM private.automation_webhook_config WHERE key = 'dispatch_url';
  SELECT value INTO v_secret FROM private.automation_webhook_config WHERE key = 'dispatch_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-automation-secret', v_secret),
    body := jsonb_build_object(
      'event_id', NEW.id, 'event_type', NEW.event_type, 'card_id', NEW.card_id,
      'account_id', NEW.account_id, 'chain_depth', NEW.chain_depth, 'payload', NEW.payload
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_operation_automation_dispatch ON operation_card_activity;
CREATE TRIGGER trg_notify_operation_automation_dispatch
  AFTER INSERT ON operation_card_activity
  FOR EACH ROW EXECUTE FUNCTION notify_operation_automation_dispatch();

-- ============================================================
-- pg_cron — self-scheduled sweeps, no external pinger required.
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_operation_automation_resume()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM private.automation_webhook_config WHERE key = 'cron_resume_url';
  SELECT value INTO v_secret FROM private.automation_webhook_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(url := v_url, headers := jsonb_build_object('x-automation-secret', v_secret));
END;
$$;

CREATE OR REPLACE FUNCTION trigger_operation_automation_time_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM private.automation_webhook_config WHERE key = 'cron_sweep_url';
  SELECT value INTO v_secret FROM private.automation_webhook_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(url := v_url, headers := jsonb_build_object('x-automation-secret', v_secret));
END;
$$;

-- cron.schedule upserts by job name (pg_cron >=1.4) — safe to re-run.
SELECT cron.schedule('operation-automation-resume', '* * * * *', 'SELECT trigger_operation_automation_resume();');
SELECT cron.schedule('operation-automation-time-sweep', '*/15 * * * *', 'SELECT trigger_operation_automation_time_sweep();');
