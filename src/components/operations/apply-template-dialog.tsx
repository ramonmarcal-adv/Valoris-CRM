"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyTaskTemplate } from "@/lib/operations/task-templates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationTaskTemplate } from "@/types";

interface ApplyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  cardId: string;
  onApplied: () => void;
}

export function ApplyTemplateDialog({ open, onOpenChange, boardId, cardId, onApplied }: ApplyTemplateDialogProps) {
  const t = useTranslations("Operations.applyTemplate");
  const supabase = createClient();

  const [templates, setTemplates] = useState<OperationTaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [preventDuplicate, setPreventDuplicate] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("operation_task_templates")
        .select("*")
        .is("archived_at", null)
        .or(`board_id.is.null,board_id.eq.${boardId}`)
        .order("position");
      setTemplates((data ?? []) as OperationTaskTemplate[]);
      setTemplateId("");
    })();
  }, [open, boardId, supabase]);

  async function handleApply() {
    if (!templateId) return;
    setApplying(true);
    const { taskId, error } = await applyTaskTemplate(supabase, { templateId, cardId, preventDuplicate });
    setApplying(false);
    if (error || !taskId) {
      toast.error(preventDuplicate ? t("toastFailedDuplicate") : t("toastFailed"));
      return;
    }
    toast.success(t("toastApplied"));
    onOpenChange(false);
    onApplied();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
          ) : (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("selectTemplate")}</Label>
              <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? "")}>
                <SelectTrigger className="w-full bg-muted">
                  <SelectValue placeholder={t("selectTemplatePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox checked={preventDuplicate} onCheckedChange={(v) => setPreventDuplicate(v === true)} />
            {t("preventDuplicate")}
          </label>
        </div>
        <DialogFooter className="border-border bg-popover/50">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleApply}
            disabled={!templateId || applying}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {applying ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
