"use client";

import { FORM_QUESTION_FIELD_TYPES, isCompatibleCardFieldType } from "@/lib/operations/forms/field-types";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OperationCardFieldDef, OperationFormQuestionFieldType, OperationFormQuestionMapsTo } from "@/types";

const CONTACT_MAPPINGS: OperationFormQuestionMapsTo[] = ["contact_phone", "contact_name", "contact_email", "contact_company"];

export interface BuilderQuestion {
  id: string;
  label: string;
  help_text: string;
  field_type: OperationFormQuestionFieldType;
  field_options: { choices?: string[] };
  is_required: boolean;
  maps_to: OperationFormQuestionMapsTo;
  card_field_def_id: string | null;
}

interface FormQuestionEditorProps {
  question: BuilderQuestion;
  onChange: (patch: Partial<BuilderQuestion>) => void;
  onRemove: () => void;
  fieldDefs: OperationCardFieldDef[];
  /** Which contact-mapping slots are already taken by ANOTHER question — disables picking a duplicate. */
  takenContactMappings: OperationFormQuestionMapsTo[];
}

export function FormQuestionEditor({ question, onChange, onRemove, fieldDefs, takenContactMappings }: FormQuestionEditorProps) {
  const t = useTranslations("Operations.forms.builder");
  const tFieldType = useTranslations("Operations.forms.fieldType");
  const tMapsTo = useTranslations("Operations.forms.mapsTo");

  const compatibleCardFields = fieldDefs.filter((fd) => isCompatibleCardFieldType(question.field_type, fd.field_type));
  const choicesText = (question.field_options.choices ?? []).join(", ");
  const needsChoices = question.field_type === "single_select" || question.field_type === "multi_select";

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={question.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t("questionLabelPlaceholder")}
          className="h-8 flex-1 border-border bg-card text-sm"
        />
        <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-red-400">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select
          value={question.field_type}
          onValueChange={(v) => v && onChange({ field_type: v as OperationFormQuestionFieldType, maps_to: "answer_only", card_field_def_id: null })}
        >
          <SelectTrigger className="h-8 bg-card text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORM_QUESTION_FIELD_TYPES.map((ft) => (
              <SelectItem key={ft} value={ft}>
                {tFieldType(ft)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={question.maps_to}
          onValueChange={(v) => v && onChange({ maps_to: v as OperationFormQuestionMapsTo, card_field_def_id: v === "card_field" ? question.card_field_def_id : null })}
        >
          <SelectTrigger className="h-8 bg-card text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="answer_only">{tMapsTo("answer_only")}</SelectItem>
            <SelectItem value="card_field">{tMapsTo("card_field")}</SelectItem>
            {CONTACT_MAPPINGS.map((m) => (
              <SelectItem key={m} value={m} disabled={takenContactMappings.includes(m)}>
                {tMapsTo(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {question.maps_to === "card_field" && (
        <Select value={question.card_field_def_id ?? ""} onValueChange={(v) => v && onChange({ card_field_def_id: v })}>
          <SelectTrigger className="h-8 bg-card text-xs">
            <SelectValue placeholder={t("selectCardField")} />
          </SelectTrigger>
          <SelectContent>
            {compatibleCardFields.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("noCompatibleCardFields")}</div>
            )}
            {compatibleCardFields.map((fd) => (
              <SelectItem key={fd.id} value={fd.id}>
                {fd.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {needsChoices && (
        <Input
          value={choicesText}
          onChange={(e) => onChange({ field_options: { choices: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) } })}
          placeholder={t("choicesPlaceholder")}
          className="h-8 border-border bg-card text-xs"
        />
      )}

      <Input
        value={question.help_text}
        onChange={(e) => onChange({ help_text: e.target.value })}
        placeholder={t("helpTextPlaceholder")}
        className="h-8 border-border bg-card text-xs"
      />

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={question.is_required} onCheckedChange={(v) => onChange({ is_required: v === true })} />
        {t("required")}
      </label>
    </div>
  );
}
