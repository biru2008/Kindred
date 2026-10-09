import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Mail,
  MessageCircle,
  Search,
  Users,
  X,
} from "lucide-react";
import type { Conversation, Message, Profile } from "./lib/types";
import { errorText, initials } from "./lib/types";
import { ProfileSong, PersonaViewer } from "./Personas";
import type { Persona } from "./lib/discover";
import { api } from "./lib/api";
import { GroupControls } from "./GroupManagement";
import { isConfigured, supabase } from "./lib/supabase";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <img src="/favicon.svg" alt="" />
      <span>
        kindred<span className="brand-period">.</span>
      </span>
    </span>
  );
}
export function Avatar({
  person,
  size = "",
  group = false,
}: {
  person?: Pick<Profile, "display_name" | "color">;
  size?: string;
  group?: boolean;
}) {
  return (
    <span
      className={`avatar ${person?.color || "fern"} ${size} ${group ? "group-avatar" : ""}`}
      aria-hidden="true"
    >
      {group ? (
        <Users size={size === "xl" ? 32 : 22} />
      ) : (
        initials(person?.display_name || "?")
      )}
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={19} aria-label="Loading" />;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Auth({
  onPreview,
  recovery = false,
  onRecovered,
}: {
  onPreview: () => void;
  recovery?: boolean;
  onRecovered: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const values = new FormData(e.currentTarget);
    const email = String(values.get("email") || "")
      .trim()
      .toLowerCase();
    const password = String(values.get("password") || "");
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onRecovered();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: String(values.get("name")).trim(),
              username: String(values.get("username")).trim().toLowerCase(),
            },
            emailRedirectTo: location.origin,
          },
        });
        if (error) throw error;
        if (!data.session)
          setNotice(
            "Check your inbox to confirm your email, then come back to sign in.",
          );
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin,
        });
        if (error) throw error;
        setNotice("If that email has an account, a reset link is on its way.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err) {
      let message = errorText(err);
      if (message.includes("Database error"))
        message =
          "Could not create your account. That username may already be taken. Try another username.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  function changeMode(next: typeof mode) {
    setMode(next);
    setError("");
    setNotice("");
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="story-center">
          <span className="eyebrow light">A LITTLE CLOSER</span>
          <h1>
            Good things start
            <br />
            with a conversation.
          </h1>
          <p>
            A quiet corner of the internet for your people.
            <br />
            Catch up. Share an idea. Stay a little longer.
          </p>
          <div className="story-message">
            <Avatar person={{ display_name: "Maya Chen", color: "lavender" }} />
            <div>
              <small>Maya Chen</small>
              <p>Same time tomorrow? ☕</p>
            </div>
            <span>4:02 PM</span>
          </div>
          <div className="story-reply">
            Wouldn’t miss it.
            <Check size={16} />
          </div>
        </div>
        <span className="auth-foot">Less noise. More connection.</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">
          <span className="eyebrow">YOUR PEOPLE, RIGHT HERE</span>
          <h2>
            {recovery
              ? "A fresh start."
              : mode === "signup"
                ? "Make yourself at home."
                : mode === "reset"
                  ? "Let’s get you back in."
                  : "Welcome back."}
          </h2>
          <p className="muted">
            {recovery
              ? "Choose a new password for your account."
              : mode === "signup"
                ? "A few details, and you’re part of the conversation."
                : mode === "reset"
                  ? "We’ll send you a link to reset your password."
                  : "There’s always something to catch up on."}
          </p>
          {!isConfigured ? (
            <div className="setup-notice">
              <MessageCircle size={24} />
              <h3>Your workspace is ready to connect.</h3>
              <p>
                The live service hasn’t been connected yet. Explore the preview
                while you complete the included Supabase setup.
              </p>
              <button className="button primary" onClick={onPreview}>
                Explore the preview
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              {mode === "signup" && !recovery && (
                <>
                  <label>
                    Your name
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={50}
                      placeholder="Alex Morgan"
                    />
                  </label>
                  <label>
                    Username
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      pattern="[a-z0-9_]{3,24}"
                      title="3–24 lowercase letters, numbers, or underscores"
                      minLength={3}
                      maxLength={24}
                      placeholder="alex_morgan"
                    />
                  </label>
                </>
              )}
              {!recovery && (
                <label>
                  Email address
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </label>
              )}
              {(mode !== "reset" || recovery) && (
                <label>
                  Password
                  <input
                    type="password"
                    name="password"
                    autoComplete={
                      mode === "signup" || recovery
                        ? "new-password"
                        : "current-password"
                    }
                    minLength={8}
                    maxLength={128}
                    required
                    placeholder={
                      mode === "signup" || recovery
                        ? "At least 8 characters"
                        : "Enter your password"
                    }
                  />
                </label>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              {notice && (
                <div className="form-success" role="status">
                  <Mail size={19} />
                  {notice}
                </div>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : recovery ? (
                  "Save new password"
                ) : mode === "signup" ? (
                  "Create account"
                ) : mode === "reset" ? (
                  "Send reset link"
                ) : (
                  "Sign in"
                )}
              </button>
              {!recovery && mode === "login" && (
                <button
                  className="text-button forgot"
                  type="button"
                  onClick={() => changeMode("reset")}
                >
                  Forgot your password?
                </button>
              )}
            </form>
          )}
          {isConfigured && !recovery && (
            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  New around here?{" "}
                  <button onClick={() => changeMode("signup")}>
                    Create an account
                  </button>
                </>
              ) : mode === "signup" ? (
                <>
                  Already a member?{" "}
                  <button onClick={() => changeMode("login")}>Sign in</button>
                </>
              ) : (
                <button onClick={() => changeMode("login")}>
                  <ArrowLeft size={14} /> Back to sign in
                </button>
              )}
            </div>
          )}
          {isConfigured && !recovery && (
            <button className="text-button demo-link" onClick={onPreview}>
              Take a look around first
            </button>
          )}
        </div>
        <p className="auth-privacy">
          A space for conversations that belong to you.
        </p>
      </section>
    </main>
  );
}
export function NewConversation({
  preview,
  onClose,
  onCreated,
}: {
  preview: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [group, setGroup] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api(preview)
        .searchPeople(query)
        .then((p) => {
          if (active) {
            setPeople(p);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, preview]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const id = await api(preview).start(
        selected.map((p) => p.id),
        group ? title : undefined,
      );
      onCreated(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Start a conversation" onClose={onClose}>
      <p className="muted modal-intro">
        A familiar face, or the start of something new.
      </p>
      <div className="segmented">
        <button
          className={!group ? "selected" : ""}
          onClick={() => {
            setGroup(false);
            setSelected([]);
          }}
        >
          <MessageCircle size={16} /> One to one
        </button>
        <button
          className={group ? "selected" : ""}
          onClick={() => {
            setGroup(true);
            setSelected([]);
          }}
        >
          <Users size={16} /> A circle
        </button>
      </div>
      {group && (
        <p className="muted">
          Selected people receive invitations. They join after accepting.
        </p>
      )}
      {group && (
        <label className="circle-name">
          Circle name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="e.g. The weekend crew"
          />
        </label>
      )}
      <div className="search-box">
        <Search size={17} />
        <input
          aria-label="Find people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a name or username…"
          autoComplete="off"
        />
      </div>
      <div className="people-list">
        {loading ? (
          <div className="loading-row">
            <Spinner /> Finding people
          </div>
        ) : people.length === 0 ? (
          <div className="empty-small">
            No people found. Invite a friend to create an account.
          </div>
        ) : (
          people.map((p) => (
            <button
              key={p.id}
              className="person-row"
              onClick={() =>
                setSelected((old) =>
                  old.some((s) => s.id === p.id)
                    ? old.filter((s) => s.id !== p.id)
                    : group
                      ? [...old, p].slice(0, 19)
                      : [p],
                )
              }
            >
              <Avatar person={p} />
              <span>
                <strong>{p.display_name}</strong>
                <small>@{p.username}</small>
              </span>
              <span
                className={`select-circle ${selected.some((s) => s.id === p.id) ? "checked" : ""}`}
              >
                {selected.some((s) => s.id === p.id) && <Check size={15} />}
              </span>
            </button>
          ))
        )}
      </div>
      {selected.length > 0 && (
        <div className="selected-people">
          {selected.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                setSelected((old) => old.filter((s) => s.id !== p.id))
              }
            >
              {p.display_name}
              <X size={13} />
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button primary full"
        disabled={busy || !selected.length || (group && !title.trim())}
        onClick={() => void create()}
      >
        {busy ? <Spinner /> : group ? "Create circle" : "Start conversation"}
      </button>
    </Modal>
  );
}
export function MessageEditor({
  message,
  preview,
  onClose,
  onSaved,
}: {
  message: Message;
  preview: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Edit your message" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(preview).edit(message.id, body);
            onSaved();
            onClose();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Message
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            rows={5}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy || !body.trim()}>
          {busy ? <Spinner /> : "Save message"}
        </button>
      </form>
    </Modal>
  );
}
export function Details({
  preview,
  onChanged,
  conversation,
  me,
  onClose,
}: {
  preview: boolean;
  onChanged: () => Promise<void>;
  conversation: Conversation;
  me: string;
  onClose: () => void;
}) {
  const [viewing, setViewing] = useState<Persona | null>(null);
  const other = conversation.members.find((p) => p.id !== me);
  const group = conversation.kind === "group";
  return (
    <aside className="details-panel">
      <div className="details-heading">
        <span>Conversation details</span>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="detail-person">
        <Avatar person={other} group={group} size="xl" />
        <h2>{conversation.title || other?.display_name}</h2>
        <p>
          {group
            ? `${conversation.members.length} people in this circle`
            : `@${other?.username}`}
        </p>
      </div>
      {!group && (
        <div className="detail-section">
          <span className="eyebrow">ABOUT</span>
          <p>{other?.bio || "A little mystery is a good thing."}</p>
        </div>
      )}
      <div className="detail-section">
        <span className="eyebrow">
          {group ? "IN THIS CIRCLE" : "IN THIS CONVERSATION"}
        </span>
        <div className="detail-members">
          {conversation.members.map((p) => (
            <button
              className="member-profile-button"
              key={p.id}
              onClick={() =>
                setViewing({
                  ...p,
                  anonymous: false,
                  song_path: p.song_path || null,
                  song_title: p.song_title || "",
                })
              }
            >
              <Avatar person={p} size="small" />
              <span>
                {p.display_name}
                <small>{p.id === me ? "You" : `@${p.username}`}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      {group && (
        <GroupControls
          key={conversation.id}
          conversation={conversation}
          me={me}
          preview={preview}
          onChanged={onChanged}
        />
      )}
      {!group && (
        <ProfileSong path={other?.song_path} title={other?.song_title} />
      )}
      {viewing && (
        <PersonaViewer persona={viewing} onClose={() => setViewing(null)} />
      )}
      <div className="privacy-note">
        <MessageCircle size={18} />
        <p>
          Just the people here.
          <br />
          <span>Only members can read this conversation.</span>
        </p>
      </div>
    </aside>
  );
}
