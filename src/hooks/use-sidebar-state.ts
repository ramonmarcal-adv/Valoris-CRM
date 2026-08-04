"use client";

import { useCallback, useEffect, useState } from "react";

const COLLAPSED_KEY = "wacrm:sidebar:collapsed";
const PINNED_KEY = "wacrm:sidebar:pinned";

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return fallback;
  } catch {
    // Private-browsing / sandboxed contexts — keep the default.
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private-browsing / sandboxed contexts — nothing to persist to.
  }
}

/**
 * Persisted desktop sidebar preferences — collapsed (icon rail vs. full
 * width) and pinned (whether the collapsed rail expands on hover or
 * stays put). Defaults to expanded + unpinned (today's only behaviour)
 * on first paint and every SSR pass; the real stored preference is
 * applied in an effect after mount, same hydration-safe shape as
 * `useResizablePanelWidth` — never read localStorage during the
 * initial render, so there's nothing for hydration to mismatch on.
 */
export function useSidebarState() {
  const [collapsed, setCollapsedState] = useState(false);
  const [pinned, setPinnedState] = useState(false);

  useEffect(() => {
    // Syncing from localStorage (an external system) on mount, not
    // reacting to a prop/state change — this is the one-time hydration
    // read every localStorage-backed preference in this app needs,
    // same pattern as useResizablePanelWidth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsedState(readBoolean(COLLAPSED_KEY, false));
    setPinnedState(readBoolean(PINNED_KEY, false));
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeBoolean(COLLAPSED_KEY, next);
  }, []);

  const setPinned = useCallback((next: boolean) => {
    setPinnedState(next);
    writeBoolean(PINNED_KEY, next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  const togglePinned = useCallback(() => {
    setPinned(!pinned);
  }, [pinned, setPinned]);

  return { collapsed, pinned, setCollapsed, setPinned, toggleCollapsed, togglePinned };
}
