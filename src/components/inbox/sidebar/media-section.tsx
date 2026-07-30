"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Link as LinkIcon, Image as ImageIcon, Video, Paperclip } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { Conversation, Message } from "@/types";

const URL_RE = /https?:\/\/[^\s]+/g;

interface MediaSectionProps {
  conversation: Conversation;
}

export function MediaSection({ conversation }: MediaSectionProps) {
  const t = useTranslations("Inbox.sidebar.media");
  const [messages, setMessages] = useState<Pick<Message, "id" | "content_type" | "content_text" | "media_url">[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, content_type, content_text, media_url")
        .eq("conversation_id", conversation.id)
        .in("content_type", ["image", "video", "document", "text"])
        .order("created_at", { ascending: false });
      if (!cancelled) setMessages(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  const photos = useMemo(() => messages.filter((m) => m.content_type === "image" && m.media_url), [messages]);
  const videos = useMemo(() => messages.filter((m) => m.content_type === "video" && m.media_url), [messages]);
  const docs = useMemo(() => messages.filter((m) => m.content_type === "document" && m.media_url), [messages]);
  const links = useMemo(() => {
    const found: string[] = [];
    for (const m of messages) {
      if (m.content_type !== "text" || !m.content_text) continue;
      const matches = m.content_text.match(URL_RE);
      if (matches) found.push(...matches);
    }
    return found;
  }, [messages]);

  return (
    <Accordion defaultValue={["media"]}>
      <AccordionItem value="media" className="border-none">
        <AccordionTrigger className="px-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
          <span className="flex items-center gap-2">
            <Paperclip className="h-3 w-3" />
            {t("title")}
          </span>
        </AccordionTrigger>
        <AccordionContent>
      <Tabs defaultValue="photos">
        <TabsList className="w-full">
          <TabsTrigger value="photos" className="text-xs">
            {t("tabs.photos")} ({photos.length})
          </TabsTrigger>
          <TabsTrigger value="videos" className="text-xs">
            {t("tabs.videos")} ({videos.length})
          </TabsTrigger>
          <TabsTrigger value="links" className="text-xs">
            {t("tabs.links")} ({links.length})
          </TabsTrigger>
          <TabsTrigger value="docs" className="text-xs">
            {t("tabs.docs")} ({docs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="photos" className="mt-2">
          {photos.length === 0 ? (
            <EmptyState icon={ImageIcon} label={t("empty.photos")} />
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {photos.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.id} src={m.media_url!} alt="" className="aspect-square w-full rounded-md object-cover" />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="videos" className="mt-2">
          {videos.length === 0 ? (
            <EmptyState icon={Video} label={t("empty.videos")} />
          ) : (
            <div className="space-y-1.5">
              {videos.map((m) => (
                <video key={m.id} src={m.media_url!} controls className="w-full rounded-md" />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="links" className="mt-2">
          {links.length === 0 ? (
            <EmptyState icon={LinkIcon} label={t("empty.links")} />
          ) : (
            <div className="space-y-1">
              {links.map((url, i) => (
                <a
                  key={`${url}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded-lg bg-muted px-3 py-2 text-xs text-primary hover:underline"
                >
                  {url}
                </a>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="docs" className="mt-2">
          {docs.length === 0 ? (
            <EmptyState icon={FileText} label={t("empty.docs")} />
          ) : (
            <div className="space-y-1">
              {docs.map((m) => (
                <a
                  key={m.id}
                  href={m.media_url!}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 truncate rounded-lg bg-muted px-3 py-2 text-xs text-foreground hover:bg-muted/70"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {t("document")}
                </a>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function EmptyState({ icon: Icon, label }: { icon: typeof ImageIcon; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-6 text-center">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
