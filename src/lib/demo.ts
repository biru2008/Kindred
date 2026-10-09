import type { Conversation, Message, Profile, GroupInvitation } from "./types";
import { validMessage } from "./types";
const KEY = "kindred-preview-v1";
export const demoUser: Profile = {
  id: "demo-me",
  display_name: "Alex Morgan",
  username: "alex",
  color: "fern",
  bio: "Making room for good conversations.",
};
type Data = {
  profiles: Profile[];
  conversations: Conversation[];
  messages: Message[];
  invitations?: GroupInvitation[];
};
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60000).toISOString();
function seed(): Data {
  const profiles: Profile[] = [
    demoUser,
    {
      id: "maya",
      display_name: "Maya Chen",
      username: "maya",
      color: "lavender",
      bio: "Designing things. Finding new trails.",
    },
    {
      id: "arjun",
      display_name: "Arjun Mehta",
      username: "arjun",
      color: "peach",
      bio: "Code, coffee, and a good playlist.",
    },
    {
      id: "zoe",
      display_name: "Zoe Park",
      username: "zoe",
      color: "rose",
      bio: "Always taking the scenic route.",
    },
    {
      id: "leo",
      display_name: "Leo Wilson",
      username: "leo",
      color: "blue",
      bio: "A little curious about everything.",
    },
    {
      id: "nina",
      display_name: "Nina Patel",
      username: "nina",
      color: "amber",
      bio: "One idea at a time.",
    },
  ];
  const conversations: Conversation[] = [
    {
      id: "maya-chat",
      kind: "direct",
      title: null,
      members: [profiles[0], profiles[1]].map((p) => ({
        ...p,
        last_read_at: ago(1),
      })),
      last_message: null,
      unread: 0,
      updated_at: ago(4),
    },
    {
      id: "weekend-chat",
      kind: "group",
      title: "The weekend crew",
      members: [profiles[0], profiles[1], profiles[2], profiles[3]].map(
        (p) => ({ ...p, last_read_at: ago(180) }),
      ),
      last_message: null,
      unread: 2,
      updated_at: ago(22),
    },
    {
      id: "arjun-chat",
      kind: "direct",
      title: null,
      members: [profiles[0], profiles[2]].map((p) => ({
        ...p,
        last_read_at: ago(200),
      })),
      last_message: null,
      unread: 1,
      updated_at: ago(48),
    },
    {
      id: "zoe-chat",
      kind: "direct",
      title: null,
      members: [profiles[0], profiles[3]].map((p) => ({
        ...p,
        last_read_at: ago(1),
      })),
      last_message: null,
      unread: 0,
      updated_at: ago(125),
    },
    {
      id: "ideas-chat",
      kind: "group",
      title: "Little big ideas",
      members: [profiles[0], profiles[4], profiles[5]].map((p) => ({
        ...p,
        last_read_at: ago(1),
      })),
      last_message: null,
      unread: 0,
      updated_at: ago(1440),
    },
  ];
  const raw: [string, string, string, number][] = [
    ["maya-chat", "maya", "Hey Alex! How’s the new project coming along?", 65],
    [
      "maya-chat",
      "demo-me",
      "Pretty good! Finally found a direction that feels right.",
      63,
    ],
    [
      "maya-chat",
      "demo-me",
      "Less noise, more room for the things that matter.",
      62,
    ],
    [
      "maya-chat",
      "maya",
      "I love that. Sometimes the simplest version is the best one.",
      58,
    ],
    [
      "maya-chat",
      "maya",
      "Also, found a tiny café near campus. Big windows, excellent coffee. ☕",
      8,
    ],
    [
      "maya-chat",
      "demo-me",
      "That sounds like exactly what I need. Tomorrow afternoon?",
      6,
    ],
    [
      "maya-chat",
      "maya",
      "Absolutely. Let’s make it 4? I’ll grab us a table.",
      4,
    ],
    [
      "weekend-chat",
      "arjun",
      "Saturday morning hike? The weather looks promising.",
      30,
    ],
    ["weekend-chat", "zoe", "Count me in! I’ll bring the snacks. 🥾", 22],
    ["arjun-chat", "arjun", "That playlist you sent is so good.", 48],
    [
      "zoe-chat",
      "demo-me",
      "You have the best recommendations. Thank you!",
      125,
    ],
    [
      "ideas-chat",
      "nina",
      "Small idea: a place to keep all our small ideas.",
      1440,
    ],
  ];
  const messages = raw.map(([conversation_id, sender_id, body, min], i) => ({
    id: `seed-${i}`,
    conversation_id,
    sender_id,
    body,
    created_at: ago(min),
    edited_at: null,
    deleted_at: null,
  }));
  return { profiles, conversations, messages };
}
let memory: Data | null = null;
function read(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (
        Array.isArray(d.profiles) &&
        Array.isArray(d.conversations) &&
        Array.isArray(d.messages)
      )
        return d;
    }
  } catch {
    /* Private browsing still works for this session. */
  }
  return (memory ||= seed());
}
function save(d: Data) {
  memory = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    throw new Error(
      "Your browser could not save this preview. Free some storage and try again.",
    );
  }
  window.dispatchEvent(new Event("kindred-demo"));
}
function normalizeGroups(d: Data) {
  for (const c of d.conversations)
    if (c.kind === "group" && !c.members.some((m) => m.role === "owner")) {
      for (const m of c.members)
        m.role = m.id === demoUser.id ? "owner" : "member";
    }
}
export const demo = {
  invitations: async () => read().invitations || [],
  inviteGroup: async (conversation: string, person: string) => {
    const d = read();
    normalizeGroups(d);
    const c = d.conversations.find((c) => c.id === conversation);
    if (
      !c ||
      !["owner", "admin"].includes(
        c.members.find((m) => m.id === demoUser.id)?.role || "",
      )
    )
      throw new Error("Only owners and admins can invite.");
    if (c.members.some((m) => m.id === person))
      throw new Error("Already a member.");
    if (
      c.members.length +
        (d.invitations || []).filter((i) => i.conversation_id === conversation)
          .length >=
      20
    )
      throw new Error("Circle capacity is 20, including pending invitations.");
    if (
      (d.invitations || []).some(
        (i) => i.conversation_id === conversation && i.invitee === person,
      )
    )
      throw new Error("Invitation already pending.");
    const p = d.profiles.find((p) => p.id === person)!;
    (d.invitations ||= []).push({
      id: crypto.randomUUID(),
      conversation_id: conversation,
      title: c.title!,
      invitee: person,
      name: p.display_name,
      inviter: demoUser.display_name,
      status: "pending",
    });
    save(d);
  },
  respondInvitation: async (_invitation: string, _accept: boolean) => {
    throw new Error(
      "Preview invitations cannot reach other people. Connect Supabase to accept invitations from another account.",
    );
  },
  manageGroup: async (conversation: string, person: string, action: string) => {
    const d = read();
    normalizeGroups(d);
    const c = d.conversations.find((c) => c.id === conversation)!;
    const actor = c.members.find((m) => m.id === demoUser.id),
      target = c.members.find((m) => m.id === person);
    if (!actor) throw new Error("Circle unavailable.");
    if (action === "revoke" && ["owner", "admin"].includes(actor.role!))
      d.invitations = (d.invitations || []).filter(
        (i) => !(i.conversation_id === conversation && i.invitee === person),
      );
    else if (
      ["promote", "demote", "transfer"].includes(action) &&
      actor.role === "owner" &&
      target &&
      person !== demoUser.id
    ) {
      target.role =
        action === "transfer"
          ? "owner"
          : action === "promote"
            ? "admin"
            : "member";
      if (action === "transfer") actor.role = "admin";
    } else if (
      (action === "leave" &&
        person === demoUser.id &&
        actor.role !== "owner") ||
      (action === "remove" &&
        target &&
        person !== demoUser.id &&
        target.role !== "owner" &&
        (actor.role === "owner" ||
          (actor.role === "admin" && target.role === "member")))
    )
      c.members = c.members.filter((m) => m.id !== person);
    else throw new Error("You cannot perform this circle action.");
    save(d);
  },
  profile: async () => read().profiles.find((p) => p.id === demoUser.id)!,
  conversations: async () => {
    const d = read();
    normalizeGroups(d);
    return d.conversations
      .filter((c) => c.members.some((m) => m.id === demoUser.id))
      .map((c) => {
        const msgs = d.messages
          .filter((m) => m.conversation_id === c.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const mine = c.members.find((m) => m.id === demoUser.id)!;
        return {
          ...c,
          members: c.members.map((m) => ({
            ...m,
            ...d.profiles.find((p) => p.id === m.id),
          })),
          last_message: msgs.at(-1) || null,
          unread: msgs.filter(
            (m) =>
              m.sender_id !== demoUser.id && m.created_at > mine.last_read_at,
          ).length,
        };
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  history: async (id: string, before?: Message) =>
    read()
      .messages.filter(
        (m) =>
          m.conversation_id === id &&
          (!before ||
            m.created_at < before.created_at ||
            (m.created_at === before.created_at && m.id < before.id)),
      )
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      )
      .slice(0, 50),
  searchPeople: async (query: string) =>
    read().profiles.filter(
      (p) =>
        p.id !== demoUser.id &&
        `${p.display_name} ${p.username}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  searchMessages: async (id: string, query: string) =>
    read()
      .messages.filter(
        (m) =>
          m.conversation_id === id &&
          !m.deleted_at &&
          m.body.toLowerCase().includes(query.toLowerCase()),
      )
      .reverse()
      .slice(0, 100),
  start: async (ids: string[], title?: string) => {
    const d = read();
    if (!title) {
      const found = d.conversations.find(
        (c) => c.kind === "direct" && c.members.some((m) => m.id === ids[0]),
      );
      if (found) return found.id;
    }
    const id = crypto.randomUUID();
    d.conversations.push({
      id,
      kind: title ? "group" : "direct",
      title: title || null,
      members: d.profiles
        .filter((p) =>
          (title ? [demoUser.id] : [demoUser.id, ...ids]).includes(p.id),
        )
        .map((p) => ({
          ...p,
          last_read_at: new Date().toISOString(),
          role: title ? ("owner" as const) : ("member" as const),
        })),
      last_message: null,
      unread: 0,
      updated_at: new Date().toISOString(),
    });
    if (title)
      for (const person of ids) {
        const p = d.profiles.find((p) => p.id === person)!;
        (d.invitations ||= []).push({
          id: crypto.randomUUID(),
          conversation_id: id,
          title,
          invitee: person,
          name: p.display_name,
          inviter: demoUser.display_name,
          status: "pending",
        });
      }
    save(d);
    return id;
  },
  send: async (conversation: string, id: string, body: string) => {
    if (!validMessage(body))
      throw new Error("Messages must contain 1–4000 characters.");
    const d = read();
    const existing = d.messages.find((m) => m.id === id);
    if (existing) return existing;
    const m: Message = {
      id,
      conversation_id: conversation,
      sender_id: demoUser.id,
      body: body.trim(),
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
    };
    d.messages.push(m);
    d.conversations.find((c) => c.id === conversation)!.updated_at =
      m.created_at;
    save(d);
    return m;
  },
  read: async (conversation: string, through: string) => {
    const d = read();
    const member = d.conversations
      .find((c) => c.id === conversation)
      ?.members.find((m) => m.id === demoUser.id);
    if (member && member.last_read_at < through) {
      member.last_read_at = through;
      save(d);
    }
  },
  edit: async (id: string, body: string) => {
    const d = read();
    const m = d.messages.find(
      (m) => m.id === id && m.sender_id === demoUser.id,
    );
    if (!m) throw new Error("Message unavailable.");
    m.body = body.trim();
    m.edited_at = new Date().toISOString();
    save(d);
  },
  remove: async (id: string) => {
    const d = read();
    const m = d.messages.find(
      (m) => m.id === id && m.sender_id === demoUser.id,
    );
    if (!m) throw new Error("Message unavailable.");
    m.body = "Message deleted";
    m.deleted_at = new Date().toISOString();
    save(d);
  },
  updateProfile: async (name: string, bio: string, color: string) => {
    const d = read();
    const p = d.profiles.find((p) => p.id === demoUser.id)!;
    Object.assign(p, { display_name: name.trim(), bio: bio.trim(), color });
    save(d);
  },
  subscribe: (fn: () => void) => {
    window.addEventListener("storage", fn);
    window.addEventListener("kindred-demo", fn);
    return () => {
      window.removeEventListener("storage", fn);
      window.removeEventListener("kindred-demo", fn);
    };
  },
};
