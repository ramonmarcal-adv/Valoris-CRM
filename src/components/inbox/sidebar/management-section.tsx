"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import {
  Bell,
  Calendar,
  CalendarPlus,
  Check,
  History,
  ListChecks,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type {
  Contact,
  Conversation,
  ContactNote,
  ContactReminder,
  ContactAppointment,
  CustomField,
  Deal,
} from "@/types";

interface ManagementSectionProps {
  contact: Contact;
  conversation: Conversation;
}

interface HistoryEvent {
  id: string;
  at: string;
  label: string;
}

export function ManagementSection({ contact, conversation }: ManagementSectionProps) {
  const t = useTranslations("Inbox.sidebar.management");
  const dateLocale = useDateFnsLocale();
  const { user, accountId } = useAuth();

  const [reminders, setReminders] = useState<ContactReminder[]>([]);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);

  const [appointments, setAppointments] = useState<ContactAppointment[]>([]);
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [appointmentTitle, setAppointmentTitle] = useState("");
  const [appointmentStartsAt, setAppointmentStartsAt] = useState("");
  const [savingAppointment, setSavingAppointment] = useState(false);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [remindersRes, appointmentsRes, fieldsRes, valuesRes, notesRes, dealsRes] =
      await Promise.all([
        supabase
          .from("contact_reminders")
          .select("*")
          .eq("contact_id", contact.id)
          .is("completed_at", null)
          .order("due_at", { ascending: true }),
        supabase
          .from("contact_appointments")
          .select("*")
          .eq("contact_id", contact.id)
          .eq("status", "scheduled")
          .order("starts_at", { ascending: true }),
        supabase.from("custom_fields").select("*").order("field_name"),
        supabase.from("contact_custom_values").select("*").eq("contact_id", contact.id),
        supabase
          .from("contact_notes")
          .select("*")
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("deals")
          .select("*")
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
      ]);

    setReminders((remindersRes.data as ContactReminder[]) ?? []);
    setAppointments((appointmentsRes.data as ContactAppointment[]) ?? []);
    setCustomFields((fieldsRes.data as CustomField[]) ?? []);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      for (const v of valuesRes.data as { custom_field_id: string; value: string | null }[]) {
        map[v.custom_field_id] = v.value ?? "";
      }
      setCustomValues(map);
    }
    setNotes((notesRes.data as ContactNote[]) ?? []);
    setDeals((dealsRes.data as Deal[]) ?? []);
  }, [contact.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Histórico — synthesized read-only timeline from notes/reminders/
  // appointments/deals for this contact, sorted newest-first. No dedicated
  // event log yet (see plan Milestone A.2): events like "tag removed" or
  // "status changed" aren't independently timestamped anywhere and are
  // out of scope for this first pass.
  const historyEvents: HistoryEvent[] = useMemo(() => {
    const events: HistoryEvent[] = [];
    for (const n of notes) {
      events.push({ id: `note-${n.id}`, at: n.created_at, label: t("historyNoteAdded") });
    }
    for (const d of deals) {
      events.push({
        id: `deal-${d.id}`,
        at: d.created_at,
        label: t("historyDealCreated", { title: d.title }),
      });
    }
    for (const r of reminders) {
      events.push({
        id: `reminder-${r.id}`,
        at: r.created_at,
        label: t("historyReminderCreated", { title: r.title }),
      });
    }
    for (const a of appointments) {
      events.push({
        id: `appointment-${a.id}`,
        at: a.created_at,
        label: t("historyAppointmentCreated", { title: a.title }),
      });
    }
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20);
  }, [notes, deals, reminders, appointments, t]);

  const handleCreateReminder = useCallback(async () => {
    if (!reminderTitle.trim() || !reminderDueAt || !accountId || !user?.id) return;
    setSavingReminder(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contact_reminders")
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        conversation_id: conversation.id,
        created_by_user_id: user.id,
        title: reminderTitle.trim(),
        due_at: new Date(reminderDueAt).toISOString(),
      })
      .select()
      .single();
    setSavingReminder(false);
    if (error || !data) {
      toast.error(t("toastReminderFailed"));
      return;
    }
    setReminders((prev) =>
      [...prev, data as ContactReminder].sort(
        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
      ),
    );
    setReminderTitle("");
    setReminderDueAt("");
    setReminderDialogOpen(false);
  }, [reminderTitle, reminderDueAt, accountId, user?.id, contact.id, conversation.id, t]);

  const handleCompleteReminder = useCallback(
    async (reminderId: string) => {
      const snapshot = reminders;
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
      const supabase = createClient();
      const { error } = await supabase
        .from("contact_reminders")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", reminderId);
      if (error) {
        toast.error(t("toastReminderFailed"));
        setReminders(snapshot);
      }
    },
    [reminders, t],
  );

  const handleCreateAppointment = useCallback(async () => {
    if (!appointmentTitle.trim() || !appointmentStartsAt || !accountId || !user?.id) return;
    setSavingAppointment(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contact_appointments")
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        conversation_id: conversation.id,
        created_by_user_id: user.id,
        title: appointmentTitle.trim(),
        starts_at: new Date(appointmentStartsAt).toISOString(),
      })
      .select()
      .single();
    setSavingAppointment(false);
    if (error || !data) {
      toast.error(t("toastAppointmentFailed"));
      return;
    }
    setAppointments((prev) =>
      [...prev, data as ContactAppointment].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    );
    setAppointmentTitle("");
    setAppointmentStartsAt("");
    setAppointmentDialogOpen(false);
  }, [appointmentTitle, appointmentStartsAt, accountId, user?.id, contact.id, conversation.id, t]);

  const handleSaveCustomFields = useCallback(async () => {
    setSavingCustom(true);
    const supabase = createClient();
    try {
      await supabase.from("contact_custom_values").delete().eq("contact_id", contact.id);
      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contact.id,
          custom_field_id: fieldId,
          value: val.trim(),
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("contact_custom_values").insert(rows);
        if (error) throw error;
      }
      toast.success(t("toastCustomFieldsSaved"));
    } catch {
      toast.error(t("toastCustomFieldsFailed"));
    }
    setSavingCustom(false);
  }, [contact.id, customValues, t]);

  return (
    <>
    <Accordion defaultValue={["management"]}>
      <AccordionItem value="management" className="border-none">
        <AccordionTrigger className="px-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
          <span className="flex items-center gap-2">
            <ListChecks className="h-3 w-3" />
            {t("title")}
          </span>
        </AccordionTrigger>
        <AccordionContent>
        <div className="space-y-4">

      {/* Lembrete */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <Bell className="h-3 w-3" />
          {t("reminderTitle")}
        </div>
        <div className="mt-1.5 space-y-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-1.5 border-border bg-transparent text-muted-foreground hover:bg-muted"
            onClick={() => setReminderDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("createReminder")}
          </Button>
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{r.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(r.due_at), "MMM d, yyyy HH:mm", { locale: dateLocale })}
                </p>
              </div>
              <button
                onClick={() => handleCompleteReminder(r.id)}
                className="shrink-0 text-muted-foreground hover:text-primary"
                title={t("markComplete")}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Agendamentos */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {t("appointmentsTitle")}
        </div>
        <div className="mt-1.5 space-y-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-1.5 border-border bg-transparent text-muted-foreground hover:bg-muted"
            onClick={() => setAppointmentDialogOpen(true)}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            {t("createAppointment")}
          </Button>
          {appointments.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t("noUpcomingAppointments")}</p>
          ) : (
            appointments.map((a) => (
              <div key={a.id} className="rounded-lg bg-muted px-3 py-2">
                <p className="truncate text-xs font-medium text-foreground">{a.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(a.starts_at), "MMM d, yyyy HH:mm", { locale: dateLocale })}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Histórico */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <History className="h-3 w-3" />
          {t("historyTitle")}
        </div>
        <div className="mt-1.5 space-y-1">
          {historyEvents.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t("noHistory")}</p>
          ) : (
            historyEvents.map((ev) => (
              <div key={ev.id} className="px-1 py-1 text-xs text-muted-foreground">
                <span className="text-foreground">{ev.label}</span>
                <span className="ml-1.5 text-[10px]">
                  {format(new Date(ev.at), "MMM d, HH:mm", { locale: dateLocale })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Campos personalizados */}
      <div>
        <div className="px-1 text-xs font-medium text-muted-foreground">{t("customFieldsTitle")}</div>
        <div className="mt-1.5 space-y-2">
          {customFields.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t("noCustomFields")}</p>
          ) : (
            <>
              {customFields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <Label className="px-1 text-[10px] text-muted-foreground">{field.field_name}</Label>
                  <Input
                    value={customValues[field.id] ?? ""}
                    onChange={(e) =>
                      setCustomValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                    }
                    className="h-8 border-border bg-muted text-xs text-foreground"
                  />
                </div>
              ))}
              <Button
                size="sm"
                className="w-full bg-primary hover:bg-primary/90"
                onClick={handleSaveCustomFields}
                disabled={savingCustom}
              >
                {t("saveCustomFields")}
              </Button>
            </>
          )}
        </div>
      </div>
        </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

      {/* Criar lembrete dialog */}
      <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createReminder")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t("reminderTitleLabel")}</Label>
              <Input value={reminderTitle} onChange={(e) => setReminderTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dueAtLabel")}</Label>
              <Input
                type="datetime-local"
                value={reminderDueAt}
                onChange={(e) => setReminderDueAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreateReminder}
              disabled={!reminderTitle.trim() || !reminderDueAt || savingReminder}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Criar agendamento dialog */}
      <Dialog open={appointmentDialogOpen} onOpenChange={setAppointmentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createAppointment")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t("appointmentTitleLabel")}</Label>
              <Input value={appointmentTitle} onChange={(e) => setAppointmentTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("startsAtLabel")}</Label>
              <Input
                type="datetime-local"
                value={appointmentStartsAt}
                onChange={(e) => setAppointmentStartsAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppointmentDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreateAppointment}
              disabled={!appointmentTitle.trim() || !appointmentStartsAt || savingAppointment}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
