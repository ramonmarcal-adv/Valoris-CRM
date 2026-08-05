"use client";

import { Bell, BellOff } from "lucide-react";

import { useNotificationSoundsToggle } from "@/hooks/use-notification-sounds";
import { cn } from "@/lib/utils";

import { useTranslations } from "next-intl";

/**
 * Mute/unmute toggle for notification chimes (new message, assigned
 * to me, new lead). Mirrors ModeToggle's placement and sizing in the
 * header.
 */
export function SoundToggle({ className }: { className?: string }) {
  const t = useTranslations("SoundToggle");
  const { enabled, setEnabled } = useNotificationSoundsToggle();
  const label = enabled ? t("mute") : t("unmute");

  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {enabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
    </button>
  );
}
