"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Users,
  Crown,
  ShieldCheck,
  UserPlus,
  UserMinus,
  ShieldPlus,
  ShieldMinus,
  Link as LinkIcon,
  Copy,
  Check,
  LogOut,
  Pencil,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactPicker } from "../contact-picker";
import type { Contact } from "@/types";

interface GroupParticipant {
  id: string;
  phoneNumber?: string;
  admin?: "admin" | "superadmin" | null;
  name?: string | null;
  imgUrl?: string | null;
}

interface GroupInfoResponse {
  info: {
    id: string;
    subject: string;
    creation: number;
    owner: string;
    size?: number;
    pictureUrl?: string | null;
    description?: string | null;
  };
  participants: GroupParticipant[];
}

interface GroupInfoSectionProps {
  contact: Contact;
}

async function postGroupAction(contactId: string, body: Record<string, unknown>) {
  const res = await fetch("/api/whatsapp/evolution-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Action failed");
  return json;
}

export function GroupInfoSection({ contact }: GroupInfoSectionProps) {
  const t = useTranslations("Inbox.sidebar.groupInfo");
  const { canSendMessages, canEditSettings } = useAuth();

  const [data, setData] = useState<GroupInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subjectEditing, setSubjectEditing] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [savingSubject, setSavingSubject] = useState(false);

  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

  const [pictureEditing, setPictureEditing] = useState(false);
  const [pictureDraft, setPictureDraft] = useState("");
  const [savingPicture, setSavingPicture] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [participantBusyId, setParticipantBusyId] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/evolution-group?contactId=${contact.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("loadFailed"));
      setData(json as GroupInfoResponse);
      setSubjectDraft(json.info?.subject ?? "");
      setDescDraft(json.info?.description ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const handleSaveSubject = useCallback(async () => {
    if (!subjectDraft.trim()) return;
    setSavingSubject(true);
    try {
      await postGroupAction(contact.id, { action: "updateSubject", subject: subjectDraft.trim() });
      setData((prev) => (prev ? { ...prev, info: { ...prev.info, subject: subjectDraft.trim() } } : prev));
      setSubjectEditing(false);
      toast.success(t("toastSubjectSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastActionFailed"));
    } finally {
      setSavingSubject(false);
    }
  }, [contact.id, subjectDraft, t]);

  const handleSaveDescription = useCallback(async () => {
    setSavingDesc(true);
    try {
      await postGroupAction(contact.id, { action: "updateDescription", description: descDraft });
      setData((prev) => (prev ? { ...prev, info: { ...prev.info, description: descDraft } } : prev));
      setDescEditing(false);
      toast.success(t("toastDescriptionSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastActionFailed"));
    } finally {
      setSavingDesc(false);
    }
  }, [contact.id, descDraft, t]);

  const handleSavePicture = useCallback(async () => {
    if (!pictureDraft.trim()) return;
    setSavingPicture(true);
    try {
      await postGroupAction(contact.id, { action: "updatePicture", image: pictureDraft.trim() });
      setData((prev) => (prev ? { ...prev, info: { ...prev.info, pictureUrl: pictureDraft.trim() } } : prev));
      setPictureEditing(false);
      setPictureDraft("");
      toast.success(t("toastPictureSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastActionFailed"));
    } finally {
      setSavingPicture(false);
    }
  }, [contact.id, pictureDraft, t]);

  const handleAddParticipant = useCallback(async () => {
    const digits = addPhone.replace(/\D/g, "");
    if (!digits) return;
    setAdding(true);
    try {
      await postGroupAction(contact.id, {
        action: "participants",
        participantAction: "add",
        participants: [digits],
      });
      toast.success(t("toastParticipantAdded"));
      setAddOpen(false);
      setAddPhone("");
      await fetchInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastActionFailed"));
    } finally {
      setAdding(false);
    }
  }, [addPhone, contact.id, fetchInfo, t]);

  const handleParticipantAction = useCallback(
    async (participant: GroupParticipant, action: "remove" | "promote" | "demote") => {
      const target = participant.phoneNumber ?? participant.id;
      setParticipantBusyId(participant.id);
      try {
        await postGroupAction(contact.id, {
          action: "participants",
          participantAction: action,
          participants: [target],
        });
        const toastKey =
          action === "remove" ? "toastParticipantRemoved" : action === "promote" ? "toastPromoted" : "toastDemoted";
        toast.success(t(toastKey));
        await fetchInfo();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastActionFailed"));
      } finally {
        setParticipantBusyId(null);
      }
    },
    [contact.id, fetchInfo, t],
  );

  const handleGetInviteLink = useCallback(async () => {
    setInviteLoading(true);
    try {
      const result = await postGroupAction(contact.id, { action: "inviteCode" });
      if (!result.inviteCode) throw new Error(t("toastInviteLinkFailed"));
      setInviteCode(result.inviteCode as string);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastInviteLinkFailed"));
    } finally {
      setInviteLoading(false);
    }
  }, [contact.id, t]);

  const inviteUrl = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null;

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    toast.success(t("linkCopied"));
    setTimeout(() => setInviteCopied(false), 2000);
  }, [inviteUrl, t]);

  const handleLeaveGroup = useCallback(async () => {
    setLeaving(true);
    try {
      const res = await fetch(`/api/whatsapp/evolution-group?contactId=${contact.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("toastLeaveFailed"));
      toast.success(t("toastLeft"));
      setLeaveDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastLeaveFailed"));
    } finally {
      setLeaving(false);
    }
  }, [contact.id, t]);

  if (loading) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground">{t("title")}…</div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        {error ?? t("loadFailed")}
      </div>
    );
  }

  const canEditGroup = canSendMessages;
  const canLeave = canEditSettings;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Users className="h-3 w-3" />
        {t("title")}
      </div>

      {/* Group photo */}
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted">
            {data.info.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.info.pictureUrl} alt="" className="h-16 w-16 object-cover" />
            ) : (
              <Users className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          {canEditGroup && (
            <button
              type="button"
              onClick={() => setPictureEditing(true)}
              title={t("editPicture")}
              className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <ImageIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("participantsCount", { count: data.participants.length || data.info.size || 0 })}
        </p>
      </div>

      {/* Subject */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-muted-foreground">{t("subjectLabel")}</span>
          {canEditGroup && !subjectEditing && (
            <button onClick={() => setSubjectEditing(true)} className="text-muted-foreground hover:text-foreground">
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {subjectEditing ? (
          <div className="space-y-1.5 px-1">
            <Input
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSubjectEditing(false)}>
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSaveSubject}
                disabled={savingSubject || !subjectDraft.trim()}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="px-1 text-sm font-medium text-foreground">{data.info.subject}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-muted-foreground">{t("descriptionLabel")}</span>
          {canEditGroup && !descEditing && (
            <button onClick={() => setDescEditing(true)} className="text-muted-foreground hover:text-foreground">
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
        {descEditing ? (
          <div className="space-y-1.5 px-1">
            <Textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={3}
              className="text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDescEditing(false)}>
                {t("cancel")}
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSaveDescription} disabled={savingDesc}>
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap px-1 text-xs text-muted-foreground">
            {data.info.description || t("noDescription")}
          </p>
        )}
      </div>

      {/* Participants */}
      <Accordion defaultValue={["participants"]}>
        <AccordionItem value="participants" className="border-none">
          <AccordionTrigger className="px-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
            {t("participantsTitle")}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1.5">
              {canEditGroup && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-1.5 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  onClick={() => setAddOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t("addParticipant")}
                </Button>
              )}
              {data.participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card">
                    {p.imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imgUrl} alt="" className="h-7 w-7 object-cover" />
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {(p.name || p.phoneNumber || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {p.name || p.phoneNumber || p.id}
                    </p>
                    {p.admin && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                        {p.admin === "superadmin" ? (
                          <Crown className="h-2.5 w-2.5" />
                        ) : (
                          <ShieldCheck className="h-2.5 w-2.5" />
                        )}
                        {p.admin === "superadmin" ? t("superAdmin") : t("admin")}
                      </span>
                    )}
                  </div>
                  {canEditGroup && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={participantBusyId === p.id}
                        className="rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil className="h-3 w-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {p.admin ? (
                          <DropdownMenuItem onClick={() => handleParticipantAction(p, "demote")}>
                            <ShieldMinus className="mr-2 h-3.5 w-3.5" />
                            {t("demote")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleParticipantAction(p, "promote")}>
                            <ShieldPlus className="mr-2 h-3.5 w-3.5" />
                            {t("promote")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleParticipantAction(p, "remove")}
                        >
                          <UserMinus className="mr-2 h-3.5 w-3.5" />
                          {t("remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Invite link */}
      {canEditGroup && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
            <LinkIcon className="h-3 w-3" />
            {t("inviteLinkTitle")}
          </div>
          {inviteUrl ? (
            <button
              onClick={handleCopyInvite}
              className="flex w-full items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground hover:bg-muted/70"
            >
              <span className="flex-1 truncate text-left">{inviteUrl}</span>
              {inviteCopied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            </button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-1.5 border-border bg-transparent text-muted-foreground hover:bg-muted"
              onClick={handleGetInviteLink}
              disabled={inviteLoading}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              {t("getInviteLink")}
            </Button>
          )}
        </div>
      )}

      {/* Leave group */}
      {canLeave && (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5 border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10"
          onClick={() => setLeaveDialogOpen(true)}
        >
          <LogOut className="h-3.5 w-3.5" />
          {t("leaveGroup")}
        </Button>
      )}

      {/* Picture dialog */}
      <Dialog open={pictureEditing} onOpenChange={setPictureEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editPicture")}</DialogTitle>
          </DialogHeader>
          <Input
            value={pictureDraft}
            onChange={(e) => setPictureDraft(e.target.value)}
            placeholder={t("pictureUrlPlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPictureEditing(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSavePicture} disabled={savingPicture || !pictureDraft.trim()}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add participant dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addParticipant")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <ContactPicker
              onSelect={(c) => setAddPhone((c.phone_normalized || c.phone).replace(/\D/g, ""))}
            />
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              {t("orTypeNumber")}
              <div className="h-px flex-1 bg-border" />
            </div>
            <Input
              value={addPhone}
              onChange={(e) => setAddPhone(e.target.value)}
              placeholder={t("addParticipantPlaceholder")}
            />
            <p className="px-0.5 text-[11px] text-muted-foreground">
              {t("addParticipantFormatHint")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleAddParticipant} disabled={adding || !addPhone.replace(/\D/g, "")}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave group confirm dialog */}
      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveGroupConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("leaveGroupConfirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleLeaveGroup} disabled={leaving}>
              {t("leaveGroup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
