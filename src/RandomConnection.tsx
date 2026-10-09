import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Modal, Spinner } from "./components";
import type { RandomState } from "./lib/discover";
import type { ConnectionDecision } from "./lib/randomExperience";
export function RandomConnectionPanel({
  state,
  busy,
  preview,
  onDecision,
  onOpen,
  onSimulate,
}: {
  state: RandomState;
  busy: boolean;
  preview: boolean;
  onDecision: (d: ConnectionDecision) => Promise<boolean>;
  onOpen: () => void;
  onSimulate: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const c = state.connection;
  const declined = c?.self === "declined" || c?.peer === "declined";
  const accepted = Boolean(c?.conversation_id);
  return (
    <section className="random-connection-card">
      <h3>
        <UserPlus size={18} /> Keep the connection
      </h3>
      {accepted ? (
        <>
          <p>
            You both agreed to connect. Your regular profiles are now linked in
            a private DM.
          </p>
          <button className="button primary" disabled={busy} onClick={onOpen}>
            Open private DM
          </button>
          <small>
            Opening the DM ends this random chat. Its history stays separate.
          </small>
        </>
      ) : declined ? (
        <p>
          This connection request is closed. You can continue this conversation
          without connecting.
        </p>
      ) : c?.self === "accepted" ? (
        <>
          <p>
            Request sent. Your regular identity stays separate until the other
            person agrees.
          </p>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void onDecision("none")}
          >
            Cancel request
          </button>
          {preview && (
            <button
              className="button secondary preview-simulation"
              disabled={busy}
              onClick={onSimulate}
            >
              Preview: simulate partner acceptance
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            {c?.peer === "accepted"
              ? "Your partner wants to continue in a private DM. Accepting will link your regular profiles."
              : "Enjoying this conversation? Continue in a DM if you both agree to share your regular profiles."}
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            {c?.peer === "accepted"
              ? "Review & accept request"
              : "Request connection"}
          </button>
          {c?.peer === "accepted" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void onDecision("declined")}
            >
              Decline
            </button>
          )}
        </>
      )}
      {!accepted && !declined && (
        <small>
          Unaccepted requests close when either person finishes feedback and
          moves on.
        </small>
      )}
      {confirm && (
        <Modal
          title="Connect outside this chat?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            This links your anonymous identity, if used, to your regular profile
            for this person <strong>only after both people agree</strong>.
          </p>
          <p>
            Your regular display name, username, bio, and profile song will be
            available in the DM. Email addresses remain hidden. Random-chat
            history is not copied.
          </p>
          <p className="muted">
            Once both people agree, you cannot undo information already
            revealed.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Stay here
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (await onDecision("accepted")) setConfirm(false);
              }}
            >
              {busy ? <Spinner /> : "Agree & request connection"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
