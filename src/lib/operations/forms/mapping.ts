import { valueColumnForFieldType } from "@/lib/operations/card-fields";
import type { ExistingContact } from "@/lib/contacts/dedupe";
import type { OperationFormQuestion } from "@/types";

/** Raw answer value as submitted, keyed by question id. */
export type OperationFormAnswerValue = string | string[] | number | boolean | null | undefined;
export type OperationFormAnswers = Record<string, OperationFormAnswerValue>;

function findQuestion(
  questions: OperationFormQuestion[],
  mapsTo: OperationFormQuestion["maps_to"],
): OperationFormQuestion | undefined {
  return questions.find((q) => q.maps_to === mapsTo);
}

function stringAnswer(answers: OperationFormAnswers, questionId: string | undefined): string | undefined {
  if (!questionId) return undefined;
  const v = answers[questionId];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The phone answer, if a contact_phone question exists and was answered — this is what makes Contact creation possible at all. */
export function extractContactPhone(questions: OperationFormQuestion[], answers: OperationFormAnswers): string | undefined {
  return stringAnswer(answers, findQuestion(questions, "contact_phone")?.id);
}

export interface ContactPatch {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
}

/**
 * Builds the patch to insert/update a Contact from mapped answers.
 * - No existing contact: always builds the full patch (a brand-new row).
 * - Existing contact + updateExisting=false: returns null — nothing to write.
 * - Existing contact + updateExisting=true: builds the patch, but skips
 *   `name` when the existing contact's name_source is 'manual' (never
 *   let a form auto-overwrite a manually-corrected name — same guard
 *   already used by src/lib/whatsapp/evolution-ingest.ts).
 */
export function buildContactPatch(
  questions: OperationFormQuestion[],
  answers: OperationFormAnswers,
  existingContact: ExistingContact | null,
  updateExisting: boolean,
): ContactPatch | null {
  const phone = extractContactPhone(questions, answers);
  if (!phone) return null;

  if (existingContact && !updateExisting) return null;

  const name = stringAnswer(answers, findQuestion(questions, "contact_name")?.id);
  const email = stringAnswer(answers, findQuestion(questions, "contact_email")?.id);
  const company = stringAnswer(answers, findQuestion(questions, "contact_company")?.id);

  const patch: ContactPatch = { phone };
  const skipName = existingContact && existingContact.name_source === "manual";
  if (name && !skipName) patch.name = name;
  if (email) patch.email = email;
  if (company) patch.company = company;
  return patch;
}

export interface CardFieldValuePatch {
  field_def_id: string;
  column: string;
  value: OperationFormAnswerValue;
}

/** Maps answers for card_field-mapped questions onto {field_def_id, column, value} triples, ready to upsert into operation_card_field_values. */
export function buildCardFieldValues(questions: OperationFormQuestion[], answers: OperationFormAnswers): CardFieldValuePatch[] {
  const result: CardFieldValuePatch[] = [];
  for (const q of questions) {
    if (q.maps_to !== "card_field" || !q.card_field_def_id) continue;
    const value = answers[q.id];
    if (value === undefined || value === null || value === "") continue;
    result.push({
      field_def_id: q.card_field_def_id,
      column: valueColumnForFieldType(q.field_type),
      value,
    });
  }
  return result;
}
