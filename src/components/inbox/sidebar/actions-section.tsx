"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { Contact, Conversation } from "@/types";

interface ActionsSectionProps {
  contact: Contact;
  conversation: Conversation;
  /** Called after the conversation is deleted so the parent can clear
   *  the active thread (mirrors the confirm-then-delete pattern used by
   *  tag-manager.tsx / pipeline-settings.tsx). */
  onConversationDeleted: (conversationId: string) => void;
}

export function ActionsSection({ contact, conversation, onConversationDeleted }: ActionsSectionProps) {
  const t = useTranslations("Inbox.sidebar.actionsSection");
  const { user } = useAuth();

  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleBlock = useCallback(async () => {
    if (!user?.id) return;
    setBlocking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({
        is_blocked: true,
        blocked_at: new Date().toISOString(),
        blocked_by_user_id: user.id,
      })
      .eq("id", contact.id);
    setBlocking(false);
    setBlockDialogOpen(false);
    if (error) {
      toast.error(t("toastBlockFailed"));
      return;
    }
    toast.success(t("toastBlocked"));
  }, [contact, user, t]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("conversations").delete().eq("id", conversation.id);
    setDeleting(false);
    setDeleteDialogOpen(false);
    if (error) {
      toast.error(t("toastDeleteFailed"));
      return;
    }
    toast.success(t("toastDeleted"));
    onConversationDeleted(conversation.id);
  }, [conversation.id, onConversationDeleted, t]);

  return (
    <>
    <Accordion defaultValue={["actions"]}>
      <AccordionItem value="actions" className="border-none">
        <AccordionTrigger className="px-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-3 w-3" />
            {t("title")}
          </span>
        </AccordionTrigger>
        <AccordionContent>
    <div className="space-y-1">
      <button
        onClick={() => setBlockDialogOpen(true)}
        disabled={contact.is_blocked}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
      >
        <Ban className="h-3.5 w-3.5" />
        {contact.is_blocked ? t("contactBlocked") : t("blockContact")}
      </button>
      <button
        onClick={() => setDeleteDialogOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("deleteConversation")}
      </button>
    </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("blockContact")}</DialogTitle>
            <DialogDescription>{t("blockContactConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockDialogOpen(false)} disabled={blocking}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleBlock} disabled={blocking}>
              {t("blockContact")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteConversation")}</DialogTitle>
            <DialogDescription>{t("deleteConversationConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {t("deleteConversation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
