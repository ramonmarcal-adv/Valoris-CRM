"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationChecklistTemplate, OperationChecklistTemplateItem } from "@/types";

interface ChecklistTemplateEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  boardId: string;
}

export function ChecklistTemplateEditor({ open, onOpenChange, accountId, boardId }: ChecklistTemplateEditorProps) {
  const t = useTranslations("Operations.checklistTemplateEditor");
  const supabase = createClient();

  const [templates, setTemplates] = useState<OperationChecklistTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"global" | "board">("board");
  const [items, setItems] = useState<OperationChecklistTemplateItem[]>([]);
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("operation_checklist_templates").select("*").is("archived_at", null).order("position");
    setTemplates((data ?? []) as OperationChecklistTemplate[]);
  };

  useEffect(() => {
    if (!open) return;
    load();
    setEditingId(null);
    // Only re-run when the dialog opens, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetForm() {
    setName("");
    setDescription("");
    setScope("board");
    setItems([]);
  }

  async function startEdit(template: OperationChecklistTemplate) {
    setEditingId(template.id);
    setName(template.name);
    setDescription(template.description ?? "");
    setScope(template.board_id ? "board" : "global");
    const { data: itemRows } = await supabase
      .from("operation_checklist_template_items")
      .select("*")
      .eq("template_id", template.id)
      .order("position");
    setItems((itemRows ?? []) as OperationChecklistTemplateItem[]);
  }

  function startNew() {
    resetForm();
    setEditingId("new");
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);

    const payload = {
      name: trimmed,
      description: description.trim() || null,
      board_id: scope === "board" ? boardId : null,
    };

    let templateId = editingId !== "new" ? editingId : null;

    if (templateId) {
      const { error } = await supabase.from("operation_checklist_templates").update(payload).eq("id", templateId);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
      await supabase.from("operation_checklist_template_items").delete().eq("template_id", templateId);
    } else {
      const { data, error } = await supabase
        .from("operation_checklist_templates")
        .insert({ ...payload, account_id: accountId, position: templates.length })
        .select()
        .single();
      if (error || !data) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
      templateId = data.id;
    }

    if (items.length > 0) {
      await supabase.from("operation_checklist_template_items").insert(
        items.map((it, i) => ({ template_id: templateId, item_text: it.item_text, position: i })),
      );
    }

    setSaving(false);
    toast.success(t("toastSaved"));
    setEditingId(null);
    load();
  }

  async function handleDelete(templateId: string) {
    const { error } = await supabase
      .from("operation_checklist_templates")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", templateId);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    load();
  }

  function addItemRow() {
    const trimmed = newItemText.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, { id: `local-${prev.length}`, template_id: "", item_text: trimmed, position: prev.length }]);
    setNewItemText("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-md">
        {editingId === null ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {templates.length === 0 && <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>}
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{tpl.name}</p>
                    <p className="text-[11px] text-muted-foreground">{tpl.board_id ? t("scopeBoard") : t("scopeGlobal")}</p>
                  </div>
                  <Button variant="ghost" size="icon-xs" onClick={() => startEdit(tpl)} className="text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(tpl.id)} className="text-muted-foreground hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter className="border-border bg-popover/50">
              <Button onClick={startNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("newTemplate")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <DialogTitle className="text-popover-foreground">
                  {editingId === "new" ? t("newTemplate") : t("editTemplate")}
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-muted text-foreground" />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("description")}</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="border-border bg-muted text-foreground" />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("scope")}</Label>
                <Select value={scope} onValueChange={(v) => setScope((v as "global" | "board") ?? "board")}>
                  <SelectTrigger className="w-full bg-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="board">{t("scopeBoard")}</SelectItem>
                    <SelectItem value="global">{t("scopeGlobal")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-muted-foreground">{t("items")}</Label>
                <div className="space-y-1">
                  {items.map((it, i) => (
                    <div key={it.id} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
                      <span className="flex-1 truncate text-sm text-foreground">{it.item_text}</span>
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder={t("newItemPlaceholder")}
                    className="h-8 flex-1 border-border bg-muted text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addItemRow();
                    }}
                  />
                  <Button variant="ghost" size="sm" onClick={addItemRow} className="h-8 text-muted-foreground hover:text-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button variant="outline" onClick={() => setEditingId(null)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
                {t("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
