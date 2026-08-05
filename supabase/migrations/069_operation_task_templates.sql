-- ============================================================
-- 069_operation_task_templates.sql
--
-- Task/checklist templates (PRD 14) — global to the organization
-- (board_id NULL) or specific to one board, reusing the exact same
-- nullable-FK pattern already established by operation_boards.folder_id
-- (a board can exist without a folder; a template can exist without
-- a board).
--
-- Applying a template creates an INDEPENDENT copy — editing/deleting
-- the template later never touches tasks already created from it.
-- Same behavioral precedent as the static Flow/Automation templates
-- (src/lib/flows/templates.ts): clone on apply, no live binding back.
-- source_template_id on operation_tasks (added below) is purely for
-- traceability + duplicate-prevention, not a live reference — hence
-- ON DELETE SET NULL, not CASCADE or RESTRICT.
--
-- RLS is admin+ for editing the template definitions (same tier as
-- operation_card_field_defs — defining reusable structure is
-- structural, not day-to-day). APPLYING a template to a card stays
-- agent+, enforced entirely by operation_tasks' own agent+ RLS (the
-- apply_task_template RPC in 072 only needs SELECT here, which is
-- viewer+, and INSERT into operation_tasks/operation_checklists).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_task_templates (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id                 UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id                   UUID REFERENCES operation_boards(id) ON DELETE CASCADE, -- NULL = global to the account
  name                       TEXT NOT NULL,
  description                TEXT,
  default_priority           TEXT NOT NULL DEFAULT 'normal'
                                CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
  default_assignee_mode      TEXT NOT NULL DEFAULT 'none'
                                CHECK (default_assignee_mode IN ('none', 'specific_user', 'card_assignee')),
  default_assignee_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  default_due_offset_days    INTEGER,
  default_section            TEXT,
  position                   INTEGER NOT NULL DEFAULT 0,
  archived_at                TIMESTAMPTZ,
  created_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (default_assignee_mode <> 'specific_user' OR default_assignee_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_operation_task_templates_account_board
  ON operation_task_templates(account_id, board_id);

ALTER TABLE operation_task_templates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_task_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_task_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_task_templates_select ON operation_task_templates;
DROP POLICY IF EXISTS operation_task_templates_modify ON operation_task_templates;
CREATE POLICY operation_task_templates_select ON operation_task_templates FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_task_templates_modify ON operation_task_templates FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- OPERATION_TASK_TEMPLATE_SUBTASKS — the subtasks a template clones
-- onto the new top-level task when applied.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_task_template_subtasks (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id                UUID NOT NULL REFERENCES operation_task_templates(id) ON DELETE CASCADE,
  title                      TEXT NOT NULL,
  description                TEXT,
  default_priority           TEXT NOT NULL DEFAULT 'normal'
                                CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
  default_due_offset_days    INTEGER,
  position                   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_operation_task_template_subtasks_template
  ON operation_task_template_subtasks(template_id, position);

ALTER TABLE operation_task_template_subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_task_template_subtasks_select ON operation_task_template_subtasks;
DROP POLICY IF EXISTS operation_task_template_subtasks_modify ON operation_task_template_subtasks;
CREATE POLICY operation_task_template_subtasks_select ON operation_task_template_subtasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_subtasks.template_id AND is_account_member(tpl.account_id))
);
CREATE POLICY operation_task_template_subtasks_modify ON operation_task_template_subtasks FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_subtasks.template_id AND is_account_member(tpl.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_subtasks.template_id AND is_account_member(tpl.account_id, 'admin'))
);

-- ============================================================
-- OPERATION_TASK_TEMPLATE_CHECKLIST_ITEMS — the task's own "internal
-- checklist" (PRD 12.1), cloned into a new operation_checklists row
-- (task-scoped) + its items when the template is applied.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_task_template_checklist_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id  UUID NOT NULL REFERENCES operation_task_templates(id) ON DELETE CASCADE,
  item_text    TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_operation_task_template_checklist_items_template
  ON operation_task_template_checklist_items(template_id, position);

ALTER TABLE operation_task_template_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_task_template_checklist_items_select ON operation_task_template_checklist_items;
DROP POLICY IF EXISTS operation_task_template_checklist_items_modify ON operation_task_template_checklist_items;
CREATE POLICY operation_task_template_checklist_items_select ON operation_task_template_checklist_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_checklist_items.template_id AND is_account_member(tpl.account_id))
);
CREATE POLICY operation_task_template_checklist_items_modify ON operation_task_template_checklist_items FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_checklist_items.template_id AND is_account_member(tpl.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_task_templates tpl WHERE tpl.id = operation_task_template_checklist_items.template_id AND is_account_member(tpl.account_id, 'admin'))
);

-- ============================================================
-- operation_tasks.source_template_id — added here (not in 067)
-- because it references operation_task_templates, which only exists
-- from this migration onward. Tracks which template a task came
-- from, purely for traceability + the apply_task_template RPC's
-- duplicate-prevention check (072) — never a live binding.
-- ============================================================
ALTER TABLE operation_tasks
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES operation_task_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_operation_tasks_source_template
  ON operation_tasks(source_template_id);
