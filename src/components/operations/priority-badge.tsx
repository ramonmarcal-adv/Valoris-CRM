"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OperationCardPriority } from "@/types";

const PRIORITY_STYLES: Record<OperationCardPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/15 text-blue-400",
  high: "bg-orange-500/15 text-orange-400",
  urgent: "bg-red-500/15 text-red-400",
};

export function PriorityBadge({ priority, className }: { priority: OperationCardPriority; className?: string }) {
  const t = useTranslations("Operations.priority");
  return (
    <Badge variant="outline" className={cn("border-transparent", PRIORITY_STYLES[priority], className)}>
      {t(priority)}
    </Badge>
  );
}
