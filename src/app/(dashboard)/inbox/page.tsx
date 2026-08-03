"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
  applyInboxFilters,
  type InboxTypeFilter,
  type InboxAssignmentFilter,
} from "@/lib/inbox/conversations";
import { releaseMyLeads, redistributeQueue } from "@/lib/inbox/bulk-actions";
import {
  compareByBoardColumnSort,
  type ReminderLookupEntry,
} from "@/lib/inbox/board-column-sort";
import type {
  Conversation,
  Message,
  Contact,
  ConversationStatus,
  BoardColumn,
  Tag,
  Profile,
} from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { useAuth } from "@/hooks/use-auth";
import { ConversationList } from "@/components/inbox/conversation-list";
import { InboxFilterBar } from "@/components/inbox/inbox-filter-bar";
import { ScheduledMessagesPanel } from "@/components/inbox/scheduled-messages-panel";
import { ConversationBoard, type ConversationBoardColumn } from "@/components/inbox/conversation-board";
import { BoardColumnSettings } from "@/components/inbox/board-column-settings";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useResizablePanelWidth } from "@/hooks/use-resizable-panel-width";
import { toast } from "sonner";
import { WifiOff, List, Kanban as KanbanIcon, ChevronDown, Settings, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";
// Remembers the agent's List/Kanban choice. Kanban shows its own,
// independent set of columns (conversation_board_columns, migration
// 057) — fully decoupled from pipelines/deals since the 2026-08-03
// pivot; `conversations.status` is still readable/writable via the
// thread header's status dropdown regardless of view.
const VIEW_MODE_STORAGE_KEY = "wacrm:inbox:view-mode";
// Remembers the agent's drag-resized width for the Kanban thread panel.
const KANBAN_THREAD_WIDTH_STORAGE_KEY = "wacrm:inbox:kanban-thread-width";

type InboxViewMode = "list" | "kanban";

// `useSearchParams` (the `?c=<id>` deep link below) requires a Suspense
// boundary or the production build bails to CSR and errors out. Thin
// wrapper supplies it; the inner component holds all the inbox state.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const t = useTranslations("Inbox.page");
  const tBoard = useTranslations("Inbox.board");
  const tList = useTranslations("Inbox.conversationList");
  const { user, accountId, canSendMessages, canManageMembers } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  // Which provider 1:1 sends currently route through — drives whether
  // the 24h session-window rule (Meta-only, see message-thread.tsx) is
  // shown/enforced at all. `null` until the fetch resolves; `undefined`
  // is never passed in, MessageThread's own default only matters for
  // callers that omit the prop entirely.
  const [activeProvider, setActiveProvider] = useState<
    "meta_cloud" | "evolution" | null
  >(null);
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error("Failed to hydrate conversation:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c,
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      // Provider-agnostic: the banner just needs to know "is *something*
      // connected" — an account can now have up to two rows (one per
      // provider, migration 048), so fetch all and check any of them
      // rather than `.maybeSingle()`, which throws on 2+ rows.
      const { data } = await supabase
        .from("whatsapp_config")
        .select("status")
        .eq("account_id", accountId);

      setWhatsappConnected(
        (data ?? []).some((row) => row.status === "connected")
      );
    };

    checkConnection();
  }, []);

  // Fetch once on mount, same lifecycle as the connection check above —
  // doesn't change per conversation, so no need to refetch on selection.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/whatsapp/active-provider");
        const data = await res.json();
        setActiveProvider(data.provider ?? null);
      } catch (err) {
        console.error("[inbox] active-provider fetch failed:", err);
      }
    })();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            // Replace optimistic message if it exists
            const withoutOptimistic = prev.filter(
              (m) => !m.id.startsWith("temp-")
            );
            return [...withoutOptimistic, newMsg];
          });
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c,
            ),
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Update message status
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? { ...m, ...newMsg } : m))
        );
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === "INSERT") {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === "UPDATE") {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  // Ambient resync triggers (reconnect, visibility) are debounced through
  // this ref rather than calling `setResyncToken` directly — a flaky
  // connection or someone alt-tabbing repeatedly could otherwise fire a
  // burst of bumps in quick succession, each one re-rendering the
  // conversation list (reorder by last_message_at) and the open thread
  // at the same time, which reads as the UI randomly jumping away from
  // whatever the agent was looking at. Coalescing bursts into one bump
  // ~1.2s after the last trigger keeps the same catch-up behavior
  // without the visible churn. The manual refresh button bypasses this —
  // an explicit click should resync immediately, not after a delay.
  const resyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpResyncTokenDebounced = useCallback(() => {
    if (resyncDebounceRef.current) clearTimeout(resyncDebounceRef.current);
    resyncDebounceRef.current = setTimeout(() => {
      resyncDebounceRef.current = null;
      setResyncToken((n) => n + 1);
    }, 1200);
  }, []);
  useEffect(() => {
    return () => {
      if (resyncDebounceRef.current) clearTimeout(resyncDebounceRef.current);
    };
  }, []);

  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        bumpResyncTokenDebounced();
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected, bumpResyncTokenDebounced]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        bumpResyncTokenDebounced();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bumpResyncTokenDebounced]);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      // Resolve a pending deep-link here rather than in an effect — this
      // is an event handler, so the setState calls below are allowed by
      // react-hooks/set-state-in-effect. Runs once per ?c=<id> URL value
      // via the ref, so realtime refreshes of the list can't snap the
      // user back to the deep-linked thread after they've navigated.
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        autoSelectedForDeepLinkRef.current = deepLinkConvId;
        // If the deep-linked conversation is already the active one
        // (e.g. because the user clicked it in the list and we
        // router.replace()'d the URL, which made the ConversationList
        // refetch and land us back here), do NOT re-apply it. Doing so
        // would setMessages([]) on a thread whose messages have
        // already been loaded by MessageThread — and because
        // conversationId didn't change, MessageThread wouldn't
        // refetch. The thread would read "No messages yet" until a
        // full page reload rehydrated state from scratch.
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
          // Mirror the optimistic unread reset that handleSelectConversation
          // does — the user just deep-linked into this conv, treat that the
          // same as a click. Leaves activeConversation.unread_count alone so
          // the MessageThread reset effect still fires the server UPDATE.
          if (match.unread_count > 0) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === match.id ? { ...c, unread_count: 0 } : c,
              ),
            );
          }
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      // Re-clicking the already-active conversation would clear the
      // messages array, but the fetch effect in MessageThread only re-runs
      // when conversationId changes — so messages would stay empty until
      // the user navigated away and back. Bail out early instead.
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      // Optimistically clear the unread badge for this conv. The
      // server-side reset is fired by the unread-reset effect inside
      // MessageThread (which reads activeConversation.unread_count, not
      // the list copy — so we deliberately leave that intact below to
      // keep the effect firing), and the realtime UPDATE that comes
      // back will sync to 0 again as a no-op. Zeroing the list copy
      // here means the user sees the badge disappear the instant they
      // click instead of waiting for the round-trip — and it persists
      // even if the realtime UPDATE is dropped.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id && c.unread_count > 0
            ? { ...c, unread_count: 0 }
            : c,
        ),
      );
      // Record the selection on the deep-link ref BEFORE we change the
      // URL. The router.replace below flips `deepLinkConvId`, which can
      // in turn cause ConversationList to refetch and eventually call
      // handleConversationsLoaded again. Without this line, the ref
      // still points at the previous value, the auto-select block
      // sees `ref !== deepLinkConvId`, fires a second time, and
      // clobbers the messages MessageThread just fetched.
      autoSelectedForDeepLinkRef.current = conv.id;
      // Reflect the selection in the URL so a refresh lands the user
      // back in the same thread, and so copy-paste links work. Use
      // replace() to avoid polluting browser history with every click.
      router.replace(`/inbox?c=${conv.id}`, { scroll: false });
    },
    [activeConversation?.id, router]
  );

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setActiveContact(null);
    setMessages([]);
    // Clearing the ref lets the deep-link auto-selector fire again if
    // the user later visits /inbox?c=<same-id> — desirable UX.
    autoSelectedForDeepLinkRef.current = null;
    router.replace("/inbox", { scroll: false });
  }, [router]);


  const handleConversationDeleted = useCallback(
    (conversationId: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      handleCloseConversation();
    },
    [handleCloseConversation],
  );

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  // Account members, for the conversation-list/board context menu's
  // "Atribuir agente" submenu. Fetched once here (not per row) and
  // shared by both ConversationList and ConversationBoard — mirrors the
  // profiles fetch in MessageThread (RLS-bounded to the caller's account).
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Generic optimistic patch applier for the context menu's pin/favorite/
  // mark-unread/archive/assign actions — the menu itself does the Supabase
  // write + revert-on-error; this just mirrors the result into local state,
  // same shape as handleStatusChange/handleAssignChange above.
  const handleConversationChanged = useCallback(
    (conversationId: string, patch: Partial<Conversation>) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev ? { ...prev, ...patch } : prev));
      }
    },
    [activeConversation]
  );

  // Same-column drag reorder (Kanban) — `newPosition` is already the
  // fractional kanban_position computed by ConversationBoard from the
  // drop's new neighbors (migration 056).
  const handleConversationReordered = useCallback(
    (conversationId: string, newPosition: number) => {
      handleConversationChanged(conversationId, { kanban_position: newPosition });
      const supabase = createClient();
      supabase
        .from("conversations")
        .update({ kanban_position: newPosition })
        .eq("id", conversationId)
        .then(({ error }) => {
          if (error) {
            console.error("Failed to persist kanban_position:", error);
            toast.error(tBoard("toastFailedReorder"));
          }
        });
    },
    [handleConversationChanged, tBoard],
  );

  // Kanban bulk-select — cleared whenever the visible board changes
  // underneath it (pipeline switch, leaving Kanban) so it never holds
  // ids that aren't on screen anymore.
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(
    new Set(),
  );
  const handleToggleSelectConversation = useCallback((conversationId: string) => {
    setSelectedConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  }, []);
  const clearConversationSelection = useCallback(() => {
    setSelectedConversationIds(new Set());
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Kanban view: List/Kanban toggle + (in Kanban) group-by-status vs
  // group-by-pipeline-stage. Restored from localStorage after mount for
  // the same hydration-safety reason as contactPanelOpen above.
  // ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<InboxViewMode>("list");
  useEffect(() => {
    try {
      const storedView = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (storedView === "list" || storedView === "kanban") setViewMode(storedView);
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleViewModeChange = useCallback((mode: InboxViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Shared Inbox filters (search, type, assignment, tags, company) —
  // lifted here (2026-08-03) so the same criteria apply to both the
  // List and the Kanban board, instead of being List-only.
  // ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<InboxTypeFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<InboxAssignmentFilter>("all");
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [releasingLeads, setReleasingLeads] = useState(false);
  const [redistributing, setRedistributing] = useState(false);

  // Tag definitions for the filter picker — loaded once so labels stay
  // stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Next due reminder per conversation (any/manual/automated) — feeds
  // BOTH the "Lembretes e follow-ups" filters below and the Kanban's
  // reminder-based column sort modes (board-column-sort.ts), so it's
  // fetched once here rather than twice.
  const [reminderLookup, setReminderLookup] = useState<Map<string, ReminderLookupEntry>>(
    new Map(),
  );
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("contact_reminders")
        .select("conversation_id, due_at, source")
        .eq("account_id", accountId)
        .is("completed_at", null)
        .not("conversation_id", "is", null);
      if (cancelled || !data) return;
      const map = new Map<string, ReminderLookupEntry>();
      for (const row of data as { conversation_id: string; due_at: string; source: string }[]) {
        const entry = map.get(row.conversation_id) ?? {
          nextManualDueAt: null,
          nextAutomatedDueAt: null,
        };
        if (row.source === "automated") {
          if (!entry.nextAutomatedDueAt || row.due_at < entry.nextAutomatedDueAt) {
            entry.nextAutomatedDueAt = row.due_at;
          }
        } else if (!entry.nextManualDueAt || row.due_at < entry.nextManualDueAt) {
          entry.nextManualDueAt = row.due_at;
        }
        map.set(row.conversation_id, entry);
      }
      setReminderLookup(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, resyncToken]);

  const manualReminderConvIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, entry] of reminderLookup) if (entry.nextManualDueAt) set.add(id);
    return set;
  }, [reminderLookup]);
  const automatedReminderConvIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, entry] of reminderLookup) if (entry.nextAutomatedDueAt) set.add(id);
    return set;
  }, [reminderLookup]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      if (c.is_archived) continue;
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const unassignedCount = useMemo(
    () => conversations.filter((c) => !c.is_archived && !c.assigned_agent_id).length,
    [conversations],
  );

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }, []);
  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const handleReleaseMyLeads = useCallback(async () => {
    if (!accountId || !user?.id || releasingLeads) return;
    setReleasingLeads(true);
    const supabase = createClient();
    const { data, error } = await releaseMyLeads(supabase, accountId, user.id);
    setReleasingLeads(false);
    if (error) {
      toast.error(t("toastReleaseFailed"));
      return;
    }
    toast.success(t("toastReleasedCount", { count: data?.length ?? 0 }));
    setResyncToken((n) => n + 1);
  }, [accountId, user, releasingLeads, t]);

  const handleRedistributeQueue = useCallback(async () => {
    if (redistributing) return;
    setRedistributing(true);
    const supabase = createClient();
    const { data, error } = await redistributeQueue(supabase);
    setRedistributing(false);
    if (error) {
      toast.error(t("toastRedistributeFailed"));
      return;
    }
    toast.success(t("toastRedistributedCount", { count: (data as number) ?? 0 }));
    setResyncToken((n) => n + 1);
  }, [redistributing, t]);

  const filteredConversations = useMemo(
    () =>
      applyInboxFilters(conversations, {
        typeFilter,
        assignmentFilter,
        currentUserId: user?.id,
        search,
        tagIds: selectedTagIds,
        company: selectedCompany,
        manualReminderConvIds,
        automatedReminderConvIds,
      }),
    [
      conversations,
      typeFilter,
      assignmentFilter,
      user?.id,
      search,
      selectedTagIds,
      selectedCompany,
      manualReminderConvIds,
      automatedReminderConvIds,
    ],
  );

  // ─────────────────────────────────────────────────────────────
  // Kanban board columns (conversation_board_columns, migration 057) —
  // independent of pipelines/deals; only needed for the Kanban view,
  // so loaded lazily.
  // ─────────────────────────────────────────────────────────────
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [boardColumnSettingsOpen, setBoardColumnSettingsOpen] = useState(false);
  const [columnsRefetchToken, setColumnsRefetchToken] = useState(0);

  useEffect(() => {
    if (viewMode !== "kanban" || !accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("conversation_board_columns")
        .select("*")
        .eq("account_id", accountId)
        .order("position");
      if (cancelled) return;
      setBoardColumns((data as BoardColumn[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, accountId, columnsRefetchToken]);

  const conversationsByBoardColumn = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const col of boardColumns) map.set(col.id, []);
    const fallbackLeadsId = boardColumns.find((c) => c.is_default_for_leads)?.id;
    const columnsById = new Map(boardColumns.map((c) => [c.id, c]));

    for (const conv of filteredConversations) {
      const columnId =
        conv.board_column_id && map.has(conv.board_column_id) ? conv.board_column_id : fallbackLeadsId;
      if (columnId) map.get(columnId)?.push(conv);
    }

    for (const [columnId, list] of map) {
      const column = columnsById.get(columnId);
      list.sort(
        compareByBoardColumnSort(
          column?.sort_by ?? "last_message_at",
          column?.sort_direction ?? "desc",
          reminderLookup,
        ),
      );
    }
    return map;
  }, [boardColumns, filteredConversations, reminderLookup]);

  const boardColumnsForBoard: ConversationBoardColumn[] = useMemo(
    () =>
      boardColumns.map((c) => ({
        id: c.id,
        title: c.name,
        color: c.color,
        sortBy: c.sort_by,
        sortDirection: c.sort_direction,
      })),
    [boardColumns],
  );

  // Free drag everywhere — columns are pure organizational buckets now
  // (no linked deal/pipeline state), so unlike the old deal-based
  // board there's no "reject this drop" case left to handle here.
  const handleBoardColumnMove = useCallback(
    (conversationId: string, _fromColumnId: string, toColumnId: string) => {
      handleConversationChanged(conversationId, { board_column_id: toColumnId });
      const supabase = createClient();
      supabase
        .from("conversations")
        .update({ board_column_id: toColumnId })
        .eq("id", conversationId)
        .then(({ error }) => {
          if (error) {
            console.error("Failed to move conversation to column:", error);
            toast.error(tBoard("toastFailedMoveColumn"));
          }
        });
    },
    [handleConversationChanged, tBoard],
  );

  const handleBulkMoveSelected = useCallback(
    (targetColumnId: string) => {
      const ids = Array.from(selectedConversationIds);
      for (const id of ids) handleConversationChanged(id, { board_column_id: targetColumnId });
      const supabase = createClient();
      supabase
        .from("conversations")
        .update({ board_column_id: targetColumnId })
        .in("id", ids)
        .then(({ error }) => {
          if (error) {
            console.error("Failed to bulk-move conversations:", error);
            toast.error(tBoard("toastFailedMoveColumn"));
          }
        });
      clearConversationSelection();
    },
    [selectedConversationIds, handleConversationChanged, clearConversationSelection, tBoard],
  );

  const handleColumnReorder = useCallback(
    (orderedColumnIds: string[]) => {
      setBoardColumns((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        return orderedColumnIds
          .map((id, i) => {
            const col = byId.get(id);
            return col ? { ...col, position: i } : null;
          })
          .filter((c): c is BoardColumn => c !== null);
      });
      const supabase = createClient();
      const rows = orderedColumnIds.map((id, i) => ({ id, position: i }));
      supabase
        .from("conversation_board_columns")
        .upsert(rows, { onConflict: "id" })
        .then(({ error }) => {
          if (error) {
            console.error("Failed to persist column order:", error);
            toast.error(tBoard("toastFailedSaveColumnOrder"));
          }
        });
    },
    [tBoard],
  );

  const handleColumnSortChange = useCallback(
    (columnId: string, sortBy: BoardColumn["sort_by"], sortDirection: "asc" | "desc") => {
      setBoardColumns((prev) =>
        prev.map((c) => (c.id === columnId ? { ...c, sort_by: sortBy, sort_direction: sortDirection } : c)),
      );
      const supabase = createClient();
      supabase
        .from("conversation_board_columns")
        .update({ sort_by: sortBy, sort_direction: sortDirection })
        .eq("id", columnId)
        .then(({ error }) => {
          if (error) {
            console.error("Failed to save column sort:", error);
            toast.error(tBoard("toastFailedSaveSort"));
          }
        });
    },
    [tBoard],
  );

  // Selection shouldn't survive a change to what's actually on
  // screen — leaving Kanban swaps out the board's contents entirely.
  useEffect(() => {
    clearConversationSelection();
  }, [viewMode, clearConversationSelection]);

  // Card click opens the conversation in a side drawer over the Kanban
  // instead of switching away to the List/thread layout — the agent
  // replies without losing their place on the board (LeilãoDesk spec).
  const [kanbanThreadOpen, setKanbanThreadOpen] = useState(false);
  // Resizable by dragging the panel's left edge — floor rises when the
  // contact panel (below) is also open, so the thread itself never gets
  // crushed under the sidebar's fixed 384px width.
  const {
    width: kanbanSheetWidth,
    isDragging: kanbanSheetResizing,
    handleProps: kanbanSheetResizeHandleProps,
  } = useResizablePanelWidth({
    defaultWidth: 880,
    minWidth: contactPanelOpen ? 820 : 480,
    storageKey: KANBAN_THREAD_WIDTH_STORAGE_KEY,
  });
  const handleBoardCardSelect = useCallback(
    (conv: Conversation) => {
      handleSelectConversation(conv);
      setKanbanThreadOpen(true);
    },
    [handleSelectConversation],
  );

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side. Selecting a
  // conversation slides the thread in; the thread's back button pops
  // it back to the list. On lg+ both panes render side-by-side as
  // before, unchanged.
  const hasActiveConv = !!activeConversation;

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden sm:-m-6">
      {/* WhatsApp connection banner — in the flex column, not absolute,
          so it pushes the panels down instead of overlapping them. */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("whatsappNotConnected")}
          </p>
        </div>
      )}

      {/* List/Kanban toggle + search, in one row to save vertical space
          (2026-08-03) — kept separate from ConversationList because
          Kanban replaces the whole three-pane layout below, not just
          the list column. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => handleViewModeChange("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                viewMode === "list"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
              {tBoard("viewList")}
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("kanban")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                viewMode === "kanban"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <KanbanIcon className="h-3.5 w-3.5" />
              {tBoard("viewKanban")}
            </button>
          </div>

          <div className="relative min-w-0 max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tList("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>
          <ScheduledMessagesPanel />
        </div>

        {viewMode === "kanban" && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setBoardColumnSettingsOpen(true)}
              title={tBoard("manageColumns")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              <Settings className="h-3.5 w-3.5" />
              {tBoard("manageColumns")}
            </button>
          </div>
        )}
      </div>

      {/* Type/assignment/tag/company filters — shared between List and
          Kanban (2026-08-03), so switching views keeps the same
          criteria instead of Kanban seeing everything unfiltered. */}
      <InboxFilterBar
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        assignmentFilter={assignmentFilter}
        onAssignmentFilterChange={setAssignmentFilter}
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={toggleTag}
        companies={companies}
        selectedCompany={selectedCompany}
        onSelectCompany={setSelectedCompany}
        onClearContactFilters={clearContactFilters}
        unassignedCount={unassignedCount}
        canSendMessages={canSendMessages}
        canManageMembers={canManageMembers}
        releasingLeads={releasingLeads}
        redistributing={redistributing}
        onReleaseMyLeads={handleReleaseMyLeads}
        onRedistributeQueue={handleRedistributeQueue}
      />

      {accountId && (
        <BoardColumnSettings
          open={boardColumnSettingsOpen}
          onOpenChange={setBoardColumnSettingsOpen}
          accountId={accountId}
          columns={boardColumns}
          onColumnsChanged={() => setColumnsRefetchToken((n) => n + 1)}
        />
      )}

      {viewMode === "kanban" ? (
        <div className="flex flex-1 flex-col overflow-hidden p-3">
          {selectedConversationIds.size > 0 && (
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {tBoard("selectedCount", { count: selectedConversationIds.size })}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted data-[popup-open]:bg-muted">
                  {tBoard("moveSelectedTo")}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-border bg-popover">
                  {boardColumnsForBoard.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      onClick={() => handleBulkMoveSelected(col.id)}
                      className="text-popover-foreground"
                    >
                      {col.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={clearConversationSelection}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                {tBoard("clearSelection")}
              </button>
            </div>
          )}
          {boardColumns.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {tBoard("loadingColumns")}
            </div>
          ) : (
            <ConversationBoard
              columns={boardColumnsForBoard}
              conversationsByColumn={conversationsByBoardColumn}
              onSelect={handleBoardCardSelect}
              onMove={handleBoardColumnMove}
              onReorder={handleConversationReordered}
              onColumnReorder={handleColumnReorder}
              onColumnSortChange={handleColumnSortChange}
              emptyColumnHint={tBoard("dropConversationHere")}
              profiles={profiles}
              onConversationChanged={handleConversationChanged}
              selectedIds={selectedConversationIds}
              onToggleSelect={handleToggleSelectConversation}
            />
          )}
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list.
            Hidden on mobile when a conversation is selected so the
            thread can occupy the full width. Always visible on lg+. */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={filteredConversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
            profiles={profiles}
            onConversationChanged={handleConversationChanged}
          />
        </div>

        {/* Center panel: Message thread.
            Hidden on mobile when no conversation is selected so the
            list can occupy the full width. Always visible on lg+
            (shows its own empty-state if no thread is picked yet).

            `min-w-0` is load-bearing: without it, a single wide piece
            of content inside the thread (long quote preview, very
            long URL in a message body) forces the flex child past
            its share and pushes the contact-sidebar panel off-screen
            on the right. Issue #165. */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
            activeProvider={activeProvider}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only, and only when the
            agent hasn't collapsed it via the thread-header toggle (#258).
            On mobile it's always hidden (the `lg:block` below), so the
            toggle — which is itself desktop-only — never affects it. */}
        {contactPanelOpen && (
          <div className="hidden h-full lg:flex">
            <ContactSidebar
              contact={activeContact}
              conversation={activeConversation}
              onConversationDeleted={handleConversationDeleted}
            />
          </div>
        )}
      </div>
      )}

      {/* Kanban card click opens the thread here instead of switching to
          the List layout — the board stays exactly where the agent left
          it underneath. Resizable (drag the left edge) and mirrors the
          full-page layout's contact-panel toggle for parity — same
          `contactPanelOpen` state/preference, one agent, one browser. */}
      <Sheet open={kanbanThreadOpen} onOpenChange={setKanbanThreadOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 p-0"
          style={{ width: kanbanSheetWidth, maxWidth: "95vw" }}
        >
          {/* Resize handle — hidden below sm: the panel is edge-to-edge
              on mobile, where dragging makes no sense. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resizeThreadPanel")}
            tabIndex={0}
            className="group absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none select-none outline-none sm:block"
            {...kanbanSheetResizeHandleProps}
          >
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary",
                kanbanSheetResizing && "bg-primary",
              )}
            />
          </div>
          {activeConversation && (
            <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <MessageThread
                  conversation={activeConversation}
                  contact={activeContact}
                  messages={messages}
                  onMessagesLoaded={handleMessagesLoaded}
                  onNewMessage={handleNewMessage}
                  onUpdateMessage={handleUpdateMessage}
                  onStatusChange={handleStatusChange}
                  onAssignChange={handleAssignChange}
                  onBack={() => setKanbanThreadOpen(false)}
                  resyncToken={resyncToken}
                  onRefresh={handleManualRefresh}
                  contactPanelOpen={contactPanelOpen}
                  onToggleContactPanel={handleToggleContactPanel}
                  activeProvider={activeProvider}
                />
              </div>
              {contactPanelOpen && (
                <div className="hidden h-full lg:flex">
                  <ContactSidebar
                    contact={activeContact}
                    conversation={activeConversation}
                    onConversationDeleted={handleConversationDeleted}
                  />
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
