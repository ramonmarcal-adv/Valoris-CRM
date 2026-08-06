"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { slugifyFieldKey } from "@/lib/operations/forms/slug";
import { validateFormForPublish } from "@/lib/operations/forms/validate";
import { FormQuestionEditor, type BuilderQuestion } from "./form-question-editor";
import { FormFillDialog } from "./form-fill-dialog";
import { FormSubmissionsPanel } from "./form-submissions-panel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationBoardStage, OperationCardFieldDef, OperationForm, OperationFormQuestion } from "@/types";

interface FormBuilderProps {
  formId: string;
  boardId: string;
  stages: OperationBoardStage[];
  fieldDefs: OperationCardFieldDef[];
}

export function FormBuilder({ formId, stages, fieldDefs }: FormBuilderProps) {
  const t = useTranslations("Operations.forms.builder");
  const supabase = createClient();

  const [form, setForm] = useState<OperationForm | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetStageId, setTargetStageId] = useState<string>("");
  const [slug, setSlug] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [descriptionTemplate, setDescriptionTemplate] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [consentRequired, setConsentRequired] = useState(false);
  const [consentText, setConsentText] = useState("");
  const [updateExistingContact, setUpdateExistingContact] = useState(false);
  const [dedupeUseEmail, setDedupeUseEmail] = useState(false);
  const [questions, setQuestions] = useState<BuilderQuestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [fillDialogOpen, setFillDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const [{ data: f }, { data: qRows }] = await Promise.all([
      supabase.from("operation_forms").select("*").eq("id", formId).maybeSingle(),
      supabase.from("operation_form_questions").select("*").eq("form_id", formId).order("position"),
    ]);
    if (!f) return;
    const row = f as OperationForm;
    setForm(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setTargetStageId(row.target_stage_id ?? "");
    setSlug(row.slug);
    setIsPublished(row.is_published);
    setTitleTemplate(row.title_template);
    setDescriptionTemplate(row.description_template ?? "");
    setThankYouMessage(row.thank_you_message);
    setConsentRequired(row.consent_required);
    setConsentText(row.consent_text ?? "");
    setUpdateExistingContact(row.update_existing_contact);
    setDedupeUseEmail(row.dedupe_use_email);
    setQuestions(
      ((qRows ?? []) as OperationFormQuestion[]).map((q) => ({
        id: q.id,
        label: q.label,
        help_text: q.help_text ?? "",
        field_type: q.field_type,
        field_options: (q.field_options as { choices?: string[] }) ?? {},
        is_required: q.is_required,
        maps_to: q.maps_to,
        card_field_def_id: q.card_field_def_id ?? null,
      })),
    );
  }, [supabase, formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function updateQuestion(index: number, patch: Partial<BuilderQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        id: `local-${prev.length}-${Date.now()}`,
        label: "",
        help_text: "",
        field_type: "short_text",
        field_options: {},
        is_required: false,
        maps_to: "answer_only",
        card_field_def_id: null,
      },
    ]);
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(publish?: boolean) {
    if (!form) return;
    const nextPublished = publish ?? isPublished;

    if (nextPublished) {
      const issues = validateFormForPublish(
        { title_template: titleTemplate, consent_required: consentRequired, consent_text: consentText || null },
        questions.map((q) => ({ maps_to: q.maps_to }) as OperationFormQuestion),
      );
      if (issues.length > 0) {
        toast.error(t("toastValidationFailed", { message: issues[0].message }));
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase
      .from("operation_forms")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        target_stage_id: targetStageId || null,
        slug,
        is_published: nextPublished,
        title_template: titleTemplate,
        description_template: descriptionTemplate.trim() || null,
        thank_you_message: thankYouMessage.trim() || "Obrigado! Recebemos sua resposta.",
        consent_required: consentRequired,
        consent_text: consentText.trim() || null,
        update_existing_contact: updateExistingContact,
        dedupe_use_email: dedupeUseEmail,
      })
      .eq("id", form.id);

    if (error) {
      toast.error(t("toastFailedSave"));
      setSaving(false);
      return;
    }

    await supabase.from("operation_form_questions").delete().eq("form_id", form.id);
    if (questions.length > 0) {
      await supabase.from("operation_form_questions").insert(
        questions.map((q, i) => ({
          form_id: form.id,
          field_key: slugifyFieldKey(q.label || `campo_${i + 1}`),
          label: q.label,
          help_text: q.help_text.trim() || null,
          field_type: q.field_type,
          field_options: q.field_options,
          is_required: q.is_required,
          position: i,
          maps_to: q.maps_to,
          card_field_def_id: q.maps_to === "card_field" ? q.card_field_def_id : null,
        })),
      );
    }

    setIsPublished(nextPublished);
    setSaving(false);
    toast.success(t("toastSaved"));
    load();
  }

  function handleOpenFillDialog() {
    // The fill dialog submits against DB-persisted question ids — an
    // unsaved local question (still on its temporary `local-` id) would
    // silently fail to line up with what the server re-fetches by
    // form_id, so require a save first rather than letting that happen.
    if (questions.some((q) => q.id.startsWith("local-"))) {
      toast.error(t("toastSaveBeforeFilling"));
      return;
    }
    setFillDialogOpen(true);
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success(t("toastLinkCopied"));
  }

  const takenContactMappings = (index: number) =>
    questions.filter((_, i) => i !== index).map((q) => q.maps_to);

  if (!form) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="border-transparent bg-transparent px-0 text-lg font-semibold text-foreground focus:border-border focus:px-3" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            rows={1}
            className="border-transparent bg-transparent px-0 text-sm text-muted-foreground focus:border-border focus:px-3"
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t("published")}</Label>
            <Switch checked={isPublished} onCheckedChange={(v) => handleSave(v)} />
          </div>
          <Button size="sm" variant="outline" onClick={handleOpenFillDialog} className="border-border bg-transparent text-xs text-foreground hover:bg-muted">
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            {t("fillNow")}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("cardSettings")}</Label>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">{t("targetStage")}</Label>
          <Select value={targetStageId || "auto"} onValueChange={(v) => setTargetStageId(v === "auto" ? "" : (v ?? ""))}>
            <SelectTrigger className="w-full bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("autoInitialStage")}</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">{t("titleTemplate")}</Label>
          <Input value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} placeholder="{{nome}} - {{cidade}}" className="border-border bg-muted text-foreground" />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">{t("descriptionTemplate")}</Label>
          <Textarea value={descriptionTemplate} onChange={(e) => setDescriptionTemplate(e.target.value)} rows={2} className="border-border bg-muted text-foreground" />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("questions")}</Label>
        {questions.length === 0 && <p className="text-xs text-muted-foreground">{t("noQuestions")}</p>}
        {questions.map((q, i) => (
          <FormQuestionEditor
            key={q.id}
            question={q}
            onChange={(patch) => updateQuestion(i, patch)}
            onRemove={() => removeQuestion(i)}
            fieldDefs={fieldDefs}
            takenContactMappings={takenContactMappings(i)}
          />
        ))}
        <Button variant="outline" size="sm" onClick={addQuestion} className="border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("addQuestion")}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("contactSettings")}</Label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={updateExistingContact} onCheckedChange={setUpdateExistingContact} />
          {t("updateExistingContact")}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={dedupeUseEmail} onCheckedChange={setDedupeUseEmail} />
          {t("dedupeUseEmail")}
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("publicPage")}</Label>
        <div className="grid gap-2">
          <Label className="text-muted-foreground">{t("thankYouMessage")}</Label>
          <Textarea value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} rows={2} className="border-border bg-muted text-foreground" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={consentRequired} onCheckedChange={setConsentRequired} />
          {t("consentRequired")}
        </label>
        {consentRequired && (
          <Textarea value={consentText} onChange={(e) => setConsentText(e.target.value)} placeholder={t("consentTextPlaceholder")} rows={2} className="border-border bg-muted text-foreground" />
        )}
        <div className="flex items-center gap-2">
          <Input readOnly value={`/f/${slug}`} className="h-8 flex-1 border-border bg-muted text-xs text-muted-foreground" />
          <Button variant="ghost" size="icon-xs" onClick={handleCopyLink} className="text-muted-foreground hover:text-foreground">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">{t("submissions")}</Label>
        <FormSubmissionsPanel formId={form.id} />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => handleSave()} disabled={saving || !name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? t("saving") : t("save")}
        </Button>
      </div>

      <FormFillDialog
        open={fillDialogOpen}
        onOpenChange={setFillDialogOpen}
        formId={form.id}
        questions={questions.map((q) => ({
          id: q.id,
          form_id: form.id,
          field_key: slugifyFieldKey(q.label),
          label: q.label,
          help_text: q.help_text || null,
          field_type: q.field_type,
          field_options: q.field_options,
          is_required: q.is_required,
          position: 0,
          maps_to: q.maps_to,
          card_field_def_id: q.card_field_def_id,
          created_at: "",
          updated_at: "",
        }))}
        onSubmitted={load}
      />
    </div>
  );
}
