import { supabase } from "./supabase";
import { demo } from "./demo";
import { subscribeToUpdates } from "./liveUpdates";
import type { UpdateConnection } from "./liveUpdates";
import type {
  Conversation,
  Message,
  Profile,
  GroupInvitation,
  ChatFeatures,
} from "./types";
function client() {
  if (!supabase)
    throw new Error("The live workspace has not been configured yet.");
  return supabase;
}
async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export function api(preview: boolean) {
  if (preview) return demo;
  return {
    profile: async () => {
      const { data: auth, error: authError } = await client().auth.getUser();
      if (authError) throw authError;
      const { data, error } = await client()
        .from("profiles")
        .select("*")
        .eq("id", auth.user!.id)
        .single();
      if (error) throw error;
      return data as Profile;
    },
    invitations: () => rpc<GroupInvitation[]>("list_group_invitations"),
    inviteGroup: (conversation: string, person: string) =>
      rpc<void>("invite_group", { conversation, person }),
    respondInvitation: (invitation: string, accept: boolean) =>
      rpc<void>("respond_group_invitation", { invitation, accept }),
    manageGroup: (conversation: string, person: string, action: string) =>
      rpc<void>("manage_group", { conversation, person, action }),
    conversations: () => rpc<Conversation[]>("list_conversations"),
    history: (id: string, before?: Message) =>
      rpc<Message[]>("message_history", {
        conversation: id,
        before_time: before?.created_at || null,
        before_id: before?.id || null,
      }),
    searchPeople: async (query: string) => {
      const { data: auth } = await client().auth.getUser();
      let q = client()
        .from("profiles")
        .select("*")
        .neq("id", auth.user!.id)
        .order("display_name")
        .limit(20);
      const clean = query
        .trim()
        .replace(/[^\p{L}\p{N}_ ]/gu, "")
        .slice(0, 50);
      if (clean)
        q = q.or(`display_name.ilike.%${clean}%,username.ilike.%${clean}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as Profile[];
    },
    searchMessages: (id: string, query: string) =>
      rpc<Message[]>("search_messages", { conversation: id, query }),
    start: (ids: string[], title?: string) =>
      rpc<string>("start_conversation", {
        member_ids: ids,
        group_title: title || null,
      }),
    send: (
      conversation: string,
      id: string,
      body: string,
      replyTo?: string | null,
    ) =>
      replyTo
        ? rpc<Message>("send_reply", {
            conversation,
            message_id: id,
            message_body: body,
            target: replyTo,
          })
        : rpc<Message>("send_message", {
            conversation,
            message_id: id,
            message_body: body,
          }),
    features: (conversation: string, ids: string[]) =>
      rpc<ChatFeatures>("chat_features", { conversation, message_ids: ids }),
    react: (message: string, emoji: string, enabled: boolean) =>
      rpc<void>("set_message_reaction", {
        message_id: message,
        reaction: emoji,
        enabled,
      }),
    pin: (message: string, enabled: boolean) =>
      rpc<void>("set_message_pin", { message_id: message, enabled }),
    preferences: (conversation: string, muted: boolean, archived: boolean) =>
      rpc<void>("set_conversation_preferences", {
        conversation,
        mute: muted,
        archive: archived,
      }),
    read: (conversation: string, through: string) =>
      rpc<void>("mark_read", { conversation, read_through: through }),
    edit: (id: string, body: string) =>
      rpc<void>("edit_message", { message_id: id, message_body: body }),
    remove: (id: string) => rpc<void>("delete_message", { message_id: id }),
    updateProfile: (name: string, bio: string, color: string) =>
      rpc<void>("update_profile", {
        new_name: name,
        new_bio: bio,
        new_color: color,
      }),
    subscribe: (fn: () => void, onState?: (state: UpdateConnection) => void) =>
      subscribeToUpdates(client(), fn, onState),
  };
}
