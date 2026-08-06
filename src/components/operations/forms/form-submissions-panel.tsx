"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import type { OperationFormSubmission } from "@/types";

/** Read-only — auditing, not the primary place to work (PRD 17.8: important data lives on the Card/Contact, not here). */
export function FormSubmissionsPanel({ formId }: { formId: string }) {
  const t = useTranslations("Operations.forms.submissions");
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<OperationFormSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("operation_form_submissions")
        .select("*")
        .eq("form_id", formId)
        .order("created_at", { ascending: false })
        .limit(20);
      setSubmissions((data ?? []) as OperationFormSubmission[]);
      setLoading(false);
    })();
  }, [supabase, formId]);

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/50" />;
  if (submissions.length === 0) return <p className="text-xs text-muted-foreground">{t("noSubmissions")}</p>;

  return (
    <div className="space-y-1.5">
      {submissions.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
          {s.contact_id && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
              {s.contact_was_created ? t("contactCreated") : t("contactMatched")}
            </span>
          )}
          {s.card_id && (
            <Link href={`/operations/cards/${s.card_id}`} className="ml-auto text-primary hover:underline">
              {t("viewCard")}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
