import { describe, expect, it } from "vitest";
import { findMissingRequiredFields, resolveVisibleFields, valueColumnForFieldType } from "./card-fields";
import type { OperationCardFieldDef, OperationCardFieldValue } from "@/types";

function makeDef(overrides: Partial<OperationCardFieldDef>): OperationCardFieldDef {
  return {
    id: "def-1",
    board_id: "board-1",
    stage_id: null,
    name: "Field",
    field_type: "short_text",
    field_options: {},
    is_required: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeValue(overrides: Partial<OperationCardFieldValue>): OperationCardFieldValue {
  return {
    id: "val-1",
    card_id: "card-1",
    field_def_id: "def-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveVisibleFields", () => {
  it("includes stage-agnostic fields (stage_id null) on every stage", () => {
    const defs = [makeDef({ id: "a", stage_id: null })];
    expect(resolveVisibleFields(defs, "stage-1").map((d) => d.id)).toEqual(["a"]);
    expect(resolveVisibleFields(defs, "stage-2").map((d) => d.id)).toEqual(["a"]);
  });

  it("only includes a stage-specific field on its own stage", () => {
    const defs = [makeDef({ id: "a", stage_id: "stage-1" })];
    expect(resolveVisibleFields(defs, "stage-1").map((d) => d.id)).toEqual(["a"]);
    expect(resolveVisibleFields(defs, "stage-2")).toEqual([]);
  });

  it("excludes archived fields", () => {
    const defs = [makeDef({ id: "a", archived_at: "2026-01-02T00:00:00Z" })];
    expect(resolveVisibleFields(defs, "stage-1")).toEqual([]);
  });

  it("sorts by position", () => {
    const defs = [makeDef({ id: "b", position: 1 }), makeDef({ id: "a", position: 0 })];
    expect(resolveVisibleFields(defs, "stage-1").map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("findMissingRequiredFields", () => {
  it("returns nothing when no field is required", () => {
    const defs = [makeDef({ id: "a", is_required: false })];
    expect(findMissingRequiredFields(defs, [], "stage-1")).toEqual([]);
  });

  it("flags a required field with no value row at all", () => {
    const defs = [makeDef({ id: "a", is_required: true })];
    expect(findMissingRequiredFields(defs, [], "stage-1").map((d) => d.id)).toEqual(["a"]);
  });

  it("flags a required text field whose value is blank", () => {
    const defs = [makeDef({ id: "a", is_required: true, field_type: "short_text" })];
    const values = [makeValue({ field_def_id: "a", value_text: "   " })];
    expect(findMissingRequiredFields(defs, values, "stage-1").map((d) => d.id)).toEqual(["a"]);
  });

  it("clears a required field once it has a value", () => {
    const defs = [makeDef({ id: "a", is_required: true, field_type: "number" })];
    const values = [makeValue({ field_def_id: "a", value_number: 42 })];
    expect(findMissingRequiredFields(defs, values, "stage-1")).toEqual([]);
  });

  it("a checkbox value of false still counts as filled (not empty)", () => {
    const defs = [makeDef({ id: "a", is_required: true, field_type: "checkbox" })];
    const values = [makeValue({ field_def_id: "a", value_boolean: false })];
    expect(findMissingRequiredFields(defs, values, "stage-1")).toEqual([]);
  });

  it("ignores a required field that only applies to a different stage", () => {
    const defs = [makeDef({ id: "a", is_required: true, stage_id: "stage-1" })];
    expect(findMissingRequiredFields(defs, [], "stage-2")).toEqual([]);
  });

  it("flags an empty required multi_select", () => {
    const defs = [makeDef({ id: "a", is_required: true, field_type: "multi_select" })];
    const values = [makeValue({ field_def_id: "a", value_multi_select: [] })];
    expect(findMissingRequiredFields(defs, values, "stage-1").map((d) => d.id)).toEqual(["a"]);
  });
});

describe("valueColumnForFieldType", () => {
  it.each([
    ["short_text", "value_text"],
    ["long_text", "long_text"],
    ["number", "value_number"],
    ["currency", "value_number"],
    ["date", "value_date"],
    ["datetime", "value_date"],
    ["checkbox", "value_boolean"],
    ["single_select", "value_text"],
    ["multi_select", "value_multi_select"],
    ["phone", "value_text"],
    ["email", "value_text"],
    ["url", "value_text"],
    ["user", "value_uuid"],
    ["contact", "value_uuid"],
    ["related_card", "value_uuid"],
  ] as const)("%s -> %s", (fieldType, expectedColumn) => {
    expect(valueColumnForFieldType(fieldType)).toBe(expectedColumn);
  });
});
