import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Paperclip, RefreshCw, Upload } from "lucide-react";
import { Modal, Spinner } from "./components";
import { supabase } from "./lib/supabase";
import { FILE_ACCEPT, fileInfo, fileSize } from "./lib/files";
import { errorText } from "./lib/types";
import type { Message } from "./lib/types";

const bucket = () => {
  if (!supabase) throw new Error("Sign in to share files.");
  return supabase.storage.from("chat-files");
};

export function AttachmentView({
  attachment,
}: {
  attachment: NonNullable<Message["attachment"]>;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { path, name, mime, size } = attachment;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl("");
    setError("");
    void bucket()
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setError("File unavailable. Try again or check your access.");
        else setUrl(data.signedUrl);
      })
      .catch(() => {
        if (active) setError("Could not load this file.");
      });
    return () => {
      active = false;
    };
  }, [path, version]);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await bucket().download(path);
      if (error) throw error;
      const objectUrl = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch {
      setError("Download failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment-card">
      {url && mime.startsWith("image/") && (
        <img
          className="attachment-image"
          src={url}
          alt={name}
          loading="lazy"
          onError={() =>
            setError("Preview expired or unavailable. Reload it below.")
          }
        />
      )}
      {url && mime.startsWith("video/") && (
        <video
          className="attachment-video"
          src={url}
          controls
          preload="metadata"
          playsInline
          onError={() =>
            setError(
              "This browser cannot play the preview. You can download the file.",
            )
          }
        />
      )}
      {url && mime.startsWith("audio/") && (
        <audio
          className="attachment-audio"
          src={url}
          controls
          preload="metadata"
          onError={() =>
            setError(
              "This browser cannot play the preview. You can download the file.",
            )
          }
        />
      )}
      <div className="attachment-info">
        <FileText size={18} />
        <span>
          <strong>{name}</strong>
          <small>{fileSize(size)}</small>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Download ${name}`}
          disabled={busy}
          onClick={() => void download()}
        >
          {busy ? <Spinner /> : <Download size={18} />}
        </button>
      </div>
      {!url && !error && <small role="status">Loading file…</small>}
      {error && (
        <div className="attachment-error" role="status">
          {error}{" "}
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw size={13} /> Reload
          </button>
        </div>
      )}
    </div>
  );
}

export function AttachmentComposer({
  conversation,
  userId,
  preview,
  onSent,
  replyTo,
}: {
  conversation: string;
  userId: string;
  preview: boolean;
  onSent: (message: Message) => void;
  replyTo?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [localPreview, setLocalPreview] = useState("");
  const staged = useRef<{
    path: string;
    id: string;
    target?: string | null;
  } | null>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const discard = useCallback(() => {
    const old = staged.current;
    staged.current = null;
    if (old && supabase)
      void bucket()
        .remove([old.path])
        .catch(() => {});
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!sending.current) discard();
    };
  }, [discard]);
  useEffect(() => {
    if (
      !file ||
      !file.type.startsWith("image/") ||
      file.type === "image/svg+xml"
    ) {
      setLocalPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function close() {
    if (sending.current) return;
    discard();
    setOpen(false);
    setFile(null);
    setCaption("");
    setError("");
  }
  async function send() {
    if (!file || sending.current || preview || !supabase) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const info = fileInfo(file);
      if (!staged.current) {
        setPhase("Uploading file…");
        const path = `${conversation}/${userId}/${crypto.randomUUID()}`;
        const { error } = await bucket().upload(path, file, {
          contentType: info.mime,
          upsert: false,
          cacheControl: "60",
        });
        if (error) throw error;
        staged.current = { path, id: crypto.randomUUID(), target: replyTo };
      }
      if (!mounted.current) {
        discard();
        return;
      }
      setPhase("Sending file…");
      const { data, error } = await supabase.rpc(
        staged.current.target ? "send_reply_attachment" : "send_attachment",
        {
          conversation,
          message_id: staged.current.id,
          object_path: staged.current.path,
          file_name: info.name,
          caption,
          ...(staged.current.target ? { target: staged.current.target } : {}),
        },
      );
      if (error) throw error;
      staged.current = null;
      if (mounted.current) {
        onSent(data as Message);
        setOpen(false);
        setFile(null);
        setCaption("");
      }
    } catch (e) {
      if (mounted.current) {
        const message = errorText(e);
        setError(
          /bucket.*not found|send_attachment/i.test(message)
            ? "File sharing needs the Supabase multimedia update. Ask the project owner to apply it."
            : message,
        );
      } else discard();
    } finally {
      sending.current = false;
      if (mounted.current) {
        setBusy(false);
        setPhase("");
      }
    }
  }
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Attach a file"
        onClick={() => setOpen(true)}
      >
        <Paperclip size={21} />
      </button>
      {open &&
        createPortal(
          <Modal title="Share a file" onClose={close}>
            <p className="muted">
              Images, video, audio, PDFs, text, and Office documents. Up to 20
              MB per file.
            </p>
            {preview && (
              <p className="attachment-error">
                Sign in to share files with your conversations.
              </p>
            )}
            <label className="file-picker">
              <Upload size={22} />
              <span>{file ? file.name : "Choose a file"}</span>
              <input
                type="file"
                aria-label="Choose a file to share"
                accept={FILE_ACCEPT}
                disabled={busy || Boolean(staged.current)}
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  setError("");
                  if (!chosen) return;
                  try {
                    fileInfo(chosen);
                    setFile(chosen);
                  } catch (error) {
                    setFile(null);
                    setError(errorText(error));
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {localPreview && (
              <img
                className="file-draft-preview"
                src={localPreview}
                alt="Selected file preview"
              />
            )}
            {file && (
              <p className="muted">
                {fileSize(file.size)} · Shared only with members of this
                conversation.
              </p>
            )}
            <label className="attachment-caption">
              Caption (optional)
              <textarea
                maxLength={4000}
                value={caption}
                disabled={busy || Boolean(staged.current)}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
              />
            </label>
            {error && (
              <p className="attachment-error" role="alert">
                {error}
              </p>
            )}
            {busy && <p role="status">{phase}</p>}
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!file || busy || preview}
                onClick={() => void send()}
              >
                {busy ? (
                  <Spinner />
                ) : staged.current ? (
                  "Retry send"
                ) : (
                  "Send file"
                )}
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
