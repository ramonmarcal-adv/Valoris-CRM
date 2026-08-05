"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OperationCardComment, Profile } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString();
}

export function CardCommentsPanel({ cardId, accountId }: { cardId: string; accountId: string }) {
  const t = useTranslations("Operations.cardDetail.comments");
  const supabase = createClient();

  const [comments, setComments] = useState<OperationCardComment[]>([]);
  const [profilesByUserId, setProfilesByUserId] = useState<Map<string, Profile>>(new Map());
  const [text, setText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: profiles }] = await Promise.all([
      supabase.from("operation_card_comments").select("*").eq("card_id", cardId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
    ]);
    setComments((rows ?? []) as OperationCardComment[]);
    setProfilesByUserId(new Map(((profiles ?? []) as Profile[]).map((p) => [p.user_id, p])));
  }, [supabase, cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("operation_card_comments").insert({
      card_id: cardId,
      account_id: accountId,
      user_id: user?.id ?? null,
      comment_text: trimmed,
      is_internal: isInternal,
    });
    setSending(false);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    setText("");
    load();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          rows={2}
          className="border-border bg-muted text-foreground"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={isInternal} onCheckedChange={(v) => setIsInternal(v === true)} />
            {t("internalOnly")}
          </label>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("send")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {comments.length === 0 && <p className="text-xs text-muted-foreground">{t("noComments")}</p>}
        {comments.map((comment) => {
          const author = comment.user_id ? profilesByUserId.get(comment.user_id) : null;
          return (
            <div key={comment.id} className="rounded-lg border border-border bg-muted/50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{author?.full_name ?? t("unknownAuthor")}</span>
                <span className="text-[10px] text-muted-foreground">{formatDateTime(comment.created_at)}</span>
              </div>
              {comment.is_internal && (
                <span className="mt-1 inline-block rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                  {t("internalBadge")}
                </span>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{comment.comment_text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
