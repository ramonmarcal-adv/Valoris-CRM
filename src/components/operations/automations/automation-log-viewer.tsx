"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { OperationAutomationLog } from "@/types";

export function AutomationLogViewer({ automationId }: { automationId: string }) {
  const t = useTranslations("Operations.automations.logViewer");
  const supabase = createClient();
  const [logs, setLogs] = useState<OperationAutomationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("operation_automation_logs")
        .select("*")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(20);
      setLogs((data ?? []) as OperationAutomationLog[]);
      setLoading(false);
    })();
  }, [supabase, automationId]);

  if (loading) return <div className="h-16 animate-pulse rounded-lg bg-muted/50" />;
  if (logs.length === 0) return <p className="text-xs text-muted-foreground">{t("noLogs")}</p>;

  return (
    <div className="space-y-1.5">
      {logs.map((log) => (
        <div key={log.id} className="rounded-md border border-border bg-muted/30 p-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                log.status === "success" && "bg-emerald-500/15 text-emerald-400",
                log.status === "partial" && "bg-amber-500/15 text-amber-400",
                log.status === "failed" && "bg-red-500/15 text-red-400",
              )}
            >
              {t(`status.${log.status}`)}
            </span>
            <span className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
            {log.chain_depth > 0 && <span className="text-muted-foreground">· {t("chainDepth", { depth: log.chain_depth })}</span>}
          </div>
          {log.error_message && <p className="mt-1 text-red-400">{log.error_message}</p>}
          <ul className="mt-1 space-y-0.5">
            {log.steps_executed.map((step, i) => (
              <li key={i} className="text-muted-foreground">
                {step.step_type}: {step.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
