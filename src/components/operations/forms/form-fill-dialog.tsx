"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormQuestionsRenderer } from "./form-questions-renderer";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationFormQuestion } from "@/types";

interface FormFillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  questions: OperationFormQuestion[];
  onSubmitted: () => void;
}

/**
 * The always-available "fill this form from the dashboard" path —
 * authenticated, agent+, no rate-limit/honeypot (unlike the public
 * page, the submitter is already an accountable member).
 */
export function FormFillDialog({ open, onOpenChange, formId, questions, onSubmitted }: FormFillDialogProps) {
  const t = useTranslations("Operations.forms.fillDialog");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit() {
    const missing = questions.filter((q) => {
      if (!q.is_required) return false;
      const v = answers[q.id];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    });
    if (missing.length > 0) {
      toast.error(t("toastMissingRequired"));
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/operations/forms/${formId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setSubmitting(false);

    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    toast.success(t("toastSubmitted"));
    setAnswers({});
    onOpenChange(false);
    onSubmitted();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        {questions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("noQuestions")}</p>
        ) : (
          <div className="py-2">
            <FormQuestionsRenderer questions={questions} answers={answers} onChange={handleChange} />
          </div>
        )}

        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || questions.length === 0} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
