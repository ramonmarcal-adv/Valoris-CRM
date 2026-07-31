"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { LinkPreviewCard } from "./link-preview-card";
import { parseWhatsAppFormatting } from "@/lib/whatsapp/markdown";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** Active in-thread search term (Área A.4) — wraps matches in the
   *  plain-text body with a <mark>-style highlight. Undefined/empty
   *  means no search is active. */
  highlightQuery?: string;
  /** True when the parent conversation is a WhatsApp group — shows the
   *  sender's name/avatar above customer-side bubbles, same as
   *  WhatsApp's own group UI. Ignored for agent/bot bubbles (always
   *  "us", never ambiguous). */
  isGroup?: boolean;
}

/** Splits `text` on case-insensitive occurrences of `query`, wrapping each
 *  match in a themed <mark> so it reads as "found" without breaking the
 *  message's own text color. Returns `text` unchanged when `query` is empty
 *  — the common case, kept cheap since it runs per-bubble per render. */
function highlightText(text: string, query?: string): ReactNode {
  if (!query?.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={i} className="rounded-sm bg-primary/30 text-inherit">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

const URL_REGEX = /https?:\/\/[^\s]+/g;
// Trailing punctuation that's almost always sentence structure, not part
// of the URL itself (e.g. "check this out: https://x.com/foo." or a link
// in parentheses).
const URL_TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

/** First http(s) URL found in `text`, trimmed of trailing punctuation, or
 *  null if there isn't one. Used to decide whether to show a link
 *  preview card below the bubble — WhatsApp itself only ever previews
 *  the first link in a message, so this doesn't bother finding more. */
function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  if (!match) return null;
  return match[0].replace(URL_TRAILING_PUNCTUATION, "");
}

/** Splits `text` into plain-text and URL segments so URLs can render as
 *  clickable links while everything else still goes through
 *  `highlightText` for in-thread search highlighting. */
function splitTextWithLinks(text: string): Array<{ type: "text" | "link"; value: string }> {
  const parts: Array<{ type: "text" | "link"; value: string }> = [];
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    let url = match[0];
    const trailing = url.match(URL_TRAILING_PUNCTUATION)?.[0] ?? "";
    if (trailing) url = url.slice(0, url.length - trailing.length);
    parts.push({ type: "link", value: url });
    if (trailing) parts.push({ type: "text", value: trailing });
    lastIndex = URL_REGEX.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: "text", value: text.slice(lastIndex) });
  return parts;
}

/** Splits `text` on any resolved @mention placeholder (the raw
 *  `@<digits>` Baileys embeds in a group message's text — see
 *  Message.mentions' doc comment) so it can render as `@{name}` instead
 *  of the raw digits, which are frequently an internal @lid number, not
 *  the participant's actual phone. Longest digit-string first so one
 *  mention's placeholder can't be shadowed by another that happens to
 *  be a prefix of it. Falls back to the raw digits when a mention
 *  resolved neither a name nor a phone (nothing usable to show). */
