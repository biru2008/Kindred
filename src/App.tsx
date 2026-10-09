import { InvitationInbox } from "./GroupManagement";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleHelp,
  Copy,
  Edit3,
  Info,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  Shuffle,
  Smile,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import Discover from "./Discover";
import { EmailGate } from "./EmailAuth";
import { PersonaEditor } from "./Personas";
import { api } from "./lib/api";
import { useChatTools } from "./lib/webmcp";
import { demoUser } from "./lib/demo";
import { isConfigured, supabase } from "./lib/supabase";
import type { Conversation, Message, Profile } from "./lib/types";
import { errorText, mergeMessages, titleOf, validMessage } from "./lib/types";
import {
  Auth,
  Avatar,
  Brand,
  Details,
  MessageEditor,
  Modal,
  NewConversation,
  Spinner,
} from "./components";

const time = (s: string) =>
  new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function shortDate(s: string) {
  const date = new Date(s);
  return date.toDateString() === new Date().toDateString()
    ? time(s)
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function dayLabel(s: string) {
  const date = new Date(s);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString()
    ? "Yesterday"
    : date.toLocaleDateString([], {
        weekday: "short",
        month: "long",
        day: "numeric",
      });
}
function readOutbox(userId: string): Message[] {
  try {
    return JSON.parse(
      sessionStorage.getItem(`kindred-outbox:${userId}`) || "[]",
    )
      .filter((m: Message) => m.sender_id === userId && validMessage(m.body))
      .map((m: Message) => ({ ...m, status: "failed" }));
  } catch {
    return [];
  }
}
function getDraft(key: string) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export default function App() {
  const [surface, setSurface] = useState<"messages" | "discover">("messages");
  const [preview, setPreview] = useState(
    () =>
      !isConfigured ||
      new URLSearchParams(location.search).get("preview") === "1",
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(!isConfigured);
  const [recovery, setRecovery] = useState(
    location.hash.includes("type=recovery"),
  );
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setUserId(data.session?.user.id || null);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id || null);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <div className="app-loading">
        <Brand />
        <Spinner />
      </div>
    );
  if (recovery)
    return (
      <Auth
        onPreview={() => setPreview(true)}
        recovery
        onRecovered={() => {
          history.replaceState(null, "", location.pathname);
          setRecovery(false);
        }}
      />
    );
  if (!preview && !userId)
    return (
      <Auth
        onPreview={() => setPreview(true)}
        onRecovered={() => setRecovery(false)}
      />
    );
  const exit = async () => {
    if (preview) {
      setPreview(false);
      setSurface("messages");
      return;
    }
    const { error } = await supabase!.auth.signOut();
    if (error) throw error;
    setUserId(null);
    setSurface("messages");
  };
  const content =
    surface === "discover" ? (
      <Discover
        key={preview ? "preview" : userId}
        preview={preview}
        userId={preview ? demoUser.id : userId!}
        onBack={() => setSurface("messages")}
      />
    ) : (
      <Workspace
        key={preview ? "preview" : userId}
        preview={preview}
        userId={preview ? demoUser.id : userId!}
        onExit={exit}
        onDiscover={() => setSurface("discover")}
      />
    );
  return preview ? (
    content
  ) : (
    <EmailGate key={userId} onExit={exit}>
      {content}
    </EmailGate>
  );
}

