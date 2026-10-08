import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Music2,
  Pause,
  Play,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { Avatar, Modal, Spinner } from "./components";
import { colors, errorText } from "./lib/types";
import { discovery, songURL, uploadSong } from "./lib/discover";
import type { Persona, Personas } from "./lib/discover";
export function ProfileSong({
  path,
  title,
}: {
  path: string | null | undefined;
  title: string | undefined;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let url = "";
    setSrc("");
    setError("");
    setPlaying(false);
    if (path)
      void songURL(path)
        .then((value) => {
          url = value;
          if (alive) setSrc(value);
          else if (value.startsWith("blob:")) URL.revokeObjectURL(value);
        })
        .catch((e) => {
          if (alive) setError(errorText(e));
        });
    return () => {
      alive = false;
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [path]);
  useEffect(() => {
    if (!src || !audio.current) return;
    audio.current.volume = 0.45;
    void audio.current.play().catch(() => setPlaying(false));
  }, [src]);
  if (!path) return null;
  return (
    <div className="profile-song">
      <span className={`record ${playing ? "playing" : ""}`}>
        <Music2 size={20} />
      </span>
      <div>
        <small>ON REPEAT</small>
        <strong>{title || "A little soundtrack"}</strong>
        <span>
          {error ||
            (playing ? "Playing this profile’s song" : "Press play to listen")}
        </span>
      </div>
      <button
        className="icon-button"
        aria-label={playing ? "Pause profile song" : "Play profile song"}
        disabled={!src}
        onClick={() => {
          if (playing) audio.current?.pause();
          else
            void audio.current
              ?.play()
              .catch(() =>
                setError(
                  "This track could not be played. Try another audio file.",
                ),
              );
        }}
      >
        {playing ? <Pause size={21} /> : <Play size={21} />}
      </button>
      <audio
        ref={audio}
        src={src || undefined}
        loop
        preload="metadata"
        onPlay={() => {
          document.querySelectorAll("audio").forEach((el) => {
            if (el !== audio.current) el.pause();
          });
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onError={() => setError("This audio file could not be loaded.")}
      />
    </div>
  );
}
export function PersonaViewer({
  persona,
  onClose,
}: {
  persona: Persona;
  onClose: () => void;
}) {
  return (
    <Modal title="A little about me" onClose={onClose}>
      <div className={`persona-cover ${persona.anonymous ? "anon" : "named"}`}>
        <span className="persona-badge">
          {persona.anonymous ? <Shield size={13} /> : <Headphones size={13} />}{" "}
          {persona.anonymous ? "Anonymous profile" : "Regular profile"}
        </span>
        <Avatar person={persona} size="xl" />
      </div>
      <div className="persona-bio">
        <h2>{persona.display_name}</h2>
        {!persona.anonymous && persona.username && (
          <span>@{persona.username}</span>
        )}
        <p>{persona.bio || "Still finding the words. Ask me what I’m into."}</p>
      </div>
      <ProfileSong path={persona.song_path} title={persona.song_title} />
      {persona.anonymous && (
        <p className="identity-note">
          A separate profile. No real name, email, phone number, or
          regular-profile link is shared here.
        </p>
      )}
    </Modal>
  );
}
export function PersonaEditor({
  preview,
  onClose,
  onSaved,
}: {
  preview: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [personas, setPersonas] = useState<Personas | null>(null);
  const [mode, setMode] = useState<"normal" | "anonymous">("normal");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const service = discovery(preview);
  useEffect(() => {
    let alive = true;
    void discovery(preview)
      .personas()
      .then((p) => {
        if (alive) setPersonas(p);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [preview]);
  const p = personas?.[mode];
  function patch(values: Partial<Persona>) {
    setNotice("");
    setPersonas((old) =>
      old ? { ...old, [mode]: { ...old[mode], ...values } } : old,
    );
  }
  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const path = await uploadSong(file, preview);
      patch({
        song_path: path,
        song_title: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }
  return (
    <Modal title="Two sides of you" onClose={onClose}>
      <p className="muted modal-intro">
        A different name, bio, and soundtrack for each side.
      </p>
      <div className="segmented">
        <button
          disabled={uploading || busy}
          aria-pressed={mode === "normal"}
          className={mode === "normal" ? "selected" : ""}
          onClick={() => {
            setMode("normal");
            setNotice("");
          }}
        >
          Regular profile
        </button>
        <button
          disabled={uploading || busy}
          aria-pressed={mode === "anonymous"}
          className={mode === "anonymous" ? "selected" : ""}
          onClick={() => {
            setMode("anonymous");
            setNotice("");
          }}
        >
          <Shield size={15} /> Anonymous
        </button>
      </div>
      {!p && !error ? (
        <div className="loading-row">
          <Spinner /> Opening your profiles
        </div>
      ) : (
        p && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await service.savePersona(mode === "anonymous", p);
                onSaved();
                setNotice(
                  `${mode === "anonymous" ? "Anonymous" : "Regular"} profile saved. Changes apply to your next random conversation.`,
                );
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="profile-preview">
              <Avatar person={p} size="xl" />
              <span>
                {mode === "anonymous"
                  ? "Only this identity is shown in anonymous chats."
                  : "Shown in regular chats and your people directory."}
              </span>
            </div>
            <div className="color-picker" aria-label="Avatar color">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch ${color}`}
                  aria-label={`${color} avatar`}
                  aria-pressed={p.color === color}
                  onClick={() => patch({ color })}
                >
                  {p.color === color ? "✓" : ""}
                </button>
              ))}
            </div>
            <label>
              {mode === "anonymous" ? "Your alias" : "Your name"}
              <input
                required
                maxLength={40}
                value={p.display_name}
                onChange={(e) => patch({ display_name: e.target.value })}
              />
            </label>
            <label>
              Your likes, interests & vibes
              <textarea
                rows={3}
                maxLength={160}
                value={p.bio}
                onChange={(e) => patch({ bio: e.target.value })}
                placeholder="Indie music, midnight walks, big ideas…"
              />
            </label>
            <div className="song-setting">
              <div>
                <Music2 size={18} />
                <strong>Your profile song</strong>
              </div>
              <p>Plays when someone opens this profile.</p>
              <label className="audio-upload">
                <Upload size={17} />
                {uploading
                  ? "Uploading…"
                  : p.song_path
                    ? "Replace audio file"
                    : "Choose an audio file"}
                <input
                  type="file"
                  accept=".mp3,.ogg,.wav,.m4a"
                  aria-label="Upload profile song"
                  disabled={uploading || busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <small>MP3, OGG, WAV or M4A · Up to 10 MB</small>
              {p.song_path && (
                <>
                  <label>
                    Song title
                    <input
                      maxLength={80}
                      value={p.song_title}
                      onChange={(e) => patch({ song_title: e.target.value })}
                    />
                  </label>
                  <ProfileSong
                    key={mode + p.song_path}
                    path={p.song_path}
                    title={p.song_title}
                  />
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => patch({ song_path: null, song_title: "" })}
                  >
                    <X size={13} /> Remove from profile
                  </button>
                </>
              )}
            </div>
            {notice && (
              <p className="form-success" role="status">
                {notice}
              </p>
            )}
            <button
              className="button primary full"
              disabled={busy || uploading || !p.display_name.trim()}
            >
              {busy ? (
                <Spinner />
              ) : (
                `Save ${mode === "anonymous" ? "anonymous" : "regular"} profile`
              )}
            </button>
          </form>
        )
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
