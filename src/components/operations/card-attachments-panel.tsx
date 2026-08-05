"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import type { OperationCardAttachment } from "@/types";
import { Button } from "@/components/ui/button";
import { Paperclip, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const CARD_ATTACHMENTS_MAX_BYTES = 25 * 1024 * 1024;

interface CardAttachmentsPanelProps {
  cardId: string;
  accountId: string;
  /** Omit for the Card's general attachments; pass to scope to one Task's own attachments (074). */
  taskId?: string | null;
}

export function CardAttachmentsPanel({ cardId, accountId, taskId }: CardAttachmentsPanelProps) {
  const t = useTranslations("Operations.cardDetail.attachments");
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<OperationCardAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from("operation_card_attachments").select("*").eq("card_id", cardId);
    query = taskId ? query.eq("task_id", taskId) : query.is("task_id", null);
    const { data } = await query.order("created_at", { ascending: false });
    setAttachments((data ?? []) as OperationCardAttachment[]);
  }, [supabase, cardId, taskId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > CARD_ATTACHMENTS_MAX_BYTES) {
      toast.error(t("toastTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia("card-attachments", file);
      void publicUrl;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("operation_card_attachments").insert({
        card_id: cardId,
        account_id: accountId,
        task_id: taskId ?? null,
        uploaded_by_user_id: user?.id ?? null,
        storage_bucket: "card-attachments",
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
      });
      if (error) throw error;
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastFailedUpload"));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(attachment: OperationCardAttachment) {
    const { error } = await supabase.from("operation_card_attachments").delete().eq("id", attachment.id);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    await supabase.storage.from(attachment.storage_bucket).remove([attachment.storage_path]);
    load();
  }

  function publicUrlFor(attachment: OperationCardAttachment) {
    const { data } = supabase.storage.from(attachment.storage_bucket).getPublicUrl(attachment.storage_path);
    return data.publicUrl;
  }

  return (
    <div className="space-y-2">
      {attachments.length === 0 && <p className="text-xs text-muted-foreground">{t("noAttachments")}</p>}
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
          <a
            href={publicUrlFor(attachment)}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1.5 text-xs text-foreground hover:underline"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{attachment.file_name}</span>
          </a>
          <button type="button" onClick={() => handleRemove(attachment)} className="shrink-0 text-muted-foreground hover:text-red-400">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Paperclip className="mr-1 h-3.5 w-3.5" />
        {uploading ? t("uploading") : t("addAttachment")}
      </Button>
    </div>
  );
}