function splitMentions(
  text: string,
  mentions: Message["mentions"],
): Array<{ type: "text" | "mention"; value: string; label?: string; colorKey?: string }> {
  if (!mentions || mentions.length === 0) return [{ type: "text", value: text }];
  const entries = mentions
    .map((m) => ({ digits: m.jid.split("@")[0], label: m.name || m.phone }))
    .filter((e): e is { digits: string; label: string } => !!e.digits && !!e.label)
    .sort((a, b) => b.digits.length - a.digits.length);
  if (entries.length === 0) return [{ type: "text", value: text }];

  const pattern = entries.map((e) => `@${e.digits}`).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "g"));
  return parts
    .filter((part) => part !== "")
    .map((part) => {
      const match = entries.find((e) => part === `@${e.digits}`);
      return match
        ? { type: "mention" as const, value: part, label: match.label, colorKey: match.digits }
        : { type: "text" as const, value: part };
    });
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/") || url.startsWith("/api/whatsapp/evolution-media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ""}
      alt={alt}
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function MessageContent({
  message,
  t,
  highlightQuery,
  isAgent,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  highlightQuery?: string;
  isAgent: boolean;
}) {
  switch (message.content_type) {
    case "text": {
      const text = message.content_text ?? "";
      const mentionParts = splitMentions(text, message.mentions);
      const firstUrl = extractFirstUrl(text);
      return (
        <div>
          <p className="whitespace-pre-wrap break-words text-sm">
            {mentionParts.map((mentionPart, i) => {
              if (mentionPart.type === "mention") {
                return (
                  <span
                    key={i}
                    className={cn("font-medium", groupSenderColor(mentionPart.colorKey!))}
                  >
                    @{mentionPart.label}
                  </span>
                );
              }
              const formatSegments = parseWhatsAppFormatting(mentionPart.value);
              return formatSegments.map((seg, j) => {
                const key = `${i}-${j}`;
                if (seg.type === "code") {
                  return (
                    <code
                      key={key}
                      className="rounded bg-black/10 px-1 font-mono text-[0.9em] dark:bg-white/15"
                    >
                      {seg.value}
                    </code>
                  );
                }
                // Links can still appear inside *bold*/_italic_/~strike~
                // text, so run the same link-splitting on every segment's
                // inner value, not just plain-text ones.
                const rendered = splitTextWithLinks(seg.value).map((part, k) =>
                  part.type === "link" ? (
                    <a
                      key={`${key}-${k}`}
                      href={part.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80"
                    >
                      {part.value}
                    </a>
                  ) : (
                    <span key={`${key}-${k}`}>{highlightText(part.value, highlightQuery)}</span>
                  ),
                );
                switch (seg.type) {
                  case "bold":
                    return <strong key={key}>{rendered}</strong>;
                  case "italic":
                    return <em key={key}>{rendered}</em>;
                  case "strike":
                    return (
                      <s key={key} className="opacity-70">
                        {rendered}
                      </s>
                    );
                  default:
                    return <span key={key}>{rendered}</span>;
                }
              });
            })}
          </p>
          {firstUrl && <LinkPreviewCard url={firstUrl} onDark={isAgent} />}
        </div>
      );
    }

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div className="min-w-0">
          {message.media_url ? (
            // `min-w-0` is load-bearing here, not decorative: the native
            // <audio> control has an intrinsic min-width Tailwind's
            // max-w-60 alone doesn't clip, which was pushing the thread
            // into a horizontal scrollbar it doesn't need — same class
            // of bug already fixed once in reply-quote.tsx.
            <audio src={message.media_url} controls className="w-60 max-w-full min-w-0" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

/** Deterministic color for a group sender's name, keyed off their
 *  contact id so the same person always gets the same color across
 *  messages — same idea as WhatsApp's own group name coloring. Picked
 *  from a small fixed palette rather than hashing to an arbitrary hue,
 *  so every color is legible on both the light and dark bubble
 *  background. */
const GROUP_SENDER_COLORS = [
  "text-emerald-400",
  "text-sky-400",
  "text-amber-400",
  "text-fuchsia-400",
  "text-rose-400",
  "text-violet-400",
  "text-teal-400",
  "text-orange-400",
];
function groupSenderColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_SENDER_COLORS[hash % GROUP_SENDER_COLORS.length];
}

function GroupSenderLabel({
  message,
  t,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
}) {
  const label = message.sender?.name || message.sender?.phone || t("groupSenderUnknown");
  const colorClass = groupSenderColor(message.sender_id ?? "unknown");
  return (
    <div className="mb-0.5 flex items-center gap-1.5">
      {message.sender?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={message.sender.avatar_url}
          alt=""
          className="size-4 shrink-0 rounded-full object-cover"
        />
      ) : null}
      <span className={cn("text-xs font-medium", colorClass)}>{label}</span>
    </div>
  );
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  highlightQuery,
  isGroup,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");
  const showGroupSender = isGroup && !isAgent;

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row. The `id`
  // is the scroll target for in-thread search match navigation (Área A.4).
  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      {showGroupSender && <GroupSenderLabel message={message} t={t} />}
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : // bg-muted alone is nearly indistinguishable from the
              // thread's bg-background wallpaper in light mode (both
              // near-white) — the border gives the lead's bubble a
              // visible edge in both themes without touching the
              // shared --muted token used elsewhere.
              "rounded-bl-md border border-border/60 bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} t={t} highlightQuery={highlightQuery} isAgent={isAgent} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
