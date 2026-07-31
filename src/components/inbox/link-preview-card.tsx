"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Per-tab cache so the same URL appearing in several bubbles (or
 *  re-rendered on scroll) only ever hits /api/link-preview once.
 *  `null` means "fetched, no usable metadata" (render nothing) —
 *  distinct from "not fetched yet" (undefined), so a failed/empty
 *  lookup doesn't get retried on every re-render. */
const previewCache = new Map<string, LinkPreviewData | null>();
const inflight = new Map<string, Promise<LinkPreviewData | null>>();

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewCache.has(url)) return previewCache.get(url) ?? null;
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as LinkPreviewData;
      if (!data.title && !data.image && !data.description) return null;
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  const result = await promise;
  previewCache.set(url, result);
  return result;
}

export function LinkPreviewCard({ url, onDark }: { url: string; onDark?: boolean }) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(() =>
    previewCache.has(url) ? (previewCache.get(url) ?? null) : undefined,
  );

  useEffect(() => {
    if (data !== undefined) return;
    let cancelled = false;
    fetchPreview(url).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url, data]);

  if (!data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-1.5 flex flex-col overflow-hidden rounded-lg border text-left transition-opacity hover:opacity-90",
        onDark
          ? "border-primary-foreground/20 bg-primary-foreground/10"
          : "border-border/60 bg-background/60",
      )}
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.image} alt="" className="h-32 w-full object-cover" />
      )}
      <div className="min-w-0 px-2.5 py-1.5">
        {data.siteName && (
          <p
            className={cn(
              "truncate text-[10px] uppercase tracking-wide",
              onDark ? "text-primary-foreground/60" : "text-muted-foreground",
            )}
          >
            {data.siteName}
          </p>
        )}
        {data.title && (
          <p
            className={cn(
              "truncate text-xs font-medium",
              onDark ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {data.title}
          </p>
        )}
        {data.description && (
          <p
            className={cn(
              "line-clamp-2 text-[11px]",
              onDark ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}
