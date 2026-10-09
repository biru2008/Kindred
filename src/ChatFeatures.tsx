import { useState } from "react";
import { Pin, Reply, X } from "lucide-react";
import type { ChatFeatures, Conversation, Message } from "./lib/types";
import { REACTIONS } from "./lib/types";
import { Modal } from "./components";
import { AttachmentView } from "./Attachments";

export const emptyFeatures: ChatFeatures = {
  reactions: [],
  replies: [],
  pins: [],
};
export function canPin(c: Conversation, me: string) {
  return (
    c.kind === "direct" ||
    c.members.some(
      (p) => p.id === me && (p.role === "owner" || p.role === "admin"),
    )
  );
}
export function QuotedMessage({
  message,
  conversation,
  onOpen,
}: {
  message: Message;
  conversation: Conversation;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="quoted-message"
      onClick={onOpen}
      disabled={!onOpen}
    >
      <Reply size={14} />
      <span>
        <strong>
          {conversation.members.find((p) => p.id === message.sender_id)
            ?.display_name || "Former member"}
        </strong>
        <small>{message.deleted_at ? "Message deleted" : message.body}</small>
      </span>
    </button>
  );
}
export function ReactionBar({
  message,
  user,
  features,
  busy,
  onReact,
}: {
  message: Message;
  user: string;
  features: ChatFeatures;
  busy: boolean;
  onReact: (emoji: string, enabled: boolean) => void;
}) {
  const entries = features.reactions.filter((r) => r.message_id === message.id);
  if (message.deleted_at || message.status || !entries.length) return null;
  return (
    <div className="reaction-bar" aria-label="Message reactions">
      {REACTIONS.map((emoji) => {
        const votes = entries.filter((r) => r.emoji === emoji);
        if (!votes.length) return null;
        const mine = votes.some((r) => r.user_id === user);
        return (
          <button
            type="button"
            key={emoji}
            className={mine ? "reacted" : ""}
            aria-pressed={mine}
            aria-label={`${emoji}: ${votes.length} reaction${votes.length === 1 ? "" : "s"}${mine ? ", remove your reaction" : ", add your reaction"}`}
            disabled={busy}
            onClick={() => onReact(emoji, !mine)}
          >
            {emoji} <span>{votes.length}</span>
          </button>
        );
      })}
    </div>
  );
}
export function PinnedMessages({
  features,
  conversation,
  canManage,
  busy,
  onPin,
  onOpen,
}: {
  features: ChatFeatures;
  conversation: Conversation;
  canManage: boolean;
  busy: boolean;
  onPin: (m: Message, enabled: boolean) => void;
  onOpen: (m: Message) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={`Pinned messages (${features.pins.length})`}
        onClick={() => setOpen(true)}
      >
        <Pin size={19} />
        {features.pins.length > 0 && <small>{features.pins.length}</small>}
      </button>
      {open && (
        <Modal title="Pinned messages" onClose={() => setOpen(false)}>
          <p className="muted">
            Shared with this conversation.{" "}
            {canManage
              ? "You can pin up to 20 messages."
              : "Only circle owners and admins can change pins."}
          </p>
          <div className="pin-list">
            {!features.pins.length && (
              <p>No pinned messages yet. Use a message’s actions to pin it.</p>
            )}
            {features.pins.map((m) => (
              <div className="pin-item" key={m.id}>
                <QuotedMessage
                  message={m}
                  conversation={conversation}
                  onOpen={() => {
                    setOpen(false);
                    onOpen(m);
                  }}
                />
                {canManage && (
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy}
                    aria-label="Unpin message"
                    onClick={() => onPin(m, false)}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
export function MessagePeek({
  message,
  conversation,
  onClose,
  onJump,
}: {
  message: Message;
  conversation: Conversation;
  onClose: () => void;
  onJump: () => boolean;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <Modal title="Original message" onClose={onClose}>
      <p className="muted">
        {conversation.members.find((p) => p.id === message.sender_id)
          ?.display_name || "Former member"}{" "}
        · {new Date(message.created_at).toLocaleString()}
      </p>
      {!message.deleted_at && message.attachment && (
        <AttachmentView attachment={message.attachment} />
      )}
      <p className="peek-body">
        {message.deleted_at ? "Message deleted" : message.body}
      </p>
      <button
        className="button secondary"
        onClick={() => {
          if (onJump()) onClose();
          else setMissing(true);
        }}
      >
        Jump to message
      </button>
      {missing && (
        <p role="status" className="muted">
          This message is outside the loaded history. Close this window and load
          earlier messages to reach it.
        </p>
      )}
    </Modal>
  );
}
