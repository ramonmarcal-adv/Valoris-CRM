import { describe, expect, it } from "vitest";
import { validateAutomationForActivation, validateCondition, validateStep, validateTriggerConfig } from "./validate";

describe("validateTriggerConfig", () => {
  it("requires stage_id for entered_stage", () => {
    expect(validateTriggerConfig("entered_stage", {})).toHaveLength(1);
    expect(validateTriggerConfig("entered_stage", { stage_id: "s1" })).toHaveLength(0);
  });

  it("requires days for days_before_date", () => {
    expect(validateTriggerConfig("days_before_date", { field_def_id: "f1" })).toHaveLength(1);
    expect(validateTriggerConfig("days_before_date", { field_def_id: "f1", days: 2 })).toHaveLength(0);
  });

  it("card_created needs nothing", () => {
    expect(validateTriggerConfig("card_created", {})).toHaveLength(0);
  });
});

describe("validateCondition", () => {
  it("requires field_def_id for card_field conditions", () => {
    expect(validateCondition({ subject: "card_field", operator: "equal", value: "x" }, 0)).toHaveLength(1);
  });

  it("empty/not_empty operators don't need a value", () => {
    expect(validateCondition({ subject: "card_assignee", operator: "empty" }, 0)).toHaveLength(0);
  });

  it("other operators need a value", () => {
    expect(validateCondition({ subject: "card_priority", operator: "equal" }, 0)).toHaveLength(1);
  });
});

describe("validateStep", () => {
  it("move_card requires stage_id", () => {
    expect(validateStep({ step_type: "move_card", step_config: {} }, 0)).toHaveLength(1);
  });

  it("wait requires a duration", () => {
    expect(validateStep({ step_type: "wait", step_config: {} }, 0)).toHaveLength(1);
    expect(validateStep({ step_type: "wait", step_config: { days: 2 } }, 0)).toHaveLength(0);
  });

  it("relate_cards has nothing to validate statically", () => {
    expect(validateStep({ step_type: "relate_cards", step_config: {} }, 0)).toHaveLength(0);
  });
});

describe("validateAutomationForActivation", () => {
  it("requires at least one step", () => {
    const issues = validateAutomationForActivation({
      trigger_type: "card_created",
      trigger_config: {},
      conditions: [],
      steps: [],
    });
    expect(issues.some((i) => i.path === "steps")).toBe(true);
  });

  it("passes for a complete, valid automation", () => {
    const issues = validateAutomationForActivation({
      trigger_type: "entered_stage",
      trigger_config: { stage_id: "s1" },
      conditions: [{ subject: "card_priority", operator: "equal", value: "high" }],
      steps: [{ step_type: "change_priority", step_config: { priority: "urgent" } }],
    });
    expect(issues).toHaveLength(0);
  });
});
