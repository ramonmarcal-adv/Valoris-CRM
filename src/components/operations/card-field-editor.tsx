"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Contact, OperationCard, OperationCardFieldDef, OperationCardFieldValue, Profile } from "@/types";

type FieldValuePatch = Pick<
  OperationCardFieldValue,
  "value_text" | "long_text" | "value_number" | "value_date" | "value_boolean" | "value_uuid" | "value_multi_select"
>;

interface CardFieldEditorProps {
  def: OperationCardFieldDef;
  value: OperationCardFieldValue | undefined;
  onCommit: (patch: Partial<FieldValuePatch>) => void;
  profiles: Profile[];
  contacts: Contact[];
  cards: OperationCard[];
  currentCardId: string;
}

export function CardFieldEditor({ def, value, onCommit, profiles, contacts, cards, currentCardId }: CardFieldEditorProps) {
  const t = useTranslations("Operations.cardDetail");
  const choices: string[] = Array.isArray((def.field_options as { choices?: unknown })?.choices)
    ? ((def.field_options as { choices: string[] }).choices)
    : [];

  switch (def.field_type) {
    case "long_text":
      return <DebouncedTextarea initial={value?.long_text ?? ""} onCommit={(v) => onCommit({ long_text: v })} />;

    case "number":
    case "currency":
      return (
        <DebouncedInput
          type="number"
          initial={value?.value_number != null ? String(value.value_number) : ""}
          onCommit={(v) => onCommit({ value_number: v.trim() === "" ? null : Number(v) })}
        />
      );

    case "date":
      return (
        <Input
          type="date"
          defaultValue={value?.value_date ? value.value_date.slice(0, 10) : ""}
          onBlur={(e) => onCommit({ value_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="border-border bg-muted text-foreground"
        />
      );

    case "datetime":
      return (
        <Input
          type="datetime-local"
          defaultValue={value?.value_date ? value.value_date.slice(0, 16) : ""}
          onBlur={(e) => onCommit({ value_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="border-border bg-muted text-foreground"
        />
      );

    case "checkbox":
      return (
        <Checkbox
          checked={value?.value_boolean === true}
          onCheckedChange={(v) => onCommit({ value_boolean: v === true })}
        />
      );

    case "single_select":
      return (
        <Select value={value?.value_text ?? ""} onValueChange={(v) => onCommit({ value_text: v ?? null })}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi_select":
      return (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => {
            const selected = (value?.value_multi_select ?? []).includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const current = value?.value_multi_select ?? [];
                  const next = selected ? current.filter((v) => v !== c) : [...current, c];
                  onCommit({ value_multi_select: next });
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-border"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      );

    case "phone":
    case "email":
    case "url":
      return (
        <DebouncedInput
          type={def.field_type === "email" ? "email" : "text"}
          initial={value?.value_text ?? ""}
          onCommit={(v) => onCommit({ value_text: v.trim() || null })}
        />
      );

    case "user":
      return (
        <Select value={value?.value_uuid ?? "none"} onValueChange={(v) => onCommit({ value_uuid: v === "none" ? null : v })}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("none")}</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.user_id}>
                {p.full_name ?? p.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "contact":
      return (
        <Select value={value?.value_uuid ?? "none"} onValueChange={(v) => onCommit({ value_uuid: v === "none" ? null : v })}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("none")}</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || c.phone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "related_card":
      return (
        <Select value={value?.value_uuid ?? "none"} onValueChange={(v) => onCommit({ value_uuid: v === "none" ? null : v })}>
          <SelectTrigger className="w-full bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("none")}</SelectItem>
            {cards
              .filter((c) => c.id !== currentCardId)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      );

    default: // short_text
      return <DebouncedInput initial={value?.value_text ?? ""} onCommit={(v) => onCommit({ value_text: v.trim() || null })} />;
  }
}

/** Local state so keystrokes never hit the DB — only commits on blur, matching the field_changed trigger's documented expectation. */
function DebouncedInput({
  initial,
  onCommit,
  type = "text",
}: {
  initial: string;
  onCommit: (v: string) => void;
  type?: string;
}) {
  const [local, setLocal] = useState(initial);
  useEffect(() => {
    setLocal(initial);
  }, [initial]);
  return (
    <Input
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== initial) onCommit(local);
      }}
      className="border-border bg-muted text-foreground"
    />
  );
}

function DebouncedTextarea({ initial, onCommit }: { initial: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(initial);
  useEffect(() => {
    setLocal(initial);
  }, [initial]);
  return (
    <Textarea
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== initial) onCommit(local);
      }}
      rows={3}
      className="border-border bg-muted text-foreground"
    />
  );
}
