import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { errorText } from "./lib/types";
import type { Conversation, GroupInvitation, Profile } from "./lib/types";

export function InvitationInbox({
  preview,
  me,
  onChanged,
}: {
  preview: boolean;
  me: string;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<GroupInvitation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api(preview).invitations();
        if (alive) {
          setItems(data.filter((i) => i.invitee === me));
          setError("");
        }
      } catch {
        if (alive)
          setError("Circle invitations unavailable. Check the database setup.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    const unsub = api(preview).subscribe(() => void load());
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, [preview, me]);
  async function respond(id: string, accept: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(preview).respondInvitation(id, accept);
      setItems((old) => old.filter((i) => i.id !== id));
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="invitation-inbox">
      {items.map((i) => (
        <div className="invitation-card" key={i.id}>
          <strong>{i.title}</strong>
          <p>{i.inviter} invited you to this circle.</p>
          <div className="group-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void respond(i.id, true)}
            >
              Accept
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void respond(i.id, false)}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function GroupControls({
  conversation,
  me,
  preview,
  onChanged,
}: {
  conversation: Conversation;
  me: string;
  preview: boolean;
  onChanged: () => Promise<void>;
}) {
  const role = conversation.members.find((m) => m.id === me)?.role || "member";
  const canManage = role === "owner" || role === "admin";
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [pending, setPending] = useState<GroupInvitation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    person: string;
    action: string;
    name: string;
  } | null>(null);
  async function loadInvites() {
    const all = await api(preview).invitations();
    setPending(all.filter((i) => i.conversation_id === conversation.id));
  }
  useEffect(() => {
    setError("");
    setConfirm(null);
    if (!canManage) {
      setPending([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const all = await api(preview).invitations();
        if (alive)
          setPending(all.filter((i) => i.conversation_id === conversation.id));
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    const unsub = api(preview).subscribe(() => void load());
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, [conversation.id, role, preview]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!canManage || !query.trim()) {
        setPeople([]);
        return;
      }
      void api(preview)
        .searchPeople(query)
        .then((data) => {
          if (alive)
            setPeople(
              data.filter(
                (p) =>
                  !conversation.members.some((m) => m.id === p.id) &&
                  !pending.some((i) => i.invitee === p.id),
              ),
            );
        })
        .catch((e) => {
          if (alive) setError(errorText(e));
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, preview, conversation, pending, canManage]);
  async function run(person: string, action: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "invite")
        await api(preview).inviteGroup(conversation.id, person);
      else await api(preview).manageGroup(conversation.id, person, action);
      setConfirm(null);
      setQuery("");
      setNotice(
        action === "invite"
          ? "Invitation sent. They can join after accepting."
          : "Circle updated.",
      );
      await onChanged();
      if (action !== "leave" && action !== "transfer") await loadInvites();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-section group-controls">
      <span className="eyebrow">CIRCLE MANAGEMENT · {role.toUpperCase()}</span>
      {preview && (
        <p className="muted">
          Preview changes stay in this browser. Invitations reach other accounts
          after connecting Supabase.
        </p>
      )}
      {canManage && (
        <>
          <label>
            Invite a person
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or username"
              disabled={busy}
            />
          </label>
          {people.map((p) => (
            <div className="group-management-row" key={p.id}>
              <span>
                {p.display_name} <small>@{p.username}</small>
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(p.id, "invite")}
              >
                Invite
              </button>
            </div>
          ))}
          {pending.length > 0 && (
            <>
              <h3>Pending invitations</h3>
              {pending.map((i) => (
                <div className="group-management-row" key={i.id}>
                  <span>{i.name}</span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        person: i.invitee,
                        action: "revoke",
                        name: i.name,
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {conversation.members.map((m) => (
        <div className="group-management-row" key={m.id}>
          <span>
            {m.display_name}
            <small>{m.role || "member"}</small>
          </span>
          <div className="group-actions">
            {role === "owner" && m.id !== me && (
              <>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      person: m.id,
                      action: m.role === "admin" ? "demote" : "promote",
                      name: m.display_name,
                    })
                  }
                >
                  {m.role === "admin" ? "Remove admin" : "Make admin"}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      person: m.id,
                      action: "transfer",
                      name: m.display_name,
                    })
                  }
                >
                  Make owner
                </button>
              </>
            )}
            {canManage &&
              m.id !== me &&
              m.role !== "owner" &&
              (role === "owner" || m.role !== "admin") && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      person: m.id,
                      action: "remove",
                      name: m.display_name,
                    })
                  }
                >
                  Remove member
                </button>
              )}
          </div>
        </div>
      ))}
      {role !== "owner" ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            setConfirm({ person: me, action: "leave", name: "you" })
          }
        >
          Leave circle
        </button>
      ) : (
        <p className="muted">
          Transfer ownership to another member before leaving.
        </p>
      )}
      {confirm && (
        <div className="invitation-card">
          <p>
            {confirm.action === "transfer"
              ? `Transfer ownership to ${confirm.name}? You will become an admin.`
              : confirm.action === "remove"
                ? `Remove ${confirm.name}? They will lose access to this circle.`
                : confirm.action === "leave"
                  ? "Leave this circle? You will lose access to its messages."
                  : `${confirm.action === "promote" ? "Make admin" : confirm.action === "demote" ? "Remove admin role from" : "Revoke invitation for"} ${confirm.name}?`}
          </p>
          <div className="group-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run(confirm.person, confirm.action)}
            >
              Confirm
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
