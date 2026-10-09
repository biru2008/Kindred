export type Color = "fern" | "lavender" | "peach" | "blue" | "rose" | "amber";
export type Profile = {
  id: string;
  display_name: string;
  username: string;
  color: Color;
  bio: string;
  song_path?: string | null;
  song_title?: string;
};
export type Member = Profile & {
  last_read_at: string;
  role?: "owner" | "admin" | "member";
};
export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  status?: "sending" | "failed";
};
export type Conversation = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  members: Member[];
  last_message: Message | null;
  unread: number;
  updated_at: string;
};
export const colors: Color[] = [
  "fern",
  "lavender",
  "peach",
  "blue",
  "rose",
  "amber",
];
export function titleOf(c: Conversation, me: string) {
  return (
    c.title ||
    c.members.find((m) => m.id !== me)?.display_name ||
    "Conversation"
  );
}
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
export function mergeMessages(existing: Message[], incoming: Message[]) {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
export function validMessage(body: string) {
  return body.trim().length > 0 && body.trim().length <= 4000;
}
export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Something went wrong. Please try again.";
}

export type GroupInvitation = {
  id: string;
  conversation_id: string;
  title: string;
  invitee: string;
  name: string;
  inviter: string;
  status: string;
};