function Workspace({
  preview,
  userId,
  onExit,
  onDiscover,
}: {
  preview: boolean;
  userId: string;
  onExit: () => Promise<void>;
  onDiscover: () => void;
}) {
  const service = useMemo(() => api(preview), [preview]);
  const outbox = useRef<Message[]>(readOutbox(userId));
  const saveOutbox = useCallback(() => {
    try {
      sessionStorage.setItem(
        `kindred-outbox:${userId}`,
        JSON.stringify(outbox.current),
      );
    } catch {
      /* Pending messages remain available in this session. */
    }
  }, [userId]);
  const [me, setMe] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "circles">("all");
  const [modal, setModal] = useState<"new" | "profile" | "help" | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState("connecting");
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [present, setPresent] = useState<string[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const lastTyping = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [messageQuery, setMessageQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [jump, setJump] = useState(false);
  const [readTick, setReadTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const initialScroll = useRef(true);
  const nearBottom = useRef(true);
  const requestSeq = useRef(0);
  const refreshSeq = useRef(0);
  const activeConversation = conversations.find((c) => c.id === active);
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const [person, items] = await Promise.all([
        service.profile(),
        service.conversations(),
      ]);
      if (seq !== refreshSeq.current) return;
      setMe(person);
      setConversations(items);
      setLoadError("");
      setActive((current) =>
        current && items.some((c) => c.id === current)
          ? current
          : items[0]?.id || null,
      );
    } catch (e) {
      if (seq === refreshSeq.current) setLoadError(errorText(e));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, [service]);
  const refreshMessages = useCallback(
    async (id: string, _replace = false) => {
      const seq = ++requestSeq.current;
      const earliest = messagesRef.current.find(
        (m) => m.conversation_id === id && !m.status,
      );
      try {
        let page = await service.history(id);
        let items = [...page];
        while (
          earliest &&
          page.length === 50 &&
          (page.at(-1)!.created_at > earliest.created_at ||
            (page.at(-1)!.created_at === earliest.created_at &&
              page.at(-1)!.id > earliest.id))
        ) {
          if (activeRef.current !== id || seq !== requestSeq.current) return;
          page = await service.history(id, page.at(-1));
          items.push(...page);
        }
        if (activeRef.current !== id || seq !== requestSeq.current) return;
        const received = new Set(items.map((m) => m.id));
        outbox.current = outbox.current.filter((m) => !received.has(m.id));
        saveOutbox();
        setMessages((old) =>
          mergeMessages(
            mergeMessages(
              old.filter((m) => m.conversation_id === id),
              outbox.current.filter((m) => m.conversation_id === id),
            ),
            items,
          ),
        );
        setHasMore(page.length === 50);
        setMessageError("");
      } catch (e) {
        if (activeRef.current === id && seq === requestSeq.current)
          setMessageError(errorText(e));
      } finally {
        if (activeRef.current === id && seq === requestSeq.current)
          setMessageLoading(false);
      }
    },
    [service, saveOutbox],
  );
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const unsub = service.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
        if (activeRef.current) void refreshMessages(activeRef.current);
      }, 100);
    });
    const focus = () => {
      void refresh();
      if (activeRef.current) void refreshMessages(activeRef.current);
    };
    window.addEventListener("focus", focus);
    const interval = setInterval(() => {
      if (!document.hidden && navigator.onLine) focus();
    }, 30000);
    return () => {
      unsub();
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      refreshSeq.current++;
      requestSeq.current++;
    };
  }, [refresh, refreshMessages, service]);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      void refresh();
      if (activeRef.current) void refreshMessages(activeRef.current);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [refresh, refreshMessages]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setMessages(outbox.current.filter((m) => m.conversation_id === active));
    messagesRef.current = [];
    setMessageError("");
    setDraft(active ? getDraft(`kindred-draft:${userId}:${active}`) : "");
    setTyping({});
    setPresent([]);
    setShowSearch(false);
    setMessageQuery("");
    setSearchResults([]);
    setMenu(null);
    setEmojiOpen(false);
    setHasMore(false);
    setJump(false);
    initialScroll.current = true;
    nearBottom.current = true;
    if (active) {
      setMessageLoading(true);
      void refreshMessages(active, true);
    }
    return () => {
      requestSeq.current++;
    };
  }, [active, userId, refreshMessages]);
  useEffect(() => {
    if (!active || preview || !supabase) return;
    setConnection("connecting");
    let disposed = false;
    const c = supabase.channel(`conversation:${active}`, {
      config: {
        private: true,
        presence: { key: userId },
        broadcast: { self: false },
      },
    });
    channel.current = c;
    c.on("presence", { event: "sync" }, () => {
      setPresent(Object.keys(c.presenceState()));
    });
    c.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (typeof payload?.user_id === "string" && payload.user_id !== userId)
        setTyping((old) => ({
          ...old,
          [payload.user_id]: payload.active ? Date.now() : 0,
        }));
    });
    c.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        setConnection("connected");
        void c.track({ online_at: new Date().toISOString() });
        void refreshMessages(active);
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setConnection("reconnecting");
      }
    });
    const interval = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(
            Object.entries(old).filter(([, at]) => Date.now() - at < 4000),
          ),
        ),
      1000,
    );
    return () => {
      disposed = true;
      clearInterval(interval);
      channel.current = null;
      void supabase!.removeChannel(c);
    };
  }, [active, preview, userId, refreshMessages]);
  useEffect(() => {
    const newest = messages.filter((m) => !m.status).at(-1);
    if (
      !active ||
      !newest ||
      document.hidden ||
      !nearBottom.current ||
      (!mobileChat && window.innerWidth <= 720)
    )
      return;
    const member = activeConversation?.members.find((m) => m.id === userId);
    if (member && member.last_read_at < newest.created_at)
      void service
        .read(active, newest.created_at)
        .then(() => {
          setConversations((old) =>
            old.map((c) =>
              c.id === active
                ? {
                    ...c,
                    unread: 0,
                    members: c.members.map((m) =>
                      m.id === userId
                        ? { ...m, last_read_at: newest.created_at }
                        : m,
                    ),
                  }
                : c,
            ),
          );
        })
        .catch(() => {});
  }, [
    active,
    messages,
    service,
    activeConversation,
    mobileChat,
    userId,
    readTick,
  ]);
  useEffect(() => {
    if (messageLoading) return;
    if (initialScroll.current || nearBottom.current) {
      endRef.current?.scrollIntoView({
        behavior: initialScroll.current ? "instant" : "smooth",
      });
      initialScroll.current = false;
      setJump(false);
    } else setJump(true);
  }, [messages, messageLoading]);
  useEffect(() => {
    if (!showSearch || !active || messageQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      return;
    }
    let current = true;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      service
        .searchMessages(active, messageQuery)
        .then((items) => {
          if (current) {
            setSearchResults(items);
            setSearchError("");
          }
        })
        .catch((e) => {
          if (current) setSearchError(errorText(e));
        })
        .finally(() => {
          if (current) setSearchLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [showSearch, active, messageQuery, service]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setEmojiOpen(false);
        setShowSearch(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal("new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function updateDraft(value: string) {
    setDraft(value);
    if (active)
      try {
        sessionStorage.setItem(`kindred-draft:${userId}:${active}`, value);
      } catch {
        /* Draft remains available in memory. */
      }
    if (channel.current && Date.now() - lastTyping.current > 1200) {
      lastTyping.current = Date.now();
      void channel.current.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: userId, active: Boolean(value.trim()) },
      });
    }
  }
  async function deliver(id: string, body: string, conversation: string) {
    try {
      const sent = await service.send(conversation, id, body);
      outbox.current = outbox.current.filter((m) => m.id !== id);
      saveOutbox();
      if (activeRef.current === conversation)
        setMessages((old) => mergeMessages(old, [sent]));
      void refresh();
    } catch (e) {
      outbox.current = outbox.current.map((m) =>
        m.id === id ? { ...m, status: "failed" } : m,
      );
      saveOutbox();
      if (activeRef.current === conversation)
        setMessages((old) =>
          old.map((m) => (m.id === id ? { ...m, status: "failed" } : m)),
        );
      notify(`Message wasn’t sent. ${errorText(e)}`);
    }
  }
  function send(e?: FormEvent) {
    e?.preventDefault();
    if (!active || !validMessage(draft) || (!online && !preview)) return;
    const body = draft.trim();
    const m: Message = {
      id: crypto.randomUUID(),
      conversation_id: active,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      status: "sending",
    };
    outbox.current.push(m);
    saveOutbox();
    nearBottom.current = true;
    setMessages((old) => mergeMessages(old, [m]));
    updateDraft("");
    setEmojiOpen(false);
    if (channel.current)
      void channel.current.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: userId, active: false },
      });
    void deliver(m.id, body, active);
    composerRef.current?.focus();
  }
  async function older() {
    const oldest = messages.find((m) => !m.status);
    if (!active || !oldest) return;
    const id = active;
    setOlderLoading(true);
    const el = scrollRef.current;
    const oldHeight = el?.scrollHeight || 0;
    const oldTop = el?.scrollTop || 0;
    try {
      const items = await service.history(id, oldest);
      if (activeRef.current === id) {
        setHasMore(items.length === 50);
        nearBottom.current = false;
        setMessages((old) => mergeMessages(old, items));
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - oldHeight + oldTop;
        });
      }
    } catch (e) {
      notify(errorText(e));
    } finally {
      setOlderLoading(false);
    }
  }
  function selectConversation(id: string) {
    setActive(id);
    setMobileChat(true);
  }
  async function exit() {
    try {
      await onExit();
    } catch (e) {
      notify(errorText(e));
    }
  }
  const stageMessage = useCallback(
    (id: string, body: string) => {
      try {
        sessionStorage.setItem(`kindred-draft:${userId}:${id}`, body);
      } catch {
        /* Current composer still retains the draft. */
      }
      setActive(id);
      setDraft(body);
      setMobileChat(true);
    },
    [userId],
  );
  useChatTools(conversations, userId, stageMessage);
  const list = conversations.filter(
    (c) =>
      (filter === "all" ||
        (filter === "unread" && c.unread > 0) ||
        (filter === "circles" && c.kind === "group")) &&
      `${titleOf(c, userId)} ${c.members.map((m) => m.username).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const typingPeople =
    activeConversation?.members.filter(
      (p) => p.id !== userId && Date.now() - (typing[p.id] || 0) < 4000,
    ) || [];
  const other = activeConversation?.members.find((p) => p.id !== userId);
  const someoneOnline = activeConversation?.members.some(
    (p) => p.id !== userId && present.includes(p.id),
  );
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);
  const lastOwn = messages.filter((m) => m.sender_id === userId).at(-1)?.id;
  useEffect(() => {
    document.title = totalUnread
      ? `(${totalUnread}) Kindred — Messages`
      : "Kindred — A little closer";
  }, [totalUnread]);
  return (
    <div className={`workspace ${mobileChat ? "mobile-chat" : ""}`}>
      {preview && (
        <div className="preview-bar">
          <span>
            <span className="preview-label">PREVIEW</span> A little look around.
            Changes stay in this browser.
          </span>
          <button onClick={() => void exit()}>
            {isConfigured
              ? "Sign in to your workspace"
              : "Connect your workspace"}
          </button>
        </div>
      )}
      <div className="app-shell">
        <nav className="nav-rail" aria-label="Main navigation">
          <a className="rail-brand" href="/" aria-label="Kindred home">
            <img src="/favicon.svg" alt="Kindred" />
          </a>
          <div className="rail-links">
            <button
              className={
                filter !== "circles" ? "rail-button active" : "rail-button"
              }
              aria-label="All conversations"
              onClick={() => {
                setFilter("all");
                setMobileChat(false);
              }}
            >
              <MessageCircle size={23} />
              {totalUnread > 0 && <span className="rail-unread" />}
            </button>
            <button
              className={
                filter === "circles" ? "rail-button active" : "rail-button"
              }
              aria-label="Circles"
              onClick={() => {
                setFilter("circles");
                setMobileChat(false);
              }}
            >
              <Users size={23} />
            </button>
          </div>
          <div className="rail-bottom">
            <button
              className="rail-button"
              aria-label="Help and shortcuts"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={21} />
            </button>
            <button
              className="rail-button"
              aria-label="Edit profile"
              onClick={() => setModal("profile")}
            >
              <Settings2 size={21} />
            </button>
            {me && (
              <button
                className="rail-profile"
                onClick={() => setModal("profile")}
                aria-label="Your profile"
              >
                <Avatar person={me} size="small" />
              </button>
            )}
          </div>
        </nav>
        <aside className="conversation-sidebar">
          <div className="sidebar-header">
            <div className="sidebar-heading">
              <h1>
                Messages<span>.</span>
              </h1>
              <button
                className="new-button"
                onClick={() => setModal("new")}
                aria-label="New conversation"
              >
                <Plus size={22} />
              </button>
            </div>
            <p>Your people, a little closer.</p>
            <InvitationInbox preview={preview} me={userId} onChanged={refresh} />
            <button className="discover-entry" onClick={onDiscover}>
              <Shuffle size={17} />
              <span>Meet someone new</span>
              <span className="entry-badge">NEW</span>
            </button>
            <div className="search-box">
              <Search size={17} />
              <input
                aria-label="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a conversation…"
              />
              {query && (
                <button
                  aria-label="Clear conversation search"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="filter-tabs" aria-label="Filter conversations">
              {(["all", "unread", "circles"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={f === filter}
                  className={f === filter ? "selected" : ""}
                >
                  {f === "all" ? "All" : f === "unread" ? "Unread" : "Circles"}
                  {f === "unread" && totalUnread > 0 && (
                    <span>{totalUnread}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="conversation-list">
            {loadError && conversations.length > 0 && (
              <div className="sync-warning" role="status">
                Couldn’t refresh. Showing your saved conversations.{" "}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            )}
            {loading ? (
              <div className="loading-row">
                <Spinner /> Opening your workspace
              </div>
            ) : loadError && !conversations.length ? (
              <div className="empty-small error-state">
                <p>{loadError}</p>
                <button
                  className="button secondary"
                  onClick={() => void refresh()}
                >
                  Try again
                </button>
              </div>
            ) : !list.length ? (
              <div className="empty-small">
                <MessageCircle size={26} />
                <h3>
                  {query
                    ? "No conversations found"
                    : filter === "unread"
                      ? "All caught up"
                      : filter === "circles"
                        ? "Your circle starts here"
                        : "Say your first hello"}
                </h3>
                <p>
                  {query
                    ? "Try another name."
                    : filter === "unread"
                      ? "A little breathing room."
                      : "Start a conversation with someone you know."}
                </p>
                {!query && filter !== "unread" && (
                  <button
                    className="text-button"
                    onClick={() => setModal("new")}
                  >
                    Start a conversation
                  </button>
                )}
              </div>
            ) : (
              list.map((c) => {
                const person = c.members.find((p) => p.id !== userId);
                return (
                  <button
                    key={c.id}
                    className={`conversation-row ${active === c.id ? "selected" : ""}`}
                    onClick={() => selectConversation(c.id)}
                    aria-label={`Open ${titleOf(c, userId)}${c.unread ? `, ${c.unread} unread` : ""}`}
                    aria-current={active === c.id ? "true" : undefined}
                  >
                    <Avatar person={person} group={c.kind === "group"} />
                    <div className="conversation-text">
                      <div>
                        <strong>{titleOf(c, userId)}</strong>
                        <time>
                          {c.last_message
                            ? shortDate(c.last_message.created_at)
                            : ""}
                        </time>
                      </div>
                      <div className="conversation-preview">
                        <p>
                          {c.last_message
                            ? `${c.last_message.sender_id === userId ? "You: " : ""}${c.last_message.body}`
                            : "The beginning of a good conversation."}
                        </p>
                        {c.unread > 0 && (
                          <span className="unread-badge">
                            {c.unread > 99 ? "99+" : c.unread}
                          </span>
                        )}
                      </div>
                      {c.kind === "group" && (
                        <span className="circle-tag">
                          {c.members.length} people · Circle
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="sidebar-footer">
            {me && (
              <>
                <button
                  className="current-user"
                  onClick={() => setModal("profile")}
                >
                  <Avatar person={me} size="small" />
                  <span>
                    <strong>{me.display_name}</strong>
                    <small>
                      {preview ? "Preview account" : "Your personal space"}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  onClick={() => void exit()}
                  aria-label={preview ? "Leave preview" : "Sign out"}
                  title={preview ? "Leave preview" : "Sign out"}
                >
                  <LogOut size={18} />
                </button>
              </>
            )}
          </div>
        </aside>
        <main className="chat-main">
          {activeConversation ? (
            <>
              <header className="chat-header">
                <button
                  className="icon-button mobile-back"
                  onClick={() => setMobileChat(false)}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={20} />
                </button>
                <Avatar
                  person={other}
                  group={activeConversation.kind === "group"}
                  size="header-avatar"
                />
                <div className="chat-title">
                  <h2>{titleOf(activeConversation, userId)}</h2>
                  <span>
                    {typingPeople.length ? (
                      `${typingPeople.map((p) => p.display_name.split(" ")[0]).join(", ")} ${typingPeople.length > 1 ? "are" : "is"} typing…`
                    ) : someoneOnline ? (
                      <>
                        <span className="online-dot" /> Here with you
                      </>
                    ) : activeConversation.kind === "group" ? (
                      `${activeConversation.members.length} people in this circle`
                    ) : (
                      "Your private conversation"
                    )}
                  </span>
                </div>
                <div className="header-actions">
                  <button
                    className={`icon-button ${showSearch ? "pressed" : ""}`}
                    onClick={() => setShowSearch((v) => !v)}
                    aria-label="Search messages"
                    aria-pressed={showSearch}
                  >
                    <Search size={21} />
                  </button>
                  <button
                    className={`icon-button ${details ? "pressed" : ""}`}
                    onClick={() => setDetails((v) => !v)}
                    aria-label="Conversation details"
                    aria-pressed={details}
                  >
                    <Info size={21} />
                  </button>
                </div>
              </header>
              {(!online || (!preview && connection === "reconnecting")) && (
                <div className="connection-banner" role="status">
                  <WifiOff size={16} />
                  {!online
                    ? "You’re offline. Failed messages can be retried when you reconnect."
                    : "Reconnecting to live updates. Your saved messages are safe."}
                </div>
              )}
              {showSearch && (
                <section className="message-search-panel">
                  <div className="search-box">
                    <Search size={18} />
                    <input
                      aria-label="Search in this conversation"
                      placeholder="Search this conversation…"
                      value={messageQuery}
                      onChange={(e) => setMessageQuery(e.target.value)}
                      autoFocus
                    />
                    <button
                      aria-label="Close message search"
                      onClick={() => setShowSearch(false)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  {messageQuery.trim().length < 2 ? (
                    <p>Enter at least two characters.</p>
                  ) : searchLoading ? (
                    <div className="loading-row">
                      <Spinner /> Searching the conversation
                    </div>
                  ) : searchError ? (
                    <p className="form-error" role="alert">
                      {searchError}
                    </p>
                  ) : (
                    <>
                      <span className="search-count">
                        {searchResults.length === 100
                          ? "First 100"
                          : searchResults.length}{" "}
                        {searchResults.length === 1 ? "message" : "messages"}{" "}
                        found
                      </span>
                      <div className="search-results">
                        {searchResults.map((m) => (
                          <div key={m.id}>
                            <strong>
                              {
                                activeConversation.members.find(
                                  (p) => p.id === m.sender_id,
                                )?.display_name
                              }
                              <time>{shortDate(m.created_at)}</time>
                            </strong>
                            <p>{m.body}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}
              {messageError && messages.length > 0 && (
                <div className="sync-warning" role="status">
                  Couldn’t refresh this conversation.{" "}
                  <button onClick={() => void refreshMessages(active!)}>
                    Retry
                  </button>
                </div>
              )}
              <div
                className="message-scroll"
                ref={scrollRef}
                onScroll={() => {
                  const el = scrollRef.current;
                  if (el) {
                    nearBottom.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 130;
                    if (nearBottom.current) {
                      setJump(false);
                      setReadTick((v) => v + 1);
                    }
                  }
                }}
              >
                {messageLoading ? (
                  <div className="loading-row">
                    <Spinner /> Bringing you up to date
                  </div>
                ) : messageError && !messages.length ? (
                  <div className="empty-small error-state">
                    <p>{messageError}</p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setMessageLoading(true);
                        void refreshMessages(active!, true);
                      }}
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <>
                    {hasMore && (
                      <button
                        className="load-older"
                        onClick={() => void older()}
                        disabled={olderLoading}
                      >
                        {olderLoading ? <Spinner /> : "Load earlier messages"}
                      </button>
                    )}
                    <div className="conversation-beginning">
                      <span className="beginning-line" />
                      <span>
                        <MessageCircle size={13} /> A space for{" "}
                        {activeConversation.kind === "group"
                          ? "your circle"
                          : "the two of you"}
                      </span>
                      <span className="beginning-line" />
                    </div>
                    {messages.length === 0 && (
                      <div className="first-hello">
                        <Avatar
                          person={other}
                          group={activeConversation.kind === "group"}
                          size="xl"
                        />
                        <h3>Every conversation starts somewhere.</h3>
                        <p>
                          Say hello to {titleOf(activeConversation, userId)}.
                        </p>
                      </div>
                    )}
                    {messages.map((m, i) => {
                      const mine = m.sender_id === userId;
                      const sender = activeConversation.members.find(
                        (p) => p.id === m.sender_id,
                      );
                      const prev = messages[i - 1];
                      const next = messages[i + 1];
                      const newDay =
                        !prev ||
                        new Date(prev.created_at).toDateString() !==
                          new Date(m.created_at).toDateString();
                      const grouped =
                        !newDay &&
                        prev?.sender_id === m.sender_id &&
                        new Date(m.created_at).getTime() -
                          new Date(prev.created_at).getTime() <
                          300000;
                      const endGroup =
                        !next ||
                        next.sender_id !== m.sender_id ||
                        new Date(next.created_at).getTime() -
                          new Date(m.created_at).getTime() >
                          300000;
                      const readByOthers = activeConversation.members
                        .filter((p) => p.id !== userId)
                        .every((p) => p.last_read_at >= m.created_at);
                      return (
                        <div key={m.id}>
                          {newDay && (
                            <div className="date-divider">
                              <span>{dayLabel(m.created_at)}</span>
                            </div>
                          )}
                          <div
                            className={`message-row ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""} ${m.status === "failed" ? "failed" : ""}`}
                          >
                            <div className="message-avatar">
                              {!mine && !grouped && (
                                <Avatar person={sender} size="small" />
                              )}
                            </div>
                            <div className="message-content">
                              {!mine &&
                                !grouped &&
                                activeConversation.kind === "group" && (
                                  <span className="sender-name">
                                    {sender?.display_name}
                                  </span>
                                )}
                              <div className="bubble-wrap">
                                <div
                                  className={`message-bubble ${m.deleted_at ? "deleted" : ""}`}
                                >
                                  {m.deleted_at ? (
                                    <>
                                      <Trash2 size={14} /> Message deleted
                                    </>
                                  ) : (
                                    m.body
                                  )}
                                </div>
                                {!m.deleted_at && !m.status && (
                                  <div className="message-actions">
                                    <button
                                      className="icon-button"
                                      aria-label={`Actions for message ${i + 1}`}
                                      onClick={() =>
                                        setMenu(menu === m.id ? null : m.id)
                                      }
                                    >
                                      <MoreHorizontal size={18} />
                                    </button>
                                    {menu === m.id && (
                                      <div className="message-menu">
                                        <button
                                          onClick={() => {
                                            void navigator.clipboard
                                              .writeText(m.body)
                                              .then(() =>
                                                notify("Message copied"),
                                              )
                                              .catch(() =>
                                                notify(
                                                  "Your browser couldn’t copy this message.",
                                                ),
                                              );
                                            setMenu(null);
                                          }}
                                        >
                                          <Copy size={14} /> Copy
                                        </button>
                                        {mine && (
                                          <>
                                            <button
                                              onClick={() => {
                                                setEditing(m);
                                                setMenu(null);
                                              }}
                                            >
                                              <Edit3 size={14} /> Edit
                                            </button>
                                            <button
                                              className="danger"
                                              onClick={() => {
                                                setDeleting(m);
                                                setMenu(null);
                                              }}
                                            >
                                              <Trash2 size={14} /> Delete
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {(endGroup || m.status || m.edited_at) && (
                                <div className="message-meta">
                                  <time>{time(m.created_at)}</time>
                                  {m.edited_at && !m.deleted_at && (
                                    <span>edited</span>
                                  )}
                                  {mine &&
                                    (m.status === "sending" ? (
                                      <span>Sending…</span>
                                    ) : m.status === "failed" ? (
                                      <button
                                        onClick={() => {
                                          setMessages((old) =>
                                            old.map((item) =>
                                              item.id === m.id
                                                ? { ...item, status: "sending" }
                                                : item,
                                            ),
                                          );
                                          void deliver(
                                            m.id,
                                            m.body,
                                            m.conversation_id,
                                          );
                                        }}
                                      >
                                        Not sent · Retry
                                      </button>
                                    ) : readByOthers ? (
                                      <>
                                        <CheckCheck size={15} />
                                        {m.id === lastOwn && <span>Read</span>}
                                      </>
                                    ) : (
                                      <Check size={14} />
                                    ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {typingPeople.length > 0 && (
                      <div className="typing-bubble" aria-live="polite">
                        <i />
                        <i />
                        <i />
                        <span>
                          {typingPeople[0].display_name.split(" ")[0]} is typing
                        </span>
                      </div>
                    )}
                    <div ref={endRef} />
                  </>
                )}
              </div>
              {jump && (
                <button
                  className="jump-button"
                  onClick={() => {
                    nearBottom.current = true;
                    endRef.current?.scrollIntoView({ behavior: "smooth" });
                    setJump(false);
                  }}
                >
                  <ArrowDown size={15} /> Latest messages
                </button>
              )}
              <footer className="composer-area">
                <form className="composer" onSubmit={send}>
                  <textarea
                    ref={composerRef}
                    aria-label="Message"
                    rows={1}
                    maxLength={4000}
                    value={draft}
                    onChange={(e) => {
                      updateDraft(e.target.value);
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 150)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder={`Message ${activeConversation.kind === "group" ? "the circle" : other?.display_name.split(" ")[0] || ""}…`}
                  />
                  <div className="composer-tools">
                    <div className="emoji-control">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Choose an emoji"
                        onClick={() => setEmojiOpen((v) => !v)}
                        aria-expanded={emojiOpen}
                      >
                        <Smile size={22} />
                      </button>
                      {emojiOpen && (
                        <div className="emoji-picker">
                          {[
                            "😊",
                            "❤️",
                            "🙌",
                            "✨",
                            "☕",
                            "👍",
                            "🎉",
                            "🌿",
                            "😂",
                            "👋",
                            "💡",
                            "🥾",
                          ].map((emoji) => (
                            <button
                              type="button"
                              key={emoji}
                              aria-label={`Insert ${emoji}`}
                              onClick={() => {
                                updateDraft((draft + emoji).slice(0, 4000));
                                setEmojiOpen(false);
                                composerRef.current?.focus();
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className="send-button"
                      disabled={!validMessage(draft) || (!online && !preview)}
                      aria-label="Send message"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </form>
                <div className="composer-hint">
                  <span>
                    {draft.length > 3600
                      ? `${draft.length}/4000 characters`
                      : "A little thought goes a long way."}
                  </span>
                  <span>
                    <kbd>Enter</kbd> to send <span className="hint-dot">·</span>{" "}
                    <kbd>Shift + Enter</kbd> for a new line
                  </span>
                </div>
              </footer>
            </>
          ) : (
            <div className="welcome-empty">
              <Brand />
              <div className="welcome-mark">
                <MessageCircle size={42} />
              </div>
              <h2>
                {loading
                  ? "Settling in…"
                  : "Your next conversation starts here."}
              </h2>
              <p>
                {loading
                  ? "Getting your space ready."
                  : "Find your people. Pick up where you left off."}
              </p>
              {!loading && (
                <button
                  className="button primary"
                  onClick={() => setModal("new")}
                >
                  <Plus size={17} /> Start a conversation
                </button>
              )}
            </div>
          )}
        </main>
        {details && activeConversation && (
          <Details
            conversation={activeConversation}
            preview={preview}
            onChanged={refresh}
            me={userId}
            onClose={() => setDetails(false)}
          />
        )}
      </div>
      {modal === "new" && (
        <NewConversation
          preview={preview}
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            void refresh().then(() => {
              selectConversation(id);
            });
          }}
        />
      )}
      {modal === "profile" && me && (
        <PersonaEditor
          preview={preview}
          onClose={() => setModal(null)}
          onSaved={() => {
            void refresh();
            notify("A little more you. Profile saved.");
          }}
        />
      )}
      {modal === "help" && (
        <Modal title="A little help" onClose={() => setModal(null)}>
          <p className="muted">Make yourself comfortable.</p>
          <div className="shortcut-list">
            <span>
              Start a conversation<kbd>⌘ / Ctrl K</kbd>
            </span>
            <span>
              Send a message<kbd>Enter</kbd>
            </span>
            <span>
              Add a new line<kbd>Shift Enter</kbd>
            </span>
            <span>
              Close an overlay<kbd>Esc</kbd>
            </span>
          </div>
          <p className="help-copy">
            Your drafts stay on this device until you send them. Use message
            actions to copy, edit, or delete your own messages.
          </p>
          {preview && (
            <div className="preview-explainer">
              <strong>You’re in the preview workspace.</strong>
              <p>
                The people and conversations are examples. Messages stay in this
                browser, and no one receives them. Sign in to a connected
                workspace to chat with real people.
              </p>
            </div>
          )}
        </Modal>
      )}
      {editing && (
        <MessageEditor
          message={editing}
          preview={preview}
          onClose={() => setEditing(null)}
          onSaved={() => {
            if (active) void refreshMessages(active);
            notify("Message updated");
          }}
        />
      )}
      {deleting && (
        <Modal
          title="Delete this message?"
          onClose={() => {
            if (!deleteBusy) setDeleting(null);
          }}
        >
          <p className="muted">
            It will be replaced with “Message deleted” for everyone in this
            conversation.
          </p>
          <div className="delete-preview">{deleting.body}</div>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              Keep message
            </button>
            <button
              className="button destructive"
              disabled={deleteBusy}
              onClick={async () => {
                setDeleteBusy(true);
                try {
                  await service.remove(deleting.id);
                  setDeleting(null);
                  if (active) void refreshMessages(active);
                  notify("Message deleted");
                } catch (e) {
                  notify(errorText(e));
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? <Spinner /> : "Delete message"}
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
