-- ============================================================
-- 075_operation_automations.sql
--
-- Release C — the automation engine (PRD 16), Board-scoped. This is
-- a PARALLEL engine to the existing Deal/Conversation automations
-- (src/lib/automations/, migration 006) — deliberately not an
-- extension of it. That engine's core types (AutomationContext,
-- ownership checks, ~300 lines of action switch cases) are built
-- around a required contactId; none of PRD 16.3-16.5's Card/Task/
-- Checklist triggers or actions involve a contact at all. Retrofitting
-- it would mean rewriting production code that already serves real
-- Deal/Conversation automations, for zero reuse benefit. Same
-- vertical-isolation call already made for Operations vs. Pipelines
-- in Release A/B.
--
-- Model simplification vs. the existing engine: the PRD describes
-- QUANDO <gatilho> SE <condições AND-only> ENTÃO <ações> — one
-- condition block, not a binary yes/no tree. So operation_automation_steps
-- is a FLAT list (no parent_step_id/branch), and conditions live as a
-- single `conditions` JSONB array on the automation itself, evaluated
-- once at trigger time and again after any `wait` step resumes (see
-- 076/081) — this satisfies PRD 16.6's "condition re-evaluated at
-- execution time" example without needing a condition step type at all.
--
-- RLS is admin+ for create/edit (confirmed with the user — automations
-- have silent, potentially bulk side effects, closer to governance
-- than day-to-day card editing; this deliberately diverges from the
-- existing Deal/Conversation `automations` table, which is agent+).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS operation_automations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board_id              UUID NOT NULL REFERENCES operation_boards(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN (
                           -- Card (PRD 16.3)
                           'card_created', 'card_moved', 'entered_stage', 'left_stage', 'field_changed',
                           'priority_changed', 'assignee_changed', 'tag_added', 'tag_removed', 'card_archived',
                           -- Task
                           'task_created', 'task_completed', 'all_tasks_completed', 'subtask_completed',
                           -- Checklist
                           'checklist_added', 'checklist_completed', 'all_items_completed',
                           -- Time-based
                           'date_reached', 'days_before_date', 'days_after_date',
                           'task_due_today', 'task_overdue', 'task_overdue_days', 'card_stuck_in_stage_days'
                         )),
  trigger_config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Array of {subject, operator, operand?, value}, AND-only (PRD 16.4 /
  -- 39 explicitly defers OR/complex groups). Evaluated in TS
  -- (src/lib/operations/automations/condition-eval.ts) — kept out of
  -- SQL since the subject×operator×field_type matrix is exactly the
  -- kind of pure logic this project already unit-tests client-side
  -- (mirrors board-overview.ts's classifyTaskDueDate from Release B).
  conditions            JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  execution_count       INTEGER NOT NULL DEFAULT 0,
  last_executed_at      TIMESTAMPTZ,
  -- Stage shortcuts (PRD 16.8) create a real automation row under the
  -- hood rather than a special execution path — created_via +
  -- shortcut_* let the UI find/update "the" automation behind a given
  -- shortcut instead of creating duplicates on reconfigure.
  created_via           TEXT NOT NULL DEFAULT 'manual' CHECK (created_via IN ('manual', 'stage_shortcut')),
  shortcut_stage_id     UUID REFERENCES operation_board_stages(id) ON DELETE CASCADE,
  shortcut_action_type  TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (created_via <> 'stage_shortcut' OR (shortcut_stage_id IS NOT NULL AND shortcut_action_type IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_automations_stage_shortcut
  ON operation_automations(board_id, shortcut_stage_id, shortcut_action_type)
  WHERE created_via = 'stage_shortcut';

-- Dispatch hot path: "which active automations on this board match
-- this trigger_type" — same partial-index shape as the existing
-- engine's idx_automations_active_trigger.
CREATE INDEX IF NOT EXISTS idx_operation_automations_board_trigger_active
  ON operation_automations(board_id, trigger_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_operation_automations_account
  ON operation_automations(account_id);

ALTER TABLE operation_automations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON operation_automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operation_automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS operation_automations_select ON operation_automations;
DROP POLICY IF EXISTS operation_automations_modify ON operation_automations;
CREATE POLICY operation_automations_select ON operation_automations FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY operation_automations_modify ON operation_automations FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- OPERATION_AUTOMATION_STEPS — flat ordered list of actions (+ the
-- pseudo-action 'wait'). No parent_step_id/branch — see header.
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_automation_steps (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id  UUID NOT NULL REFERENCES operation_automations(id) ON DELETE CASCADE,
  step_type      TEXT NOT NULL CHECK (step_type IN (
                    -- PRD 16.5's 13 actions, mapped onto Release A/B tables
                    'move_card', 'change_field', 'change_priority', 'assign_card',
                    'add_card_tag', 'remove_card_tag', 'create_task', 'apply_task_template',
                    'add_checklist', 'apply_checklist_template', 'add_comment',
                    'create_card', 'relate_cards', 'archive_card',
                    -- Delay (PRD 16.6)
                    'wait'
                  )),
  step_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_automation_steps_automation
  ON operation_automation_steps(automation_id, position);

ALTER TABLE operation_automation_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operation_automation_steps_select ON operation_automation_steps;
DROP POLICY IF EXISTS operation_automation_steps_modify ON operation_automation_steps;
CREATE POLICY operation_automation_steps_select ON operation_automation_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM operation_automations a WHERE a.id = operation_automation_steps.automation_id AND is_account_member(a.account_id))
);
CREATE POLICY operation_automation_steps_modify ON operation_automation_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM operation_automations a WHERE a.id = operation_automation_steps.automation_id AND is_account_member(a.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM operation_automations a WHERE a.id = operation_automation_steps.automation_id AND is_account_member(a.account_id, 'admin'))
);
