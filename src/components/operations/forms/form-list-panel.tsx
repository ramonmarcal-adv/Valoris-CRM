"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { slugifyFormSlug } from "@/lib/operations/forms/slug";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { OperationForm } from "@/types";

interface FormListPanelProps {
  boardId: string;
  accountId: string;
}

export function FormListPanel({ boardId, accountId }: FormListPanelProps) {
  const t = useTranslations("Operations.forms.list");
  const router = useRouter();
  const supabase = createClient();

  const [forms, setForms] = useState<OperationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("operation_forms")
      .select("*")
      .eq("board_id", boardId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    setForms((data ?? []) as OperationForm[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  async function handleTogglePublished(form: OperationForm) {
    const { error } = await supabase.from("operation_forms").update({ is_published: !form.is_published }).eq("id", form.id);
    if (error) {
      toast.error(t("toastFailedToggle"));
      return;
    }
    load();
  }

  async function handleDelete(formId: string) {
    const { error } = await supabase.from("operation_forms").update({ archived_at: new Date().toISOString() }).eq("id", formId);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    load();
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("operation_forms")
      .insert({
        account_id: accountId,
        board_id: boardId,
        name: trimmed,
        slug: `${slugifyFormSlug(trimmed)}-${Date.now().toString(36)}`,
        title_template: "",
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(t("toastFailedCreate"));
      return;
    }
    router.push(`/operations/boards/${boardId}/forms/${data.id}`);
  }

  if (loading) {
    return <div className="h-32 animate-pulse rounded-xl bg-muted/50" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setNewDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("newForm")}
        </Button>
      </div>

      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
          <p className="text-sm text-muted-foreground">{t("noForms")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {forms.map((form) => (
            <div key={form.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <Switch checked={form.is_published} onCheckedChange={() => handleTogglePublished(form)} />
              <button
                type="button"
                onClick={() => router.push(`/operations/boards/${boardId}/forms/${form.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-foreground">{form.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {form.is_published ? t("published") : t("draft")}
                </p>
              </button>
              <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(form.id)} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newForm")}</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="border-border bg-muted text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setNewDialogOpen(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {creating ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
