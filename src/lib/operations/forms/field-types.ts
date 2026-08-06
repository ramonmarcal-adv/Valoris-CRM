import type { OperationCardFieldType, OperationFormQuestionFieldType } from "@/types";

/** The 12 question field types (PRD 17.3) — a subset of OperationCardFieldType's 15, excluding user/contact/related_card. */
export const FORM_QUESTION_FIELD_TYPES: OperationFormQuestionFieldType[] = [
  "short_text",
  "long_text",
  "number",
  "currency",
  "phone",
  "email",
  "date",
  "datetime",
  "single_select",
  "multi_select",
  "checkbox",
  "url",
];

/** Whether a form question of this type can be mapped onto a Card field of that type — same type must match, no coercion. */
export function isCompatibleCardFieldType(
  formFieldType: OperationFormQuestionFieldType,
  cardFieldType: OperationCardFieldType,
): boolean {
  return formFieldType === cardFieldType;
}
