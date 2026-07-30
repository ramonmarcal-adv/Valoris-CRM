"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import { BellOff, Star, StickyNote, Plus, Trash2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { Contact, Conversation, ContactNote, MessageFavorite, Message } from "@/types";

interface CommunicationSectionProps {
  contact: Contact;
  conversation: Conversation;
}

type FavoriteWithMessage = MessageFavorite & { message?: Pick<Message, "content_text" | "content_type"> | null };

export function CommunicationSection({ contact, conversation }: CommunicationSectionProps) {
  const t = useTranslations("Inbox.sidebar.communication");
  const dateLocale = useDateFnsLocale();
  const { user, accountId } = useAuth();

  const [muted, setMuted] = useState(conversation.is_muted);
  const [mutePending, setMutePending] = useState(false);

  const [favorites, setFavorites] = useState<FavoriteWithMessage[]>([]);

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(conversation.is_muted);
  }, [conversation.is_muted]);

  const fetchFavorites = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("message_favorites")
      .select("*, message:messages(content_text, content_type)")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false });
    setFavorites((data as FavoriteWithMessage[]) ?? []);
  }, [conversation.id]);

  const fetchNotes = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_notes")
      .select("*")
      .eq("contact_id", contact.id)
      .eq("is_internal", true)
      .order("created_at", { ascending: false });
    setNotes((data as ContactNote[]) ?? []);
  }, [contact.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFavorites();
    fetchNotes();
  }, [fetchFavorites, fetchNotes]);

  const handleToggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    setMutePending(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update({ is_muted: next })
      .eq("id", conversation.id);
    setMutePending(false);
    if (error) {
      console.error("Failed to toggle mute:", error);
      toast.error(t("toastMuteFailed"));
      setMuted(!next);
    }
  }, [muted, conversation.id, t]);

  const handleRemoveFavorite = useCallback(
    async (favoriteId: string) => {
      const snapshot = favorites;
      setFavorites((prev) => prev.filter((f) => f.id !== favoriteId));
      const supabase = createClient();
      const { error } = await supabase.from("message_favorites").delete().eq("id", favoriteId);
      if (error) {
        toast.error(t("toastUnfavoriteFailed"));
        setFavorites(snapshot);
      }
    },
    [favorites, t],
  );

  const handleAddNote = useCallback(async () => {
    if (!newNote.trim() || !accountId || !user?.id) return;
    setAddingNote(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user.id,
        note_text: newNote.trim(),
        is_internal: true,
      })
      .select()
      .single();
    setAddingNote(false);
    if (error || !data) {
      toast.error(t("toastNoteFailed"));
      return;
    }
    setNotes((prev) => [data as ContactNote, ...prev]);
    setNewNote("");
  }, [newNote, accountId, user, contact, t]);

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      const snapshot = notes;
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      const supabase = createClient();
      const { error } = await supabase.from("contact_notes").delete().eq("id", noteId);
      if (error) {
        toast.error(t("toastNoteDeleteFailed"));
        setNotes(snapshot);
      }
    },
    [notes, t],
  );

  return (
    <Accordion defaultValue={["communication"]}>
      <AccordionItem value="communication" className="border-none">
        <AccordionTrigger className="px-1 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-muted-foreground hover:no-underline">
          <span className="flex items-center gap-2">
            <BellOff className="h-3 w-3" />
            {t("title")}
          </span>
        </AccordionTrigger>
        <AccordionContent>
        <div className="space-y-4">

      {/* Silenciar */}
      <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
        <span className="text-sm text-foreground">{t("mute")}</span>
        <Switch checked={muted} onCheckedChange={handleToggleMute} disabled={mutePending} />
      </div>

      {/* Mensagens favoritas */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <Star className="h-3 w-3" />
          {t("favoritesTitle")}
          {favorites.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px]">{favorites.length}</span>
          )}
        </div>
        <div className="mt-1.5 space-y-1.5">
          {favorites.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t("noFavorites")}</p>
          ) : (
            favorites.map((f) => (
              <div
                key={f.id}
                className="group flex items-start justify-between gap-2 rounded-lg bg-muted px-3 py-2"
              >
                <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
                  {f.message?.content_text || t("nonTextMessage")}
                </p>
                <button
                  onClick={() => handleRemoveFavorite(f.id)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Notas internas */}
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          {t("internalNotesTitle")}
        </div>
        <div className="mt-1.5">
          <div className="flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={t("addInternalNotePlaceholder")}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-auto bg-primary px-2 hover:bg-primary/90"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="group rounded-lg bg-muted px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {note.note_text}
                  </p>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {format(new Date(note.created_at), "MMM d, yyyy HH:mm", { locale: dateLocale })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
        </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
