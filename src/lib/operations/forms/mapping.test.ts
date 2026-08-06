import { describe, expect, it } from "vitest";
import { buildCardFieldValues, buildContactPatch, extractContactPhone } from "./mapping";
import type { ExistingContact } from "@/lib/contacts/dedupe";
import type { OperationFormQuestion } from "@/types";

function makeQuestion(overrides: Partial<OperationFormQuestion>): OperationFormQuestion {
  return {
    id: "q-1",
    form_id: "form-1",
    field_key: "campo",
    label: "Campo",
    field_type: "short_text",
    field_options: {},
    is_required: false,
    position: 0,
    maps_to: "answer_only",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContact(overrides: Partial<ExistingContact>): ExistingContact {
  return {
    id: "contact-1",
    user_id: "user-1",
    account_id: "acct-1",
    phone: "5511999999999",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("extractContactPhone", () => {
  it("returns the answer for the contact_phone-mapped question", () => {
    const questions = [makeQuestion({ id: "q-phone", maps_to: "contact_phone" })];
    expect(extractContactPhone(questions, { "q-phone": "11999999999" })).toBe("11999999999");
  });

  it("returns undefined when no question is mapped to contact_phone", () => {
    expect(extractContactPhone([makeQuestion({})], { "q-1": "anything" })).toBeUndefined();
  });

  it("returns undefined when the answer is blank", () => {
    const questions = [makeQuestion({ id: "q-phone", maps_to: "contact_phone" })];
    expect(extractContactPhone(questions, { "q-phone": "   " })).toBeUndefined();
  });
});

describe("buildContactPatch", () => {
  const questions = [
    makeQuestion({ id: "q-phone", maps_to: "contact_phone" }),
    makeQuestion({ id: "q-name", maps_to: "contact_name" }),
    makeQuestion({ id: "q-email", maps_to: "contact_email" }),
  ];
  const answers = { "q-phone": "11999999999", "q-name": "Ana", "q-email": "ana@example.com" };

  it("builds a full patch when there is no existing contact (creation)", () => {
    expect(buildContactPatch(questions, answers, null, false)).toEqual({
      phone: "11999999999",
      name: "Ana",
      email: "ana@example.com",
    });
  });

  it("returns null when the contact exists and updateExisting is false", () => {
    expect(buildContactPatch(questions, answers, makeContact({}), false)).toBeNull();
  });

  it("builds a patch when the contact exists and updateExisting is true", () => {
    const existing = makeContact({ name_source: "whatsapp" });
    expect(buildContactPatch(questions, answers, existing, true)).toEqual({
      phone: "11999999999",
      name: "Ana",
      email: "ana@example.com",
    });
  });

  it("never overwrites a manually-set name, even when updateExisting is true", () => {
    const existing = makeContact({ name: "Original Manual Name", name_source: "manual" });
    const patch = buildContactPatch(questions, answers, existing, true);
    expect(patch?.name).toBeUndefined();
    expect(patch?.email).toBe("ana@example.com");
  });

  it("returns null when there is no phone question at all", () => {
    expect(buildContactPatch([makeQuestion({ id: "q-name", maps_to: "contact_name" })], { "q-name": "Ana" }, null, false)).toBeNull();
  });
});

describe("buildCardFieldValues", () => {
  it("maps card_field questions onto {field_def_id, column, value}", () => {
    const questions = [
      makeQuestion({ id: "q-1", maps_to: "card_field", card_field_def_id: "fd-1", field_type: "number" }),
      makeQuestion({ id: "q-2", maps_to: "card_field", card_field_def_id: "fd-2", field_type: "checkbox" }),
      makeQuestion({ id: "q-3", maps_to: "answer_only" }),
    ];
    const answers = { "q-1": 500000, "q-2": true, "q-3": "ignored" };
    const result = buildCardFieldValues(questions, answers);
    expect(result).toEqual([
      { field_def_id: "fd-1", column: "value_number", value: 500000 },
      { field_def_id: "fd-2", column: "value_boolean", value: true },
    ]);
  });

  it("skips card_field questions with no answer", () => {
    const questions = [makeQuestion({ id: "q-1", maps_to: "card_field", card_field_def_id: "fd-1", field_type: "short_text" })];
    expect(buildCardFieldValues(questions, {})).toEqual([]);
    expect(buildCardFieldValues(questions, { "q-1": "" })).toEqual([]);
  });

  it("covers the 12 form field types mapping onto their columns", () => {
    const cases: [string, string][] = [
      ["short_text", "value_text"], ["long_text", "long_text"], ["number", "value_number"],
      ["currency", "value_number"], ["phone", "value_text"], ["email", "value_text"],
      ["date", "value_date"], ["datetime", "value_date"], ["single_select", "value_text"],
      ["multi_select", "value_multi_select"], ["checkbox", "value_boolean"], ["url", "value_text"],
    ];
    for (const [fieldType, expectedColumn] of cases) {
      const questions = [
        makeQuestion({
          id: "q-1", maps_to: "card_field", card_field_def_id: "fd-1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          field_type: fieldType as any,
        }),
      ];
      const result = buildCardFieldValues(questions, { "q-1": "x" });
      expect(result[0].column).toBe(expectedColumn);
    }
  });
});
