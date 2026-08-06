"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { FormQuestionsRenderer } from "@/components/operations/forms/form-questions-renderer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "next-intl";
import type { PublicFormPayload } from "@/types";

type PageState = "loading" | "not_found" | "ready" | "submitting" | "success" | "error";

export default function PublicFormPage() {
  const t = useTranslations("PublicForm");
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();

  const [state, setState] = useState<PageState>("loading");
  const [payload, setPayload] = useState<PublicFormPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [consentGiven, setConsentGiven] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [loadedAt] = useState(() => Date.now());
  const [thankYouMessage, setThankYouMessage] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/forms/${params.slug}`);
      const data = (await res.json().catch(() => null)) as PublicFormPayload | null;
      if (!data?.ok) {
        setState("not_found");
        return;
      }
      setPayload(data);
      setState("ready");
    })();
  }, [params.slug]);

  const utm = useMemo(
    () => ({
      source: searchParams.get("utm_source") ?? undefined,
      medium: searchParams.get("utm_medium") ?? undefined,
      campaign: searchParams.get("utm_campaign") ?? undefined,
      content: searchParams.get("utm_content") ?? undefined,
    }),
    [searchParams],
  );
  const referralCode = searchParams.get("ref") ?? undefined;

  function handleChange(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit() {
    if (!payload?.form || !payload.questions) return;

    const missing = payload.questions.filter((q) => {
      if (!q.is_required) return false;
      const v = answers[q.id];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    });
    if (missing.length > 0) {
      window.alert(t("missingRequired"));
      return;
    }
    if (payload.form.consent_required && !consentGiven) {
      window.alert(t("consentRequiredAlert"));
      return;
    }

    setState("submitting");
    const res = await fetch(`/api/forms/${params.slug}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers,
        honeypot,
        loadedAt,
        consentGiven,
        utm_source: utm.source,
        utm_medium: utm.medium,
        utm_campaign: utm.campaign,
        utm_content: utm.content,
        referral_code: referralCode,
      }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      setState("error");
      return;
    }
    setThankYouMessage(data.thank_you_message ?? payload.form.thank_you_message);
    setState("success");
  }

  if (state === "loading") {
    return <div className="mx-auto h-64 max-w-lg animate-pulse rounded-xl bg-muted/50" />;
  }

  if (state === "not_found") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-base text-foreground">{thankYouMessage}</p>
      </div>
    );
  }

  if (!payload?.form) return null;

  return (
    <div className="mx-auto max-w-lg space-y-6 rounded-xl border border-border bg-card p-6 sm:p-8">
      {(payload.form.branding.logo_url || payload.form.branding.name) && (
        <div className="flex items-center gap-2">
          {payload.form.branding.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={payload.form.branding.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
          )}
          {payload.form.branding.name && <span className="text-sm font-medium text-foreground">{payload.form.branding.name}</span>}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-foreground">{payload.form.name}</h1>
        {payload.form.description && <p className="mt-1 text-sm text-muted-foreground">{payload.form.description}</p>}
      </div>

      <FormQuestionsRenderer questions={payload.questions ?? []} answers={answers} onChange={handleChange} variant="public" />

      {payload.form.consent_required && payload.form.consent_text && (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox checked={consentGiven} onCheckedChange={(v) => setConsentGiven(v === true)} className="mt-0.5" />
          <span>{payload.form.consent_text}</span>
        </label>
      )}

      {/* Honeypot — invisible to a real visitor, a real <label> keeps it from confusing screen readers. */}
      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden={false}>
        <label htmlFor="company_website">{t("honeypotLabel")}</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {state === "error" && <p className="text-sm text-red-400">{t("submitError")}</p>}

      <Button onClick={handleSubmit} disabled={state === "submitting"} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
        {state === "submitting" ? t("submitting") : t("submit")}
      </Button>
    </div>
  );
}
