"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { FormListPanel } from "@/components/operations/forms/form-list-panel";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OperationBoard } from "@/types";

export default function OperationBoardFormsPage() {
  const t = useTranslations("Operations.boardPage");
  const params = useParams<{ boardId: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { accountId } = useAuth();

  const [board, setBoard] = useState<OperationBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("operation_boards").select("*").eq("id", params.boardId).maybeSingle();
      if (cancelled) return;
      setBoard(data as OperationBoard | null);
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
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(`/operations/boards/${board.id}`)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("backToOperations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: board.color }} />
        <h1 className="text-xl font-semibold text-foreground">{board.name}</h1>
      </div>

      {accountId && <FormListPanel boardId={board.id} accountId={accountId} />}
    </div>
  );
}
