"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { FormBuilder } from "@/components/operations/forms/form-builder";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OperationBoard, OperationBoardStage, OperationCardFieldDef } from "@/types";

export default function OperationFormEditPage() {
  const t = useTranslations("Operations.boardPage");
  const params = useParams<{ boardId: string; formId: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [board, setBoard] = useState<OperationBoard | null>(null);
  const [stages, setStages] = useState<OperationBoardStage[]>([]);
  const [fieldDefs, setFieldDefs] = useState<OperationCardFieldDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: b }, { data: s }, { data: fd }] = await Promise.all([
        supabase.from("operation_boards").select("*").eq("id", params.boardId).maybeSingle(),
        supabase.from("operation_board_stages").select("*").eq("board_id", params.boardId).is("archived_at", null).order("position"),
        supabase.from("operation_card_field_defs").select("*").eq("board_id", params.boardId).is("archived_at", null).order("position"),
      ]);
      if (cancelled) return;
      setBoard(b as OperationBoard | null);
      setStages((s ?? []) as OperationBoardStage[]);
      setFieldDefs((fd ?? []) as OperationCardFieldDef[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, params.boardId]);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/50" />;
  }

  if (!board) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
        <p className="text-sm text-muted-foreground">{t("boardNotFound")}</p>
        <Link href="/operations" className="mt-3 text-sm text-primary hover:underline">
          {t("backToOperations")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/operations/boards/${board.id}/forms`)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("backToOperations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: board.color }} />
        <h1 className="text-xl font-semibold text-foreground">{board.name}</h1>
      </div>

      <FormBuilder formId={params.formId} boardId={board.id} stages={stages} fieldDefs={fieldDefs} />
    </div>
  );
}
