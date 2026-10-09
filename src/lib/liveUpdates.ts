import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

export type UpdateConnection = "connecting" | "connected" | "reconnecting";

// Presence can work while database replication fails. Monitor the database
// subscription itself, and reconcile persisted history after it becomes ready.
export function subscribeToUpdates(
  client: SupabaseClient,
  refresh: () => void,
  onState?: (state: UpdateConnection) => void,
) {
  let channel: RealtimeChannel | undefined;
  let disposed = false;
  let state: UpdateConnection = "connecting";
  const report = (next: UpdateConnection) => {
    if (disposed) return;
    state = next;
    onState?.(next);
  };
  report("connecting");
  const watchdog = setTimeout(() => {
    if (state !== "connected") report("reconnecting");
  }, 10000);
  const ready = () => {
    if (disposed) return;
    clearTimeout(watchdog);
    report("connected");
    refresh();
  };
  void client.auth.getSession().then(({ data, error }) => {
    if (disposed) return;
    if (error || !data.session) {
      report("reconnecting");
      return;
    }
    channel = client.channel(`updates:${data.session.user.id}`, {
      config: { private: true, broadcast: { replication_ready: true } },
    });
    channel.on("system", {}, (payload) => {
      if (disposed || !["system", "postgres_changes"].includes(payload.extension)) return;
      if (payload.status === "ok") ready();
      else if (payload.status === "error") report("reconnecting");
    });
    for (const table of ["messages", "conversations", "conversation_members", "profiles", "group_invitations"])
      channel.on("postgres_changes", { event: "*", schema: "public", table }, ready);
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") refresh();
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) report("reconnecting");
    });
  }).catch(() => report("reconnecting"));
  return () => {
    disposed = true;
    clearTimeout(watchdog);
    if (channel) void client.removeChannel(channel);
  };
}
