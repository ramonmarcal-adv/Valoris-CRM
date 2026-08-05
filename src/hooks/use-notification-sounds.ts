"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { playNotificationChime } from "@/lib/notification-sound";

const ENABLED_KEY = "wacrm:notification-sounds:enabled";

// Module-level so every component using useNotificationSoundsToggle()
// (e.g. the header mute button) and the subscription effect below stay
// in sync within the same tab — localStorage alone doesn't do that,
// since the `storage` event only fires in *other* tabs.
let enabled = true;
const listeners = new Set<(value: boolean) => void>();

function readStoredEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function setEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(ENABLED_KEY, String(next));
  } catch {
    // Ignore — worst case the preference doesn't persist across reloads.
  }
  for (const listener of listeners) listener(next);
}

/** Mute toggle for a button anywhere in the UI (e.g. the header). */
export function useNotificationSoundsToggle() {
  const [value, setValue] = useState(enabled);

  useEffect(() => {
    const stored = readStoredEnabled();
    enabled = stored;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage on mount, same pattern as use-sidebar-state
    setValue(stored);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return { enabled: value, setEnabled };
}

/**
 * Mount ONCE per signed-in dashboard tab (in the dashboard shell,
 * alongside PresenceHeartbeat). Plays a short chime for:
 *  - a new inbound customer message (any conversation, not just the
 *    one currently open — an agent working elsewhere should still hear it)
 *  - a conversation assigned to the current user
 *  - a new lead (contact) arriving
 *
 * All three are plain `postgres_changes` INSERT subscriptions — RLS
 * already scopes `messages`/`notifications`/`contacts` to rows the
 * current user can see, so no explicit account/user filter is needed
 * here (same pattern as useTotalUnread / useUnreadNotifications).
 */
export function useNotificationSounds() {
  const { accountId } = useAuth();

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    const channel = supabase
      .channel("notification-sounds")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { sender_type?: string };
          if (enabled && row.sender_type === "customer") playNotificationChime();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as { type?: string };
          if (enabled && row.type === "conversation_assigned") playNotificationChime();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "contacts" },
        () => {
          if (enabled) playNotificationChime();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);
}
