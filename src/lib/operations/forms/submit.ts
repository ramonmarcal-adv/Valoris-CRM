import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingContact, findExistingContactByEmail, isUniqueViolation, type ExistingContact } from "@/lib/contacts/dedupe";
import { resolveInitialStageId } from "@/lib/operations/board-stages";
import { buildCardFieldValues, buildContactPatch, extractContactPhone, type OperationFormAnswers } from "./mapping";
import { interpolate } from "./template";
import type { OperationForm, OperationFormQuestion, OperationFormSubmissionAnswer } from "@/types";

/**
 * Orchestrates one form submission end to end: find-or-create Contact
 * (optional, only when a phone question was answered) -> resolve
 * target stage -> create Card (atomic position via RPC 085) -> write
 * mapped Card field values -> relate Contact<->Card -> snapshot the
 * answers -> stamp the Card's traceability FK back to the submission.
 *
 * Client-agnostic — works identically whether `db` is a service-role
 * client (public path, RLS bypassed) or the caller's own RLS-scoped
 * client (authenticated internal path, agent+ already required by
 * every table's own RLS) — same trick as findExistingContact.
 *
 * Not unit-testable (sequential I/O against a real schema) — same
 * boundary already accepted for src/lib/whatsapp/evolution-ingest.ts's
 * findOrCreateContact. Covered by manual/E2E verification instead; the
 * pure pieces it calls (mapping.ts, template.ts) are unit-tested on
 * their own.
 */

export interface SubmitFormInput {
  form: OperationForm;
  questions: OperationFormQuestion[];
  /** Raw answers keyed by question id. */
  answers: OperationFormAnswers;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string };
  referralCode?: string;
  hiddenFields?: Record<string, string>;
  consentGiven?: boolean;
  /** Only set on the authenticated internal-fill path. */
  submittedByUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SubmitFormResult {
  submissionId: string;
  contactId: string | null;
  cardId: string;
  contactWasCreated: boolean;
}

function answerToTemplateString(value: OperationFormAnswers[string]): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

function buildTemplateValues(questions: OperationFormQuestion[], answers: OperationFormAnswers): Record<string, string> {
  const values: Record<string, string> = {};
  for (const q of questions) {
    values[q.field_key] = answerToTemplateString(answers[q.id]);
  }
  return values;
}

function buildAnswerSnapshot(
  questions: OperationFormQuestion[],
  answers: OperationFormAnswers,
): Record<string, OperationFormSubmissionAnswer> {
  const snapshot: Record<string, OperationFormSubmissionAnswer> = {};
  for (const q of questions) {
    const raw = answers[q.id];
    snapshot[q.id] = {
      field_key: q.field_key,
      label: q.label,
      field_type: q.field_type,
      value: raw === undefined ? null : (raw as OperationFormSubmissionAnswer["value"]),
    };
  }
  return snapshot;
}

async function findOrPatchContact(
  db: SupabaseClient,
  form: OperationForm,
  questions: OperationFormQuestion[],
  answers: OperationFormAnswers,
): Promise<{ contact: ExistingContact | null; wasCreated: boolean }> {
  const phone = extractContactPhone(questions, answers);
  if (!phone) return { contact: null, wasCreated: false };

  let existing = await findExistingContact(db, form.account_id, phone);

  if (!existing && form.dedupe_use_email) {
    const emailQuestion = questions.find((q) => q.maps_to === "contact_email");
    const emailAnswer = emailQuestion ? answers[emailQuestion.id] : undefined;
    if (typeof emailAnswer === "string" && emailAnswer.trim()) {
      existing = await findExistingContactByEmail(db, form.account_id, emailAnswer);
    }
  }

  const patch = buildContactPatch(questions, answers, existing, form.update_existing_contact);

  if (existing) {
    if (patch) {
      const { data: updated, error } = await db.from("contacts").update(patch).eq("id", existing.id).select().single();
      if (!error && updated) return { contact: updated as ExistingContact, wasCreated: false };
    }
    return { contact: existing, wasCreated: false };
  }

  if (!patch) return { contact: null, wasCreated: false };

  const { data: created, error } = await db
    .from("contacts")
    .insert({ ...patch, account_id: form.account_id })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      // Race: another request created this contact between our lookup and insert.
      const raceMatch = await findExistingContact(db, form.account_id, phone);
      return { contact: raceMatch, wasCreated: false };
    }
    throw error;
  }

  return { contact: created as ExistingContact, wasCreated: true };
}

export async function submitOperationForm(db: SupabaseClient, input: SubmitFormInput): Promise<SubmitFormResult> {
  const { form, questions, answers } = input;

  const { contact, wasCreated: contactWasCreated } = await findOrPatchContact(db, form, questions, answers);

  const stageId = form.target_stage_id ?? (await resolveInitialStageId(db, form.board_id));
  if (!stageId) {
    throw new Error(`submitOperationForm: board ${form.board_id} has no stages`);
  }

  const templateValues = buildTemplateValues(questions, answers);
  const title = interpolate(form.title_template, templateValues).trim() || form.name;
  const description = form.description_template ? interpolate(form.description_template, templateValues) : null;

  const { data: cardId, error: cardError } = await db.rpc("create_operation_card_with_position", {
    p_account_id: form.account_id,
    p_board_id: form.board_id,
    p_stage_id: stageId,
    p_title: title,
    p_description: description,
  });
  if (cardError || !cardId) {
    throw cardError ?? new Error("submitOperationForm: failed to create card");
  }

  const fieldValues = buildCardFieldValues(questions, answers);
  if (fieldValues.length > 0) {
    await db.from("operation_card_field_values").insert(
      fieldValues.map((fv) => ({ card_id: cardId, field_def_id: fv.field_def_id, [fv.column]: fv.value })),
    );
  }

  if (contact) {
    await db.from("operation_card_contacts").insert({ card_id: cardId, contact_id: contact.id });
  }

  const { data: submission, error: submissionError } = await db
    .from("operation_form_submissions")
    .insert({
      form_id: form.id,
      account_id: form.account_id,
      answers: buildAnswerSnapshot(questions, answers),
      contact_id: contact?.id ?? null,
      card_id: cardId,
      contact_was_created: contactWasCreated,
      utm_source: input.utm?.source ?? null,
      utm_medium: input.utm?.medium ?? null,
      utm_campaign: input.utm?.campaign ?? null,
      utm_content: input.utm?.content ?? null,
      referral_code: input.referralCode ?? null,
      hidden_fields: input.hiddenFields ?? {},
      consent_given: input.consentGiven ?? false,
      submitted_by_user_id: input.submittedByUserId ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select()
    .single();

  if (submissionError || !submission) {
    throw submissionError ?? new Error("submitOperationForm: failed to save submission");
  }

  await db.from("operation_cards").update({ source_form_submission_id: submission.id }).eq("id", cardId);

  return {
    submissionId: submission.id as string,
    contactId: contact?.id ?? null,
    cardId: cardId as string,
    contactWasCreated,
  };
}
