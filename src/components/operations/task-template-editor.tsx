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
import type {
  OperationCardPriority,
  OperationTaskTemplate,
  OperationTaskTemplateAssigneeMode,
  OperationTaskTemplateChecklistItem,
  OperationTaskTemplateSubtask,
  Profile,
} from "@/types";

const PRIORITIES: OperationCardPriority[] = ["low", "normal", "high", "urgent"];
const ASSIGNEE_MODES: OperationTaskTemplateAssigneeMode[] = ["none", "specific_user", "card_assignee"];

interface TaskTemplateEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  boardId: string;
}

export function TaskTemplateEditor({ open, onOpenChange, accountId, boardId }: TaskTemplateEditorProps) {
  const t = useTranslations("Operations.taskTemplateEditor");
  const tPriority = useTranslations("Operations.priority");
  const supabase = createClient();

  const [templates, setTemplates] = useState<OperationTaskTemplate[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<OperationCardPriority>("normal");
  const [assigneeMode, setAssigneeMode] = useState<OperationTaskTemplateAssigneeMode>("none");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [dueOffsetDays, setDueOffsetDays] = useState("");
  const [section, setSection] = useState("");
  const [scope, setScope] = useState<"global" | "board">("board");
  const [subtasks, setSubtasks] = useState<OperationTaskTemplateSubtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [checklistItems, setChecklistItems] = useState<OperationTaskTemplateChecklistItem[]>([]);
  const [newChecklistItemText, setNewChecklistItemText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: templateRows }, { data: profileRows }] = await Promise.all([
      supabase.from("operation_task_templates").select("*").is("archived_at", null).order("position"),
      supabase.from("profiles").select("*").order("full_name"),
    ]);
    setTemplates((templateRows ?? []) as OperationTaskTemplate[]);
    setProfiles((profileRows ?? []) as Profile[]);
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
    setPriority("normal");
    setAssigneeMode("none");
    setAssigneeUserId("");
    setDueOffsetDays("");
    setSection("");
    setScope("board");
    setSubtasks([]);
    setChecklistItems([]);
  }

  async function startEdit(template: OperationTaskTemplate) {
    setEditingId(template.id);
    setName(template.name);
    setDescription(template.description ?? "");
    setPriority(template.default_priority);
    setAssigneeMode(template.default_assignee_mode);
    setAssigneeUserId(template.default_assignee_user_id ?? "");
    setDueOffsetDays(template.default_due_offset_days != null ? String(template.default_due_offset_days) : "");
    setSection(template.default_section ?? "");
    setScope(template.board_id ? "board" : "global");
    const [{ data: subtaskRows }, { data: itemRows }] = await Promise.all([
      supabase.from("operation_task_template_subtasks").select("*").eq("template_id", template.id).order("position"),
      supabase.from("operation_task_template_checklist_items").select("*").eq("template_id", template.id).order("position"),
    ]);
    setSubtasks((subtaskRows ?? []) as OperationTaskTemplateSubtask[]);
    setChecklistItems((itemRows ?? []) as OperationTaskTemplateChecklistItem[]);
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
      default_priority: priority,
      default_assignee_mode: assigneeMode,
      default_assignee_user_id: assigneeMode === "specific_user" ? assigneeUserId || null : null,
      default_due_offset_days: dueOffsetDays.trim() ? Number(dueOffsetDays) : null,
      default_section: section.trim() || null,
      board_id: scope === "board" ? boardId : null,
    };

    let templateId = editingId !== "new" ? editingId : null;

    if (templateId) {
      const { error } = await supabase.from("operation_task_templates").update(payload).eq("id", templateId);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
      // Replace subtasks/checklist items wholesale — simplest correct
      // approach for a low-cardinality admin form (a handful of rows).
      await supabase.from("operation_task_template_subtasks").delete().eq("template_id", templateId);
      await supabase.from("operation_task_template_checklist_items").delete().eq("template_id", templateId);
    } else {
      const { data, error } = await supabase
        .from("operation_task_templates")
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

    if (subtasks.length > 0) {
      await supabase.from("operation_task_template_subtasks").insert(
        subtasks.map((s, i) => ({
          template_id: templateId,
          title: s.title,
          default_priority: s.default_priority,
          default_due_offset_days: s.default_due_offset_days,
          position: i,
        })),
      );
    }
    if (checklistItems.length > 0) {
      await supabase.from("operation_task_template_checklist_items").insert(
        checklistItems.map((it, i) => ({ template_id: templateId, item_text: it.item_text, position: i })),
      );
    }

    setSaving(false);
    toast.success(t("toastSaved"));
    setEditingId(null);
    load();
  }

  async function handleDelete(templateId: string) {
    const { error } = await supabase.from("operation_task_templates").update({ archived_at: new Date().toISOString() }).eq("id", templateId);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    load();
  }

  function addSubtaskRow() {
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    setSubtasks((prev) => [...prev, { id: `local-${prev.length}`, template_id: "", title: trimmed, default_priority: "normal", position: prev.length }]);
    setNewSubtaskTitle("");
  }

  function addChecklistItemRow() {
    const trimmed = newChecklistItemText.trim();
    if (!trimmed) return;
    setChecklistItems((prev) => [...prev, { id: `local-${prev.length}`, template_id: "", item_text: trimmed, position: prev.length }]);
    setNewChecklistItemText("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
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
              <div className="grid grid-cols-2 gap-3">
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
                  <Label className="text-muted-foreground">{t("dueOffsetDays")}</Label>
                  <Input
                    type="number"
                    value={dueOffsetDays}
                    onChange={(e) => setDueOffsetDays(e.target.value)}
                    placeholder={t("dueOffsetDaysPlaceholder")}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("assigneeMode")}</Label>
                <Select value={assigneeMode} onValueChange={(v) => setAssigneeMode((v as OperationTaskTemplateAssigneeMode) ?? "none")}>
                  <SelectTrigger className="w-full bg-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNEE_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`assigneeModeValue.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {assigneeMode === "specific_user" && (
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("specificUser")}</Label>
                  <Select value={assigneeUserId} onValueChange={(v) => setAssigneeUserId(v ?? "")}>
                    <SelectTrigger className="w-full bg-muted">
                      <SelectValue placeholder={t("specificUserPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.user_id}>
                          {p.full_name ?? p.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("section")}</Label>
                <Input value={section} onChange={(e) => setSection(e.target.value)} className="border-border bg-muted text-foreground" />
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
                <Label className="mb-1.5 block text-muted-foreground">{t("subtasks")}</Label>
                <div className="space-y-1">
                  {subtasks.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
                      <span className="flex-1 truncate text-sm text-foreground">{s.title}</span>
                      <button
                        type="button"
                        onClick={() => setSubtasks((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder={t("newSubtaskPlaceholder")}
                    className="h-8 flex-1 border-border bg-muted text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSubtaskRow();
                    }}
                  />
                  <Button variant="ghost" size="sm" onClick={addSubtaskRow} className="h-8 text-muted-foreground hover:text-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-muted-foreground">{t("checklistItems")}</Label>
                <div className="space-y-1">
                  {checklistItems.map((it, i) => (
                    <div key={it.id} className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
                      <span className="flex-1 truncate text-sm text-foreground">{it.item_text}</span>
                      <button
                        type="button"
                        onClick={() => setChecklistItems((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Input
                    value={newChecklistItemText}
                    onChange={(e) => setNewChecklistItemText(e.target.value)}
                    placeholder={t("newChecklistItemPlaceholder")}
                    className="h-8 flex-1 border-border bg-muted text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addChecklistItemRow();
                    }}
                  />
                  <Button variant="ghost" size="sm" onClick={addChecklistItemRow} className="h-8 text-muted-foreground hover:text-foreground">
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
