"use client";

import { useAuth } from "@/hooks/use-auth";
import { LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Gate for the whole /operations route tree — Release A is new/rough
 * enough to want per-account opt-in during rollout (`profiles.beta_features`
 * containing `'operations'`), same mechanism the sidebar nav entry
 * checks. This blocks direct URL access too, not just the nav link.
 */
export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Operations.gate");
  const { profile, profileLoading } = useAuth();

  if (profileLoading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/50" />;
  }

  if (!profile?.beta_features?.includes("operations")) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
        <LayoutGrid className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium text-foreground">{t("title")}</h3>
        <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">{t("description")}</p>
      </div>
    );
  }

  return <>{children}</>;
}
