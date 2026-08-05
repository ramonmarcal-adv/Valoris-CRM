-- ============================================================
-- 079_operation_checklist_templates.sql
--
-- Checklist templates (PRD 14) as their OWN entity, independent of
-- operation_task_templates — confirmed with the user: not reusing
-- operation_task_template_checklist_items, since that would tie
-- checklist templates to the task-template admin UI instead of giving
-- them their own first-class CRUD surface. Structurally this is a
-- straight mirror of 069's operation_task_templates (global-or-board
-- nullable board_id, admin+ RLS, clone-on-apply with no live binding
-- back) minus everything task-specific (priority, assignee, due
-- offset, subtasks).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_checklist_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id     UUID REFERENCES operation_boards(id) ON DELETE CASCADE, -- NULL = global to the account
  name         TEXT NOT NULL,
  description  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_checklist_templates_account_board
  ON operation_checklist_templates(account_id, board_id);

ALTER TABLE operation_checklist_templates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_checklist_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_checklist_templates_select ON operation_checklist_templates;
DROP POLICY IF EXISTS operation_checklist_templates_modify ON operation_checklist_templates;
CREATE POLICY operation_checklist_templates_select ON operation_checklist_templates FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_checklist_templates_modify ON operation_checklist_templates FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS operation_checklist_template_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id  UUID NOT NULL REFERENCES operation_checklist_templates(id) ON DELETE CASCADE,
  item_text    TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_operation_checklist_template_items_template
  ON operation_checklist_template_items(template_id, position);

ALTER TABLE operation_checklist_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_checklist_template_items_select ON operation_checklist_template_items;
DROP POLICY IF EXISTS operation_checklist_template_items_modify ON operation_checklist_template_items;
CREATE POLICY operation_checklist_template_items_select ON operation_checklist_template_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_checklist_templates tpl WHERE tpl.id = operation_checklist_template_items.template_id AND is_account_member(tpl.account_id))
);
CREATE POLICY operation_checklist_template_items_modify ON operation_checklist_template_items FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_checklist_templates tpl WHERE tpl.id = operation_checklist_template_items.template_id AND is_account_member(tpl.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_checklist_templates tpl WHERE tpl.id = operation_checklist_template_items.template_id AND is_account_member(tpl.account_id, 'admin'))
);

-- ============================================================
-- apply_checklist_template — clones a template's items onto a NEW
-- checklist attached to either a card or a task (XOR, mirroring
-- operation_checklists itself). Independent copy, same clone-on-apply
-- precedent as apply_task_template (072): editing/deleting the
-- template later never touches checklists already created from it.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_checklist_template(
  p_template_id UUID,
  p_card_id UUID DEFAULT NULL,
  p_task_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_template operation_checklist_templates%ROWTYPE;
  v_checklist_id UUID;
BEGIN
  IF (p_card_id IS NULL) = (p_task_id IS NULL) THEN
    RAISE EXCEPTION 'apply_checklist_template: exactly one of p_card_id / p_task_id must be provided';
  END IF;

  SELECT * INTO v_template FROM operation_checklist_templates WHERE id = p_template_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_checklist_template: template % not found or archived', p_template_id;
  END IF;

  INSERT INTO operation_checklists (card_id, task_id, title)
  VALUES (p_card_id, p_task_id, v_template.name)
  RETURNING id INTO v_checklist_id;

  INSERT INTO operation_checklist_items (checklist_id, item_text, position)
  SELECT v_checklist_id, item_text, position
  FROM operation_checklist_template_items
  WHERE template_id = p_template_id
  ORDER BY position;

  RETURN v_checklist_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_checklist_template(UUID, UUID, UUID) TO authenticated;
