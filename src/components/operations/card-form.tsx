"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { OperationBoardStage, OperationCard, OperationCardPriority, Profile } from "@/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const PRIORITIES: OperationCardPriority[] = ["low", "normal", "high", "urgent"];

interface CardFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: OperationCard | null;
  boardId: string;
  stages: OperationBoardStage[];
  defaultStageId?: string;
  onSaved: (cardId: string) => void;
}

export function CardForm({ open, onOpenChange, card, boardId, stages, defaultStageId, onSaved }: CardFormProps) {
  const t = useTranslations("Operations.cardForm");
  const tPriority = useTranslations("Operations.priority");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<OperationCardPriority>("normal");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (card) {
      setTitle(card.title);
      setDescription(card.description ?? "");
      setPriority(card.priority);
      setStageId(card.stage_id);
      setAssignedTo(card.assigned_to_user_id ?? "");
    } else {
      setTitle("");
      setDescription("");
      setPriority("normal");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
    }
  }, [open, card, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      if (!cancelled) setProfiles((data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  async function handleSave() {
    if (!title.trim() || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      stage_id: stageId,
      assigned_to_user_id: assignedTo || null,
    };

    if (card) {
      const { error } = await supabase.from("operation_cards").update(payload).eq("id", card.id);
      setSaving(false);
      if (error) {
        toast.error(t("toastFailedSave"));
        return;
      }
      toast.success(t("toastUpdated"));
      onOpenChange(false);
      onSaved(card.id);
      return;
    }

    if (!accountId) {
      toast.error(t("toastNotLinked"));
      setSaving(false);
      return;
    }
    const { data, error } = await supabase
      .from("operation_cards")
      .insert({ ...payload, board_id: boardId, account_id: accountId })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(t("toastFailedCreate"));
      return;
    }
    toast.success(t("toastCreated"));
    onOpenChange(false);
    onSaved(data.id);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 border-border bg-popover p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-popover-foreground">{card ? t("editTitle") : t("newTitle")}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("title")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("stage")}</Label>
            <Select value={stageId} onValueChange={(v) => setStageId(v ?? "")}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("priority")}</Label>
            <Select value={priority} onValueChange={(v) => setPriority((v as OperationCardPriority) ?? "normal")}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {tPriority(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("assignee")}</Label>
            <Select value={assignedTo || "none"} onValueChange={(v) => setAssignedTo(v === "none" ? "" : (v ?? ""))}>
              <SelectTrigger className="w-full bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("unassigned")}</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.user_id}>
                    {p.full_name ?? p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim() || !stageId}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? t("saving") : card ? t("saveChanges") : t("createCard")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
