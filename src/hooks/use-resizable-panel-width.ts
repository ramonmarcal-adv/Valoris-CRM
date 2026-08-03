"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizablePanelWidthOptions {
  defaultWidth: number;
  /** Floor for the dragged width, in px. Can vary across renders (e.g.
   *  a wider floor while a secondary pane is open) — read fresh on every
   *  pointer move rather than captured once. */
  minWidth: number;
  /** Ceiling as a fraction of the viewport width. Default 0.95. */
  maxWidthVw?: number;
  /** localStorage key the chosen width is persisted under. */
  storageKey: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Drag-to-resize width for a right-anchored panel (e.g. the Kanban
 * thread Sheet), backed by Pointer Capture on the handle itself — no
 * `window` listeners to attach/detach. Width is persisted to
 * localStorage, restored after mount (never read during the initial
 * render, so SSR/hydration never sees a mismatch).
 */
export function useResizablePanelWidth({
  defaultWidth,
  minWidth,
  maxWidthVw = 0.95,
  storageKey,
}: UseResizablePanelWidthOptions) {
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(width);
  const dragStartRef = useRef<{ x: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? Number(stored) : NaN;
      if (Number.isFinite(parsed)) {
        const next = clamp(parsed, minWidth, window.innerWidth * maxWidthVw);
        widthRef.current = next;
        setWidth(next);
      }
    } catch {
      // Private-browsing / sandboxed contexts — keep the default width.
    }
    // Only ever runs once, on mount — minWidth/maxWidthVw intentionally
    // excluded so a later re-render (e.g. contact panel toggled open)
    // doesn't yank a width the user already dragged back down to size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Re-clamp whenever the floor rises past the current width (e.g. the
  // contact panel opens and needs more room) — without this, opening it
  // could leave the panel narrower than what it now must fit.
  useEffect(() => {
    if (widthRef.current < minWidth) {
      const next = clamp(minWidth, minWidth, window.innerWidth * maxWidthVw);
      widthRef.current = next;
      setWidth(next);
    }
  }, [minWidth, maxWidthVw]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, startWidth: widthRef.current };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      // Anchored on the right edge — dragging left grows the panel.
      const delta = dragStartRef.current.x - e.clientX;
      const next = clamp(
        dragStartRef.current.startWidth + delta,
        minWidth,
        window.innerWidth * maxWidthVw,
      );
      widthRef.current = next;
      setWidth(next);
    },
    [minWidth, maxWidthVw],
  );

  const endDrag = useCallback(() => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setIsDragging(false);
    try {
      localStorage.setItem(storageKey, String(widthRef.current));
    } catch {
      // Private-browsing / sandboxed contexts — nothing to persist to.
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: number) => {
      widthRef.current = next;
      setWidth(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Private-browsing / sandboxed contexts — nothing to persist to.
      }
    },
    [storageKey],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const max = window.innerWidth * maxWidthVw;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        persist(clamp(widthRef.current + 24, minWidth, max));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        persist(clamp(widthRef.current - 24, minWidth, max));
      } else if (e.key === "Home") {
        e.preventDefault();
        persist(minWidth);
      } else if (e.key === "End") {
        e.preventDefault();
        persist(max);
      }
    },
    [minWidth, maxWidthVw, persist],
  );

  useEffect(() => {
    if (!isDragging) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  return {
    width,
    isDragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  };
}
