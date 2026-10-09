import { createPreviewConnection } from "./demo";
import type {
  FeedbackCategory,
  RandomConnection,
  ConnectionDecision,
} from "./randomExperience";
import { supabase } from "./supabase";
import { commonInterests, normalizeInterests } from "./interests";
import type { Interest } from "./interests";
import type { Color } from "./types";
export type Persona = {
  interests?: Interest[];
  display_name: string;
  bio: string;
  color: Color;
  anonymous: boolean;
  username?: string;
  song_path: string | null;
  song_title: string;
};
export type Personas = { normal: Persona; anonymous: Persona };
export type RandomMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export type RandomState = {
  status: "idle" | "waiting" | "matched" | "ended";
  session_id?: string;
  self_id?: string;
  self_profile?: Persona;
  peer?: Persona & { id: string };
  started_at?: string;
  ended_at?: string | null;
  feedback_done?: boolean;
  search_interests?: Interest[];
  shared_only?: boolean;
  connection?: RandomConnection;
  peer_connection?: "active" | "reconnecting" | "ended";
  peer_grace_seconds?: number;
  end_reason?: "left" | "connection_lost" | null;
  ended_by_you?: boolean | null;
};
export async function call<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("Connect Supabase to use the live workspace.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}
const defaultPersonas: Personas = {
  normal: {
    display_name: "Alex Morgan",
    bio: "Making room for good conversations.",
    color: "fern",
    anonymous: false,
    song_path: null,
    song_title: "",
  },
  anonymous: {
    display_name: "Quiet comet",
    bio: "Late-night thoughts, indie music, and a good mountain trail.",
    color: "lavender",
    anonymous: true,
    song_path: null,
    song_title: "",
  },
};
const STORE = "kindred-discover-v1";
type DemoData = {
  personas: Personas;
  state: RandomState;
  messages: RandomMessage[];
  seen: number[];
  ratings: number[];
  blocked?: number[];
  votes?: Record<number, number>;
  peerIndex?: number;
  peerAwayAt?: number;
};
function read(): DemoData {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* An in-memory preview works without storage. */
  }
  return {
    personas: structuredClone(defaultPersonas),
    state: { status: "idle" },
    messages: [],
    seen: [],
    ratings: [],
  };
}
let fallback: DemoData | null = null;
function data() {
  return fallback || read();
}
function write(d: DemoData) {
  fallback = d;
  try {
    localStorage.setItem(STORE, JSON.stringify(d));
  } catch {
    /* Session-only fallback. */
  }
  window.dispatchEvent(new Event("kindred-discover"));
}
const demoPeers = [
  {
    display_name: "Velvet moon",
    bio: "Dream pop, rainy windows, and conversations that wander.",
    color: "rose",
    anonymous: true,
    score: 4.4,
    interests: ["Music", "Art", "Books", "Movies", "indie music"],
  },
  {
    display_name: "Forest echo",
    bio: "Trail walks. Old records. Big questions with no right answer.",
    color: "fern",
    anonymous: true,
    score: 3.3,
    interests: ["Outdoors", "Science", "Philosophy", "Music", "astronomy"],
  },
  {
    display_name: "Nina Patel",
    username: "nina",
    bio: "Small adventures, bigger playlists. Tell me something unexpected.",
    color: "amber",
    anonymous: false,
    score: 4.8,
    interests: ["Travel", "Food", "Photography", "Gaming", "Anime"],
  },
] as const;
export const discovery = (preview: boolean) => ({
  personas: async (): Promise<Personas> => {
    if (!preview) return call("my_personas");
    const d = data();
    try {
      const base = JSON.parse(
        localStorage.getItem("kindred-preview-v1") || "null",
      );
      const me = base?.profiles.find((p: { id: string }) => p.id === "demo-me");
      if (me)
        d.personas.normal = { ...d.personas.normal, ...me, anonymous: false };
    } catch {
      /* Optional preview profile. */
    }
    return d.personas;
  },
  savePersona: async (anonymous: boolean, p: Persona) => {
    if (!preview)
      return call<void>("save_persona", {
        anon_mode: anonymous,
        new_name: p.display_name,
        new_bio: p.bio,
        new_color: p.color,
        new_song_path: p.song_path,
        new_song_title: p.song_title,
      });
    const d = data();
    d.personas[anonymous ? "anonymous" : "normal"] = p;
    write(d);
    if (!anonymous) {
      try {
        const base = JSON.parse(
          localStorage.getItem("kindred-preview-v1") || "null",
        );
        if (base) {
          Object.assign(
            base.profiles.find((x: { id: string }) => x.id === "demo-me"),
            p,
          );
          localStorage.setItem("kindred-preview-v1", JSON.stringify(base));
          window.dispatchEvent(new Event("kindred-demo"));
        }
      } catch {
        /* Preview data is optional. */
      }
    }
  },
  state: async (): Promise<RandomState> => {
    if (!preview) return call("random_state");
    const d = data();
    if (d.state.status === "matched" && d.peerAwayAt) {
      const remaining = Math.max(
        0,
        120 - Math.floor((Date.now() - d.peerAwayAt) / 1000),
      );
      d.state = {
        ...d.state,
        peer_connection: "reconnecting",
        peer_grace_seconds: remaining,
      };
      if (!remaining) {
        d.state = {
          ...d.state,
          status: "ended",
          peer_connection: "ended",
          end_reason: "connection_lost",
          ended_at: new Date().toISOString(),
        };
        d.peerAwayAt = undefined;
        write(d);
      }
    }
    return d.state;
  },
  heartbeat: async (): Promise<void> => {
    if (!preview) await call("random_heartbeat");
  },
  connect: async (
    session: string,
    decision: ConnectionDecision,
  ): Promise<RandomConnection> => {
    if (!preview) return call("connect_random", { session, decision });
    const d = data();
    if (
      d.state.session_id !== session ||
      !["matched", "ended"].includes(d.state.status)
    )
      throw new Error("Conversation unavailable");
    const c = d.state.connection || {
      self: "none",
      peer: "none",
      conversation_id: null,
    };
    if (c.conversation_id) return c;
    if (c.self === "declined" || c.peer === "declined")
      throw new Error("This connection request was declined");
    d.state.connection = { ...c, self: decision };
    write(d);
    return d.state.connection;
  },
  simulateAcceptance: async (session: string): Promise<void> => {
    if (!preview) throw new Error("Only available in the simulated preview");
    const d = data();
    if (
      d.state.session_id !== session ||
      d.state.connection?.self !== "accepted"
    )
      throw new Error("Request a connection first");
    const peer = d.state.peer!;
    const conversation = createPreviewConnection({
      id: `preview-connection-${d.peerIndex}`,
      display_name: peer.anonymous ? "Riley Harper" : peer.display_name,
      username: peer.anonymous
        ? "riley_preview"
        : peer.username || "preview_friend",
      color: peer.color,
      bio: "Fictional connection created only in this browser.",
    });
    d.state.connection = {
      self: "accepted",
      peer: "accepted",
      conversation_id: conversation,
    };
    write(d);
  },
  simulatePresence: async (away: boolean): Promise<void> => {
    if (!preview) throw new Error("Only available in the simulated preview");
    const d = data();
    if (d.state.status !== "matched") return;
    d.peerAwayAt = away ? Date.now() : undefined;
    d.state = {
      ...d.state,
      peer_connection: away ? "reconnecting" : "active",
      peer_grace_seconds: 120,
    };
    write(d);
  },
  join: async (
    anonymous: boolean,
    interests: Interest[] = [],
    sharedOnly = false,
  ): Promise<RandomState> => {
    const selected = normalizeInterests(interests);
    if (!preview)
      return call("join_random", {
        anon_mode: anonymous,
        interests: selected,
        shared_only: sharedOnly,
      });
    const d = data();
    if (d.state.status === "matched" || d.state.status === "ended")
      return d.state;
    let candidates = demoPeers
      .map((p, i) => ({ ...p, i }))
      .filter(
        (p) =>
          !d.seen.includes(p.i) &&
          !d.blocked?.includes(p.i) &&
          (!sharedOnly || commonInterests(selected, p.interests).length > 0),
      );
    if (!candidates.length) {
      d.seen = [];
      candidates = demoPeers
        .map((p, i) => ({ ...p, i }))
        .filter(
          (p) =>
            !d.blocked?.includes(p.i) &&
            (!sharedOnly || commonInterests(selected, p.interests).length > 0),
        );
    }
    if (!candidates.length) {
      d.state = {
        status: "waiting",
        search_interests: selected,
        shared_only: sharedOnly,
      };
      write(d);
      return d.state;
    }
    const score = 3.5;
    const peerScore = (p: (typeof candidates)[number]) =>
      (p.score * 5 + (d.votes?.[p.i] || p.score)) / 6;
    candidates.sort(
      (a, b) =>
        commonInterests(selected, b.interests).length -
          commonInterests(selected, a.interests).length ||
        Math.abs(peerScore(a) - score) - Math.abs(peerScore(b) - score),
    );
    const p = candidates[0];
    d.seen.push(p.i);
    d.peerIndex = p.i;
    d.state = {
      status: "matched",
      session_id: crypto.randomUUID(),
      self_id: crypto.randomUUID(),
      self_profile: {
        ...structuredClone(d.personas[anonymous ? "anonymous" : "normal"]),
        interests: selected,
      },
      peer: {
        id: crypto.randomUUID(),
        display_name: p.display_name,
        bio: p.bio,
        color: p.color,
        anonymous: p.anonymous,
        interests: [...p.interests],
        song_path: null,
        song_title: "",
      },
      started_at: new Date().toISOString(),
      feedback_done: false,
    };
    d.peerAwayAt = undefined;
    d.state.connection = { self: "none", peer: "none", conversation_id: null };
    d.state.peer_connection = "active";
    d.messages = [
      {
        id: crypto.randomUUID(),
        sender_id: d.state.peer!.id,
        body: "Hey! This is a simulated preview conversation. What’s a song you’ve had on repeat lately?",
        created_at: new Date().toISOString(),
      },
    ];
    write(d);
    return d.state;
  },
  cancel: async () => {
    if (!preview) return call<void>("cancel_random");
    const d = data();
    if (d.state.status === "waiting") {
      d.state = { status: "idle" };
      write(d);
    }
  },
  end: async (session: string) => {
    if (!preview) return call<void>("end_random", { session });
    const d = data();
    if (d.state.session_id === session) {
      d.state = {
        ...d.state,
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: "left",
        ended_by_you: true,
      };
      write(d);
    }
  },
  rate: async (
    session: string,
    rating: number | null,
    block: boolean,
    category: FeedbackCategory = "general",
  ) => {
    if (!preview)
      return call<void>("submit_random_feedback", {
        session,
        rating,
        category,
        block_peer: block,
      });
    const d = data();
    if (d.state.session_id !== session || d.state.status !== "ended")
      throw new Error("End the conversation before rating.");
    const effective = ["harassment", "spam", "inappropriate"].includes(category)
      ? 1
      : rating;
    if (
      effective &&
      d.peerIndex !== undefined &&
      !["not_vibe", "technical"].includes(category)
    ) {
      d.votes ||= {};
      d.votes[d.peerIndex] = effective;
    }
    if (block && d.peerIndex !== undefined) {
      d.blocked ||= [];
      d.blocked.push(d.peerIndex);
    }
    d.state = { status: "idle" };
    d.messages = [];
    write(d);
  },
  history: async (
    session: string,
    before?: RandomMessage,
  ): Promise<RandomMessage[]> =>
    preview
      ? (data().state.session_id === session ? data().messages : [])
          .filter(
            (m) =>
              !before ||
              m.created_at < before.created_at ||
              (m.created_at === before.created_at && m.id < before.id),
          )
          .sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          )
          .slice(-100)
      : call("random_history", {
          session,
          before_time: before?.created_at || null,
          before_id: before?.id || null,
        }),
  send: async (session: string, id: string, body: string) => {
    if (!preview)
      return call<void>("send_random", {
        session,
        message_id: id,
        message_body: body,
      });
    const d = data();
    if (d.state.status !== "matched" || d.state.session_id !== session)
      throw new Error("This conversation has ended.");
    if (d.messages.some((m) => m.id === id)) return;
    d.messages.push({
      id,
      sender_id: d.state.self_id!,
      body,
      created_at: new Date().toISOString(),
    });
    write(d);
    setTimeout(() => {
      const latest = data();
      if (
        latest.state.session_id !== session ||
        latest.state.status !== "matched"
      )
        return;
      latest.messages.push({
        id: crypto.randomUUID(),
        sender_id: latest.state.peer!.id,
        body: "I like that. In the live workspace, this is where a real person would reply. Try opening my profile or meeting someone new.",
        created_at: new Date().toISOString(),
      });
      write(latest);
    }, 1100);
  },
  subscribe: (
    userId: string,
    fn: () => void,
    onConnection?: (
      status: "connecting" | "connected" | "reconnecting",
    ) => void,
  ) => {
    if (preview) {
      onConnection?.("connected");
      window.addEventListener("kindred-discover", fn);
      return () => window.removeEventListener("kindred-discover", fn);
    }
    onConnection?.("connecting");
    let disposed = false;
    const c = supabase!
      .channel(`discover:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "random_changed" }, fn)
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          onConnection?.("connected");
          fn();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status))
          onConnection?.("reconnecting");
      });
    return () => {
      disposed = true;
      void supabase!.removeChannel(c);
    };
  },
});
function audioDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("kindred-music", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("tracks");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Audio storage is unavailable in this browser."));
  });
}
export async function uploadSong(
  file: File,
  preview: boolean,
): Promise<string> {
  if (file.size > 10 * 1024 * 1024 || file.size < 16)
    throw new Error("Choose an audio file smaller than 10 MB.");
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  };
  if (!ext || !types[ext])
    throw new Error("Choose an MP3, OGG, WAV, or M4A file.");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const tag = String.fromCharCode(...bytes);
  const valid =
    ext === "mp3"
      ? tag.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224)
      : ext === "ogg"
        ? tag.startsWith("OggS")
        : ext === "wav"
          ? tag.startsWith("RIFF") && tag.slice(8, 12) === "WAVE"
          : tag.slice(4, 8) === "ftyp";
  if (!valid)
    throw new Error("This file does not look like a supported audio track.");
  const path = `${crypto.randomUUID()}.${ext}`;
  if (preview) {
    const db = await audioDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").put(file, path);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error("Could not save this audio file."));
      };
    });
    return `demo:${path}`;
  }
  const { error } = await supabase!.storage
    .from("profile-music")
    .upload(path, file, { contentType: types[ext], upsert: false });
  if (error) throw error;
  return path;
}
export async function songURL(path: string): Promise<string> {
  if (!path.startsWith("demo:"))
    return supabase!.storage.from("profile-music").getPublicUrl(path).data
      .publicUrl;
  const db = await audioDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction("tracks")
      .objectStore("tracks")
      .get(path.slice(5));
    req.onsuccess = () => {
      db.close();
      if (req.result) resolve(URL.createObjectURL(req.result));
      else reject(new Error("This preview song is no longer on this device."));
    };
    req.onerror = () => {
      db.close();
      reject(new Error("Could not load this track."));
    };
  });
}
