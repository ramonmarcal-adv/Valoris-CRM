-- ============================================================
-- 084_operation_form_public_rpc.sql
--
-- get_public_form — the only anon-reachable way to read a form's
-- question list. Mirrors peek_invitation (019) exactly: SECURITY
-- DEFINER, returns a hand-shaped JSON object (never maps_to/
-- card_field_def_id/account_id — those would leak internal Card-
-- mapping structure to the internet), the ONLY gate is
-- `is_published = true` (no separate "type" flag — every form
-- supports both the always-available authenticated dashboard fill
-- path and this public path; is_published purely controls whether
-- THIS RPC will serve it).
--
-- Idempotent — safe to run multiple times (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION get_public_form(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form operation_forms%ROWTYPE;
  v_branding_name TEXT;
  v_branding_logo TEXT;
BEGIN
  SELECT * INTO v_form FROM operation_forms
    WHERE slug = p_slug AND archived_at IS NULL AND is_published = true;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT branding_name, branding_logo_url INTO v_branding_name, v_branding_logo
    FROM accounts WHERE id = v_form.account_id;

  RETURN json_build_object(
    'ok', true,
    'form', json_build_object(
      'id', v_form.id,
      'name', v_form.name,
      'description', v_form.description,
      'thank_you_message', v_form.thank_you_message,
      'consent_required', v_form.consent_required,
      'consent_text', v_form.consent_text,
      'branding', json_build_object('name', v_branding_name, 'logo_url', v_branding_logo)
    ),
    'questions', COALESCE((
      SELECT json_agg(json_build_object(
        'id', q.id,
        'field_key', q.field_key,
        'label', q.label,
        'help_text', q.help_text,
        'field_type', q.field_type,
        'field_options', q.field_options,
        'is_required', q.is_required,
        'position', q.position
      ) ORDER BY q.position)
      FROM operation_form_questions q WHERE q.form_id = v_form.id
    ), '[]'::json)
  );
END;
$$;

ALTER FUNCTION get_public_form(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_public_form(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_form(TEXT) TO anon, authenticated;
