"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OperationFormQuestion } from "@/types";

export type RendererQuestion = Pick<
  OperationFormQuestion,
  "id" | "label" | "help_text" | "field_type" | "field_options" | "is_required"
>;

interface FormQuestionsRendererProps {
  questions: RendererQuestion[];
  answers: Record<string, unknown>;
  onChange: (questionId: string, value: unknown) => void;
  /** Dashboard usage renders inside a tighter admin layout; the public page wants a bit more breathing room. Purely cosmetic. */
  variant?: "dashboard" | "public";
}

/**
 * Renders a form's questions and collects answers — shared between the
 * internal fill dialog (dashboard) and the public /f/[slug] page, so
 * the field_type -> input switch exists exactly once.
 */
export function FormQuestionsRenderer({ questions, answers, onChange, variant = "dashboard" }: FormQuestionsRendererProps) {
  return (
    <div className={variant === "public" ? "space-y-5" : "space-y-3"}>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          {q.field_type !== "checkbox" && (
            <Label className="text-sm text-foreground">
              {q.label}
              {q.is_required && <span className="ml-1 text-red-400">*</span>}
            </Label>
          )}
          <QuestionInput question={q} value={answers[q.id]} onChange={(v) => onChange(q.id, v)} />
          {q.help_text && <p className="text-xs text-muted-foreground">{q.help_text}</p>}
        </div>
      ))}
    </div>
  );
}

function QuestionInput({ question, value, onChange }: { question: RendererQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const choices = (question.field_options?.choices as string[] | undefined) ?? [];

  switch (question.field_type) {
    case "long_text":
      return <Textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} className="border-border bg-muted text-foreground" />;

    case "number":
    case "currency":
      return (
        <Input
          type="number"
          value={(value as number) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="border-border bg-muted text-foreground"
        />
      );

    case "date":
      return <Input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;

    case "datetime":
      return <Input type="datetime-local" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;

    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
          {question.label}
          {question.is_required && <span className="text-red-400">*</span>}
        </label>
      );

    case "single_select":
      return (
        <Select value={(value as string) ?? ""} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {choices.map((choice) => (
            <label key={choice} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={selected.includes(choice)}
                onCheckedChange={(checked) =>
                  onChange(checked === true ? [...selected, choice] : selected.filter((c) => c !== choice))
                }
              />
              {choice}
            </label>
          ))}
        </div>
      );
    }

    case "phone":
      return <Input type="tel" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;
    case "email":
      return <Input type="email" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;
    case "url":
      return <Input type="url" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;

    default: // short_text
      return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="border-border bg-muted text-foreground" />;
  }
}
