"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { findMissingRequiredFields, resolveVisibleFields, valueColumnForFieldType } from "@/lib/operations/card-fields";
import { CardFieldEditor } from "@/components/operations/card-field-editor";
import { CardTagsPicker } from "@/components/operations/card-tags-picker";
import { CardCommentsPanel } from "@/components/operations/card-comments-panel";
import { CardActivityFeed } from "@/components/operations/card-activity-feed";
import { CardRelationsPanel } from "@/components/operations/card-relations-panel";
import { CardAttachmentsPanel } from "@/components/operations/card-attachments-panel";
import { CardContactsPanel } from "@/components/operations/card-contacts-panel";
import { CardConversationsPanel } from "@/components/operations/card-conversations-panel";
import { CardTasksPanel } from "@/components/operations/card-tasks-panel";
import { ChecklistPanel } from "@/components/operations/checklist-panel";
import { PriorityBadge } from "@/components/operations/priority-badge";
import type {
  Contact,
  OperationBoard,
  OperationBoardStage,
  OperationCard,
  OperationCardFieldDef,
  OperationCardFieldValue,
  OperationCardPriority,
  Profile,
} from "@/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GatedButton } from "@/components/ui/gated-button";
import { ArrowLeft, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const PRIORITIES: OperationCardPriority[] = ["low", "normal", "high", "urgent"];

export default function OperationCardPage() {
  const t = useTranslations("Operations.cardPage");
  const tPriority = useTranslations("Operations.priority");
  const params = useParams<{ cardId: string }>();
  const supabase = createClient();
  const { accountId } = useAuth();
  const canManage = useCan("send-messages");

  const [card, setCard] = useState<OperationCard | null>(null);
  const [board, setBoard] = useState<OperationBoard | null>(null);
  const [stages, setStages] = useState<OperationBoardStage[]>([]);
  const [fieldDefs, setFieldDefs] = useState<OperationCardFieldDef[]>([]);
  const [fieldValues, setFieldValues] = useState<OperationCardFieldValue[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [boardCards, setBoardCards] = useState<OperationCard[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    const { data: c } = await supabase.from("operation_cards").select("*").eq("id", params.cardId).maybeSingle();
    if (!c) {
      setCard(null);
      setLoading(false);
      return;
    }
    const cardRow = c as OperationCard;
    setCard(cardRow);
    setTitle(cardRow.title);
    setDescription(cardRow.description ?? "");

    const [{ data: b }, { data: s }, { data: fd }, { data: fv }, { data: profileRows }, { data: contactRows }, { data: cards }] =
      await Promise.all([
        supabase.from("operation_boards").select("*").eq("id", cardRow.board_id).maybeSingle(),
        supabase.from("operation_board_stages").select("*").eq("board_id", cardRow.board_id).is("archived_at", null).order("position"),
        supabase.from("operation_card_field_defs").select("*").eq("board_id", cardRow.board_id).is("archived_at", null).order("position"),
        supabase.from("operation_card_field_values").select("*").eq("card_id", cardRow.id),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("contacts").select("*").order("name"),
        supabase.from("operation_cards").select("*").eq("board_id", cardRow.board_id).is("archived_at", null),
      ]);
    setBoard(b as OperationBoard | null);
    setStages((s ?? []) as OperationBoardStage[]);
    setFieldDefs((fd ?? []) as OperationCardFieldDef[]);
    setFieldValues((fv ?? []) as OperationCardFieldValue[]);
    setProfiles((profileRows ?? []) as Profile[]);
    setContacts((contactRows ?? []) as Contact[]);
    setBoardCards((cards ?? []) as OperationCard[]);
    setLoading(false);
  }, [supabase, params.cardId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function patchCard(patch: Partial<OperationCard>) {
    if (!card) return;
    setCard({ ...card, ...patch });
    const { error } = await supabase.from("operation_cards").update(patch).eq("id", card.id);
    if (error) {
      toast.error(t("toastFailedSave"));
      load();
    }
  }

  async function handleFieldCommit(def: OperationCardFieldDef, patch: Record<string, unknown>) {
    if (!card) return;
    const column = valueColumnForFieldType(def.field_type);
    const { data, error } = await supabase
      .from("operation_card_field_values")
      .upsert(
        { card_id: card.id, field_def_id: def.id, ...patch },
        { onConflict: "card_id,field_def_id" },
      )
      .select()
      .single();
    if (error) {
      toast.error(t("toastFailedSaveField"));
      return;
    }
    void column;
    setFieldValues((prev) => {
      const rest = prev.filter((v) => v.field_def_id !== def.id);
      return [...rest, data as OperationCardFieldValue];
    });
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/50" />;
  }

  if (!card || !board) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
        <p className="text-sm text-muted-foreground">{t("cardNotFound")}</p>
        <Link href="/operations" className="mt-3 text-sm text-primary hover:underline">
          {t("backToOperations")}
        </Link>
      </div>
    );
  }

  const visibleFields = resolveVisibleFields(fieldDefs, card.stage_id);
  const missingRequired = findMissingRequiredFields(fieldDefs, fieldValues, card.stage_id);
  const valueByFieldDefId = new Map(fieldValues.map((v) => [v.field_def_id, v]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/operations/boards/${board.id}`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm text-muted-foreground">{board.name}</span>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-5">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== card.title && patchCard({ title: title.trim() })}
          disabled={!canManage}
          className="border-transparent bg-transparent px-0 text-lg font-semibold text-foreground focus:border-border focus:px-3"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("stage")}</Label>
            <Select value={card.stage_id} onValueChange={(v) => v && patchCard({ stage_id: v })}>
              <SelectTrigger className="h-8 w-40 bg-muted text-xs">
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

          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("priority")}</Label>
            <Select
              value={card.priority}
              onValueChange={(v) => v && patchCard({ priority: v as OperationCardPriority })}
            >
              <SelectTrigger className="h-8 w-32 bg-muted text-xs">
                <SelectValue>
                  <PriorityBadge priority={card.priority} />
                </SelectValue>
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

          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("assignee")}</Label>
            <Select
              value={card.assigned_to_user_id ?? "none"}
              onValueChange={(v) => patchCard({ assigned_to_user_id: v === "none" ? null : v })}
            >
              <SelectTrigger className="h-8 w-40 bg-muted text-xs">
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

          <div className="ml-auto">
            <GatedButton
              variant="outline"
              size="sm"
              canAct={canManage}
              gateReason="createBoards"
              onClick={() => patchCard({ archived_at: card.archived_at ? null : new Date().toISOString() })}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {card.archived_at ? (
                <>
                  <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
                  {t("unarchive")}
                </>
              ) : (
                <>
                  <Archive className="mr-1 h-3.5 w-3.5" />
                  {t("archive")}
                </>
              )}
            </GatedButton>
          </div>
        </div>

        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("description")}</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== (card.description ?? "") && patchCard({ description: description.trim() || null })}
            rows={3}
            className="border-border bg-muted text-foreground"
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("tags")}</Label>
          <CardTagsPicker cardId={card.id} readOnly={!canManage} />
        </div>
      </div>

      {visibleFields.length > 0 && (
        <Section title={t("customFields")}>
          {missingRequired.length > 0 && (
            <p className="mb-2 text-xs text-amber-400">{t("missingRequiredFields", { count: missingRequired.length })}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleFields.map((def) => (
              <div key={def.id} className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">
                  {def.name}
                  {def.is_required && <span className="ml-1 text-red-400">*</span>}
                </Label>
                <CardFieldEditor
                  def={def}
                  value={valueByFieldDefId.get(def.id)}
                  onCommit={(patch) => handleFieldCommit(def, patch)}
                  profiles={profiles}
                  contacts={contacts}
                  cards={boardCards}
                  currentCardId={card.id}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={t("tasks")}>
        {accountId && <CardTasksPanel cardId={card.id} accountId={accountId} boardId={board.id} />}
      </Section>

      <Section title={t("checklists")}>
        <ChecklistPanel cardId={card.id} />
      </Section>

      <Section title={t("linkedContacts")}>
        <CardContactsPanel cardId={card.id} />
      </Section>

      <Section title={t("linkedConversations")}>
        <CardConversationsPanel cardId={card.id} />
      </Section>

      <Section title={t("relatedCards")}>
        <CardRelationsPanel cardId={card.id} boardId={board.id} />
      </Section>

      <Section title={t("attachments")}>
        {accountId && <CardAttachmentsPanel cardId={card.id} accountId={accountId} />}
      </Section>

      <Section title={t("comments")}>
        {accountId && <CardCommentsPanel cardId={card.id} accountId={accountId} />}
      </Section>

      <Section title={t("activity")}>
        <CardActivityFeed cardId={card.id} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}
