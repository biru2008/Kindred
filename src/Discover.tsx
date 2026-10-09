import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  Headphones,
  Music2,
  Send,
  Shield,
  Shuffle,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { Avatar, Brand, Spinner } from "./components";
import { PersonaEditor, PersonaViewer } from "./Personas";
import { discovery } from "./lib/discover";
import {
  commonInterests,
  interestOptions,
  maxInterests,
  normalizeInterests,
  normalizeInterest,
  maxTagLength,
} from "./lib/interests";
import type { Interest } from "./lib/interests";
import type { Persona, RandomMessage, RandomState } from "./lib/discover";
import { errorText, validMessage } from "./lib/types";
type Pending = { id: string; body: string; session: string };
function restorePending(userId: string): Pending | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(`kindred-random-pending:${userId}`) || "null",
    );
  } catch {
    return null;
  }
}
function restoreInterests(userId: string): {
  tags: Interest[];
  sharedOnly: boolean;
} {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`kindred-interests:${userId}`) || "null",
    );
    const tags = normalizeInterests(saved?.tags);
    return { tags, sharedOnly: tags.length > 0 && saved?.sharedOnly === true };
  } catch {
    return { tags: [], sharedOnly: false };
  }
}
export default function Discover({
  preview,
  userId,
  onBack,
}: {
  preview: boolean;
  userId: string;
  onBack: () => void;
}) {
  const service = useMemo(() => discovery(preview), [preview]);
  const [state, setState] = useState<RandomState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [loaded, setLoaded] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [interests, setInterests] = useState<Interest[]>(
    () => restoreInterests(userId).tags,
  );
  const [customTag, setCustomTag] = useState("");
  const [tagError, setTagError] = useState("");
  const [sharedOnly, setSharedOnly] = useState(
    () => restoreInterests(userId).sharedOnly,
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        `kindred-interests:${userId}`,
        JSON.stringify({ tags: interests, sharedOnly }),
      );
    } catch {
      /* Preferences work in memory if storage is unavailable. */
    }
  }, [interests, sharedOnly, userId]);
  function addCustomTag() {
    const tag = normalizeInterest(customTag);
    if (!tag) {
      setTagError("Use 2–30 letters or numbers, spaces, or hyphens.");
      return;
    }
    if (interests.includes(tag)) {
      setTagError("You’ve already selected that interest.");
      return;
    }
    if (interests.length >= maxInterests) {
      setTagError("Remove an interest before adding another.");
      return;
    }
    setInterests([...interests, tag]);
    setCustomTag("");
    setTagError("");
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<RandomMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(() =>
    restorePending(userId),
  );
  const [sending, setSending] = useState(false);
  const [viewProfile, setViewProfile] = useState<Persona | null>(null);
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [block, setBlock] = useState(false);
  const [more, setMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [connected, setConnected] = useState(navigator.onLine);
  const [needJump, setNeedJump] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const seq = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const request = ++seq.current;
    try {
      const next = await service.state();
      let items: RandomMessage[] = [];
      let hasMore = false;
      if (next.session_id) {
        let page = await service.history(next.session_id);
        items = page;
        const earliest =
          stateRef.current.session_id === next.session_id
            ? messagesRef.current[0]
            : undefined;
        while (
          earliest &&
          page.length === 100 &&
          (page[0].created_at > earliest.created_at ||
            (page[0].created_at === earliest.created_at &&
              page[0].id > earliest.id))
        ) {
          page = await service.history(next.session_id, page[0]);
          items = [...page, ...items];
        }
        hasMore = page.length === 100;
      }
      if (!mounted.current || request !== seq.current) return;
      if (next.session_id !== stateRef.current.session_id) {
        nearBottom.current = true;
        setDraft("");
        setScore(null);
        setBlock(false);
      }
      if (next.status === "waiting" && next.search_interests) {
        setInterests(normalizeInterests(next.search_interests));
        setSharedOnly(next.shared_only === true);
      }
      setState(next);
      setMessages(items);
      setMore(hasMore);
      setError("");
      setLoaded(true);
    } catch (e) {
      if (mounted.current && request === seq.current) {
        setError(errorText(e));
        setLoaded(true);
      }
    }
  }, [service]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsub = service.subscribe(userId, () => void refresh());
    const timer = setInterval(() => void refresh(), 8000);
    const online = () => {
      setConnected(navigator.onLine);
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    window.addEventListener("focus", online);
    return () => {
      mounted.current = false;
      seq.current++;
      unsub();
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      window.removeEventListener("focus", online);
    };
  }, [service, userId, refresh]);
  useEffect(() => {
    try {
      if (pending)
        sessionStorage.setItem(
          `kindred-random-pending:${userId}`,
          JSON.stringify(pending),
        );
      else sessionStorage.removeItem(`kindred-random-pending:${userId}`);
    } catch {
      /* Keep unsent text in memory. */
    }
  }, [pending, userId]);
  useEffect(() => {
    if (pending && messages.some((m) => m.id === pending.id)) setPending(null);
    if (nearBottom.current) end.current?.scrollIntoView({ behavior: "smooth" });
    else setNeedJump(true);
  }, [messages, pending]);
  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    if (busyRef.current) return false;
    setBusy(true);
    busyRef.current = true;
    seq.current++;
    setError("");
    let failure = "";
    try {
      await fn();
    } catch (e) {
      failure = errorText(e);
    } finally {
      setBusy(false);
      busyRef.current = false;
      await refresh();
    }
    if (failure) setError(failure);
    return !failure;
  }
  async function join() {
    await act(async () => {
      setPending(null);
      setMessages([]);
      const next = await service.join(anonymous, interests, sharedOnly);
      setState(next);
    });
  }
  async function leave() {
    if (state.status === "matched") {
      await act(() => service.end(state.session_id!));
      return;
    }
    if (state.status === "ended") {
      if (await act(() => service.rate(state.session_id!, score, block)))
        onBack();
      return;
    }
    if (await act(() => service.cancel())) onBack();
  }
  async function send(item?: Pending) {
    const p = item || {
      id: crypto.randomUUID(),
      body: draft.trim(),
      session: state.session_id!,
    };
    if (
      (pending && !item) ||
      !connected ||
      sending ||
      state.status !== "matched" ||
      !validMessage(p.body)
    )
      return;
    setPending(p);
    setSending(true);
    setDraft("");
    setError("");
    nearBottom.current = true;
    try {
      await service.send(p.session, p.id, p.body);
      setPending(null);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }
  async function finish(next: boolean) {
    await act(async () => {
      await service.rate(state.session_id!, score, block);
      setScore(null);
      setBlock(false);
      setPending(null);
      setMessages([]);
      setState(
        next
          ? await service.join(anonymous, interests, sharedOnly)
          : { status: "idle" },
      );
    });
  }
  async function loadOlder() {
    if (!messages.length || !state.session_id) return;
    setOlderBusy(true);
    const sid = state.session_id;
    const el = scroll.current;
    const height = el?.scrollHeight || 0;
    const top = el?.scrollTop || 0;
    try {
      const items = await service.history(sid, messages[0]);
      if (stateRef.current.session_id === sid) {
        setMessages((old) => [
          ...items.filter((m) => !old.some((o) => o.id === m.id)),
          ...old,
        ]);
        setMore(items.length === 100);
        nearBottom.current = false;
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - height + top;
        });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOlderBusy(false);
    }
  }
  const matched = state.status === "matched" || state.status === "ended";
  return (
    <div className="discover-shell">
      {preview && (
        <div className="preview-bar">
          <span>
            <span className="preview-label">PREVIEW</span> Simulated partners ·
            Nothing is sent to real people
          </span>
        </div>
      )}
      <header className="discover-header">
        <button
          className="back-link"
          onClick={() => void leave()}
          disabled={busy}
        >
          <ArrowLeft size={18} />
          <span>{matched ? "End & leave" : "Messages"}</span>
        </button>
        <Brand small />
        <button
          className="button secondary"
          aria-label="My profiles"
          onClick={() => setEditing(true)}
        >
          <Music2 size={16} />
          <span>My profiles</span>
        </button>
      </header>
      <main className={`discover-main ${matched ? "in-conversation" : ""}`}>
        {!matched ? (
          <section className="discover-lobby">
            <div className="lobby-label">
              <Sparkles size={15} /> THE NEXT HELLO
            </div>
            <h1>
              A stranger today.
              <br />
              <span>A good story tomorrow.</span>
            </h1>
            <p>
              One conversation. No followers, no scores to chase.
              <br />
              Just someone new on the other side.
            </p>
            <div className="identity-switch" aria-label="Choose your identity">
              <button
                className={anonymous ? "selected" : ""}
                aria-pressed={anonymous}
                disabled={state.status === "waiting" || busy}
                onClick={() => setAnonymous(true)}
              >
                <Shield size={21} />
                <strong>Go anonymous</strong>
                <span>Your alias. Your own space.</span>
              </button>
              <button
                className={!anonymous ? "selected" : ""}
                aria-pressed={!anonymous}
                disabled={state.status === "waiting" || busy}
                onClick={() => setAnonymous(false)}
              >
                <Users size={21} />
                <strong>Be yourself</strong>
                <span>Your regular profile.</span>
              </button>
            </div>
            <fieldset
              className="interest-picker"
              disabled={state.status === "waiting" || busy}
            >
              <legend>Find your people</legend>
              <div className="interest-picker-intro">
                <p>
                  Pick up to five interests. We’ll look for something in common.
                </p>
                <span aria-live="polite">
                  {interests.length}/{maxInterests}
                </span>
              </div>
              <div className="interest-options" aria-label="Choose interests">
                {interestOptions.map((tag) => {
                  const selected = interests.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`interest-chip ${selected ? "selected" : ""}`}
                      aria-pressed={selected}
                      disabled={!selected && interests.length >= maxInterests}
                      onClick={() => {
                        const next = selected
                          ? interests.filter((t) => t !== tag)
                          : [...interests, tag];
                        setInterests(next);
                        if (!next.length) setSharedOnly(false);
                      }}
                    >
                      <span aria-hidden="true">{selected ? "✓" : "+"}</span>
                      {tag}
                    </button>
                  );
                })}
              </div>
              {!!interests.filter(
                (tag) => !interestOptions.some((option) => option === tag),
              ).length && (
                <div
                  className="custom-interest-tags"
                  aria-label="Your custom interests"
                >
                  {interests
                    .filter(
                      (tag) =>
                        !interestOptions.some((option) => option === tag),
                    )
                    .map((tag) => (
                      <button
                        type="button"
                        key={tag}
                        className="interest-chip selected"
                        aria-label={`Remove ${tag} interest`}
                        onClick={() => {
                          const next = interests.filter((t) => t !== tag);
                          setInterests(next);
                          setTagError("");
                          if (!next.length) setSharedOnly(false);
                        }}
                      >
                        {tag}
                        <X size={13} aria-hidden="true" />
                      </button>
                    ))}
                </div>
              )}
              <div className="custom-interest-entry">
                <label htmlFor="custom-interest">Add your own interest</label>
                <div>
                  <input
                    id="custom-interest"
                    type="text"
                    value={customTag}
                    maxLength={maxTagLength}
                    placeholder="e.g. indie music or astronomy"
                    aria-describedby="custom-interest-help"
                    aria-invalid={!!tagError}
                    onChange={(e) => {
                      setCustomTag(e.target.value);
                      setTagError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                  />
                  <button
                    className="button secondary"
                    type="button"
                    onClick={addCustomTag}
                    disabled={!customTag.trim()}
                    aria-label="Add custom interest"
                  >
                    Add
                  </button>
                </div>
                <p id="custom-interest-help">
                  2–30 letters or numbers. Spaces and hyphens are welcome.
                </p>
                {tagError && (
                  <p className="custom-interest-error" role="alert">
                    {tagError}
                  </p>
                )}
              </div>
              <label className="interest-strict">
                <input
                  type="checkbox"
                  checked={sharedOnly}
                  disabled={!interests.length}
                  onChange={(e) => setSharedOnly(e.target.checked)}
                />
                Only match people with a shared interest
              </label>
              <p className="interest-hint">
                {sharedOnly
                  ? "We’ll wait for a shared-interest match. This may take longer."
                  : "Shared interests come first. Other eligible people can still match."}
              </p>
            </fieldset>
            {state.status === "waiting" ? (
              <div className="waiting-card" role="status">
                <div className="match-pulse">
                  <Shuffle size={28} />
                </div>
                <h2>Finding your next conversation…</h2>
                <p>
                  Keep this page open. We’ll connect you when a compatible
                  person is available.{" "}
                  {state.shared_only &&
                    "Your match will share at least one selected interest."}
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act(() => service.cancel())}
                >
                  Cancel search
                </button>
              </div>
            ) : (
              <button
                className="button primary meet-button"
                disabled={busy || !loaded || !connected}
                onClick={() => void join()}
              >
                {busy || !loaded ? <Spinner /> : <Shuffle size={20} />}Meet
                someone
              </button>
            )}
            <div className="lobby-notes">
              <span>
                <Shield size={16} /> Email verified. Identity stays yours.
              </span>
              <span>
                <Star size={16} /> Private feedback shapes better matches.
              </span>
              <span>
                <Headphones size={16} /> A profile with its own soundtrack.
              </span>
            </div>
            <p className="anon-explanation">
              Anonymous mode hides your regular identity from your match. Your
              verified account remains known to Kindred. Regular messages use
              your regular profile.
            </p>
          </section>
        ) : (
          <div className="random-layout">
            <section className="random-chat">
              <header className="random-chat-header">
                <button
                  className="peer-heading"
                  onClick={() => setViewProfile(state.peer!)}
                >
                  <Avatar person={state.peer} />
                  <span>
                    <strong>{state.peer?.display_name}</strong>
                    <small>
                      {state.peer?.anonymous
                        ? "Anonymous profile"
                        : "Regular profile"}{" "}
                      · View profile
                    </small>
                  </span>
                </button>
                <span className="your-mode">
                  <Shield size={14} />
                  {state.self_profile?.anonymous
                    ? "You’re anonymous"
                    : "You’re visible"}
                </span>
                <button
                  className="button secondary end-button"
                  disabled={busy || state.status === "ended"}
                  onClick={() => void act(() => service.end(state.session_id!))}
                >
                  <Shuffle size={16} />
                  <span>Next person</span>
                </button>
              </header>
              <div
                className="random-messages"
                ref={scroll}
                onScroll={() => {
                  const el = scroll.current;
                  if (el) {
                    nearBottom.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                    if (nearBottom.current) setNeedJump(false);
                  }
                }}
              >
                {more && (
                  <button
                    className="load-older"
                    disabled={olderBusy}
                    onClick={() => void loadOlder()}
                  >
                    {olderBusy ? <Spinner /> : "Earlier messages"}
                  </button>
                )}
                <div className="random-welcome">
                  <Sparkles size={18} />
                  <p>A new conversation. A fresh start.</p>
                  {commonInterests(
                    state.self_profile?.interests,
                    state.peer?.interests,
                  ).length > 0 && (
                    <div className="shared-interests">
                      <small>You both like</small>
                      <div className="interest-tags">
                        {commonInterests(
                          state.self_profile?.interests,
                          state.peer?.interests,
                        ).map((tag) => (
                          <span className="interest-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <span className="session-identity">
                    You’re {state.self_profile?.display_name} ·{" "}
                    {state.self_profile?.anonymous
                      ? "Anonymous"
                      : "Regular profile"}
                  </span>
                  <span>
                    {preview
                      ? "This partner is simulated for the preview."
                      : "Say hello. The best conversations start small."}
                  </span>
                </div>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`random-message ${m.sender_id === state.self_id ? "own" : ""}`}
                  >
                    <p>{m.body}</p>
                    <time>
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                ))}
                {pending &&
                  pending.session === state.session_id &&
                  !messages.some((m) => m.id === pending.id) && (
                    <div className="random-message own pending">
                      <p>{pending.body}</p>
                      <button
                        className="text-button"
                        disabled={sending || state.status !== "matched"}
                        onClick={() => void send(pending)}
                      >
                        {sending
                          ? "Sending…"
                          : state.status === "ended"
                            ? "Not sent — conversation ended"
                            : "Not sent · Retry"}
                      </button>
                    </div>
                  )}
                <div ref={end} />
              </div>
              {needJump && (
                <button
                  className="random-jump"
                  onClick={() => {
                    nearBottom.current = true;
                    end.current?.scrollIntoView({ behavior: "smooth" });
                    setNeedJump(false);
                  }}
                >
                  <ArrowDown size={16} />
                  Latest messages
                </button>
              )}
              {state.status === "ended" ? (
                <section className="rating-panel">
                  <span className="eyebrow">CONVERSATION ENDED</span>
                  <h2>How did that feel?</h2>
                  <p>
                    Only Kindred uses your feedback. Your match never sees your
                    rating.
                  </p>
                  <div
                    className="star-rating"
                    aria-label="Rate the conversation"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        aria-label={`Rate ${n} out of 5`}
                        aria-pressed={score === n}
                        onClick={() => setScore(n)}
                        className={
                          score !== null && n <= score ? "selected" : ""
                        }
                      >
                        <Star size={28} />
                      </button>
                    ))}
                  </div>
                  <span className="rating-caption">
                    {score
                      ? [
                          "Unpleasant",
                          "Not great",
                          "It was okay",
                          "Good conversation",
                          "Made my day",
                        ][score - 1]
                      : "Choose a rating, or continue without one."}
                  </span>
                  <label className="block-option">
                    <input
                      type="checkbox"
                      checked={block}
                      onChange={(e) => setBlock(e.target.checked)}
                    />
                    Don’t match me with this person again
                  </label>
                  <div className="rating-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void finish(false)}
                    >
                      Done for now
                    </button>
                    <button
                      className="button primary"
                      disabled={busy || !connected}
                      onClick={() => void finish(true)}
                    >
                      {busy ? <Spinner /> : <Shuffle size={16} />}{" "}
                      {score ? "Save & meet someone" : "Skip & meet someone"}
                    </button>
                  </div>
                </section>
              ) : (
                <form
                  className="random-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label="Random conversation message"
                    rows={1}
                    maxLength={4000}
                    placeholder="A simple hello goes a long way…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    className="send-button"
                    aria-label="Send random message"
                    disabled={
                      sending ||
                      Boolean(pending) ||
                      !validMessage(draft) ||
                      !connected
                    }
                  >
                    <Send size={19} />
                  </button>
                </form>
              )}
            </section>
            <aside className="random-side">
              <span className="eyebrow">ON THE OTHER SIDE</span>
              <button
                className="random-profile-card"
                onClick={() => setViewProfile(state.peer!)}
              >
                <Avatar person={state.peer} size="xl" />
                <h2>{state.peer?.display_name}</h2>
                <span>
                  {preview
                    ? "A simulated preview partner."
                    : state.peer?.anonymous
                      ? "A little mystery. A real person."
                      : "A new face. A fresh perspective."}
                </span>
                <p>
                  {state.peer?.bio ||
                    "Still finding the words. Ask me what I’m into."}
                </p>
                <div>
                  <Headphones size={17} />
                  {state.peer?.song_path
                    ? "Open profile to hear their song"
                    : "Open their profile"}
                </div>
              </button>
              <div className="random-principle">
                <Shield size={20} />
                <h3>Good company starts with you.</h3>
                <p>
                  Be curious. Be kind. You can leave at any time. Your private
                  feedback helps shape future matches.
                </p>
              </div>
            </aside>
          </div>
        )}
        {(!connected || error) && (
          <div className="discover-error" role="alert">
            <span>
              {!connected ? "You’re offline. Reconnect to continue." : error}
            </span>
            <button className="text-button" onClick={() => void refresh()}>
              Retry
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </main>
      {viewProfile && (
        <PersonaViewer
          persona={viewProfile}
          onClose={() => setViewProfile(null)}
        />
      )}{" "}
      {editing && (
        <PersonaEditor
          preview={preview}
          onClose={() => setEditing(false)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
