"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type {
  Conversation,
  Message,
  Contact,
  ConversationStatus,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ConversationBoard, type ConversationBoardColumn } from "@/components/inbox/conversation-board";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { moveDealToStage } from "@/lib/deals/move-deal";
import { toast } from "sonner";
import { WifiOff, List, Kanban as KanbanIcon, ChevronDown, GitBranch, Settings } from "lucide-react";
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
// Remembers the agent's List/Kanban choice. Kanban always groups by
// pipeline stage — a status-grouped view existed previously but was
// removed (LeilãoDesk spec, 2026-08-03): pipeline is the single
// organizing axis now, and `conversations.status` is still readable/
// writable via the thread header's status dropdown.
const VIEW_MODE_STORAGE_KEY = "wacrm:inbox:view-mode";
const NO_PIPELINE_COLUMN_ID = "__no_pipeline__";

type InboxViewMode = "list" | "kanban";

/** Lean shape for the pipeline-grouping board — avoids the full `Deal`
 *  select (contact/assignee joins) the Pipelines page needs. */
interface PipelineDealLite {
  id: string;
  contact_id: string | null;
  stage_id: string;
}

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

  // Pipeline data is only needed for the Kanban board, so it's loaded
  // lazily rather than unconditionally on every inbox visit.
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [pipelineDeals, setPipelineDeals] = useState<PipelineDealLite[]>([]);
  // "Configurar colunas" gear next to the pipeline picker (kanban-in-inbox,
  // Área 4 of the feature plan) — reuses PipelineSettings verbatim, the
  // same dialog the Pipelines page opens, so column CRUD stays a single
  // implementation. Bumping stagesRefetchToken forces the stages/deals
  // effect below to refire after a save even when selectedPipelineId
  // itself hasn't changed.
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
  const [stagesRefetchToken, setStagesRefetchToken] = useState(0);

  const refetchPipelines = useCallback(() => {
    const supabase = createClient();
    supabase
      .from("pipelines")
      .select("*")
      .order("created_at")
      .then(({ data }) => {
        const list = (data as Pipeline[]) ?? [];
        setPipelines(list);
        setSelectedPipelineId((prev) =>
          list.some((p) => p.id === prev) ? prev : list[0]?.id || "",
        );
      });
  }, []);

  useEffect(() => {
    if (viewMode !== "kanban" || pipelines.length > 0) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("pipelines").select("*").order("created_at");
      if (cancelled) return;
      const list = (data as Pipeline[]) ?? [];
      setPipelines(list);
      setSelectedPipelineId((prev) => prev || list[0]?.id || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, pipelines.length]);

  useEffect(() => {
    if (viewMode !== "kanban" || !selectedPipelineId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [stagesRes, dealsRes] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select("*")
          .eq("pipeline_id", selectedPipelineId)
          .order("position"),
        // Sorted newest-first so the "most recently updated deal wins"
        // per-contact reduction below is a simple first-write-wins pass.
        supabase
          .from("deals")
          .select("id, contact_id, stage_id")
          .eq("pipeline_id", selectedPipelineId)
          .order("updated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setPipelineStages((stagesRes.data as PipelineStage[]) ?? []);
      setPipelineDeals((dealsRes.data as PipelineDealLite[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, selectedPipelineId, stagesRefetchToken]);

  // A contact can have more than one deal in the same pipeline (repeat
  // customer); we bucket the conversation under the most-recently-updated
  // one. `pipelineDeals` is fetched newest-first, so first-seen wins.
  const bestDealByContactId = useMemo(() => {
    const map = new Map<string, PipelineDealLite>();
    for (const deal of pipelineDeals) {
      if (!deal.contact_id) continue;
      if (!map.has(deal.contact_id)) map.set(deal.contact_id, deal);
    }
    return map;
  }, [pipelineDeals]);

  const pipelineColumns: ConversationBoardColumn[] = useMemo(() => {
    const sorted = [...pipelineStages].sort((a, b) => a.position - b.position);
    return [
      ...sorted.map((s) => ({ id: s.id, title: s.name, color: s.color })),
      { id: NO_PIPELINE_COLUMN_ID, title: tBoard("noPipeline") },
    ];
  }, [pipelineStages, tBoard]);

  const conversationsByPipelineColumn = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const col of pipelineColumns) map.set(col.id, []);
    for (const conv of conversations) {
      const deal = bestDealByContactId.get(conv.contact_id);
      const columnId = deal && map.has(deal.stage_id) ? deal.stage_id : NO_PIPELINE_COLUMN_ID;
      map.get(columnId)?.push(conv);
    }
    return map;
  }, [pipelineColumns, conversations, bestDealByContactId]);

  const getPipelineDragHint = useCallback(
    (conv: Conversation) =>
      bestDealByContactId.has(conv.contact_id) ? undefined : tBoard("noDealToMoveHint"),
    [bestDealByContactId, tBoard],
  );

  // The card represents a conversation, but the move mutates the linked
  // deal's `stage_id` — same write path (and same shared helper) the
  // Pipelines board itself uses, so moving a deal via either board stays
  // consistent.
  const handleConversationDealMoved = useCallback(
    async (conversationId: string, newStageId: string) => {
      // "Sem Pipeline"/no-deal-in-this-pipeline isn't a real stage — a
      // card sits there because the contact has no deal in the
      // currently-selected pipeline, not because a deal was moved to a
      // "no stage" state. Dropping a card here used to be a silent
      // no-op (the card just snapped back with no explanation); tell
      // the agent why instead.
      if (newStageId === NO_PIPELINE_COLUMN_ID) {
        toast.error(tBoard("toastCannotMoveToNoPipeline"));
        return;
      }
      const conv = conversations.find((c) => c.id === conversationId);
      const deal = conv ? bestDealByContactId.get(conv.contact_id) : undefined;
      if (!deal) return;

      const previousStageId = deal.stage_id;
      setPipelineDeals((prev) =>
        prev.map((d) => (d.id === deal.id ? { ...d, stage_id: newStageId } : d)),
      );

      const supabase = createClient();
      const { error } = await moveDealToStage(supabase, deal.id, newStageId);
      if (error) {
        toast.error(tBoard("toastFailedMoveDeal"));
        setPipelineDeals((prev) =>
          prev.map((d) => (d.id === deal.id ? { ...d, stage_id: previousStageId } : d)),
        );
      }
    },
    [conversations, bestDealByContactId, tBoard],
  );

  const handleBoardMove = useCallback(
    (conversationId: string, _fromColumnId: string, toColumnId: string) => {
      handleConversationDealMoved(conversationId, toColumnId);
    },
    [handleConversationDealMoved],
  );

  // Kanban is a triage view, not a second place to read the thread — a
  // card click hands off to the list/thread layout with that conversation
  // selected, rather than growing a fourth pane.
  const handleBoardCardSelect = useCallback(
    (conv: Conversation) => {
      handleViewModeChange("list");
      handleSelectConversation(conv);
    },
    [handleViewModeChange, handleSelectConversation],
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

      {/* List/Kanban toggle, plus the Kanban-only group-by + pipeline
          picker. Kept as its own toolbar row (not inside ConversationList)
          because Kanban replaces the whole three-pane layout below, not
          just the list column. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
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

        {viewMode === "kanban" && (
          <div className="flex items-center gap-2">
            {pipelines.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted data-[popup-open]:bg-muted">
                  <GitBranch className="h-3.5 w-3.5 text-primary" />
                  {pipelines.find((p) => p.id === selectedPipelineId)?.name ??
                    tBoard("selectPipelinePlaceholder")}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-border bg-popover">
                  {pipelines.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => setSelectedPipelineId(p.id)}
                      className={p.id === selectedPipelineId ? "text-primary" : "text-popover-foreground"}
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Configure kanban columns right here, without leaving the Inbox. */}
            <button
              type="button"
              onClick={() => setPipelineSettingsOpen(true)}
              disabled={pipelines.length === 0}
              title={tBoard("configureStages")}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {(() => {
        const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
        if (!selectedPipeline) return null;
        return (
          <PipelineSettings
            open={pipelineSettingsOpen}
            onOpenChange={setPipelineSettingsOpen}
            pipeline={selectedPipeline}
            stages={pipelineStages}
            onPipelinesChanged={refetchPipelines}
            onStagesChanged={() => setStagesRefetchToken((n) => n + 1)}
            onCreateNewPipeline={() => {
              setPipelineSettingsOpen(false);
              router.push("/pipelines");
            }}
          />
        );
      })()}

      {viewMode === "kanban" ? (
        <div className="flex-1 overflow-hidden p-3">
          {pipelines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {tBoard("noPipelinesYet")}
            </div>
          ) : (
            <ConversationBoard
              columns={pipelineColumns}
              conversationsByColumn={conversationsByPipelineColumn}
              onSelect={handleBoardCardSelect}
              onMove={handleBoardMove}
              getDisabledHint={getPipelineDragHint}
              emptyColumnHint={tBoard("dropConversationHere")}
              profiles={profiles}
              onConversationChanged={handleConversationChanged}
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
            conversations={conversations}
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
    </div>
  );
}
