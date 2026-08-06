import type { OperationForm, OperationFormQuestion } from "@/types";

/** Pre-flight validation before publishing a form — mirrors src/lib/operations/automations/validate.ts's role for automations. */
export interface OperationFormValidationIssue {
  path: string;
  message: string;
}

export function validateFormForPublish(
  form: Pick<OperationForm, "title_template" | "consent_required" | "consent_text">,
  questions: OperationFormQuestion[],
): OperationFormValidationIssue[] {
  const issues: OperationFormValidationIssue[] = [];

  if (questions.length === 0) {
    issues.push({ path: "questions", message: "at least one question is required" });
  }
  if (!form.title_template.trim()) {
    issues.push({ path: "title_template", message: "a title template is required" });
  }
  if (form.consent_required && !form.consent_text?.trim()) {
    issues.push({ path: "consent_text", message: "consent text is required when consent is required" });
  }

  const contactPhoneQuestions = questions.filter((q) => q.maps_to === "contact_phone");
  if (contactPhoneQuestions.length > 1) {
    issues.push({ path: "questions", message: "only one question can be mapped to the contact's phone" });
  }

  return issues;
}
