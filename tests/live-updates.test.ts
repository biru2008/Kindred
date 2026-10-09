import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeToUpdates } from "../src/lib/liveUpdates.ts";

function fixture(sessionPending = false) {
  const handlers = new Map<string, (payload?: unknown) => void>();
  let status: (value: string) => void = () => {};
  let removed = 0;
  let created = 0;
  let resolveSession!: (value: unknown) => void;
  const session = new Promise((resolve) => { resolveSession = resolve; });
  if (!sessionPending) resolveSession({ data: { session: { user: { id: "test-user" } } }, error: null });
  const channel = {
    on(type: string, filter: { table?: string }, fn: (payload?: unknown) => void) {
      handlers.set(filter.table || type, fn);
      return channel;
    },
    subscribe(fn: (value: string) => void) { status = fn; return channel; },
  };
  const client = {
    auth: { getSession: () => session },
    channel: () => { created++; return channel; },
    removeChannel: () => { removed++; return Promise.resolve(); },
  } as unknown as SupabaseClient;
  const states: string[] = [];
  let refreshes = 0;
  const stop = subscribeToUpdates(client, () => { refreshes++; }, (state) => states.push(state));
  return { handlers, stop, states, resolveSession, status: (value: string) => status(value), counts: () => ({ removed, created, refreshes }) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("WebSocket join alone does not claim database updates are ready", async () => {
  const f = fixture();
  try {
    await flush();
    f.status("SUBSCRIBED");
    assert.deepEqual(f.states, ["connecting"]);
    f.handlers.get("system")!({ extension: "postgres_changes", status: "ok" });
    assert.equal(f.states.at(-1), "connected");
    f.status("CHANNEL_ERROR");
    assert.equal(f.states.at(-1), "reconnecting");
    f.handlers.get("system")!({ extension: "system", status: "ok" });
    assert.equal(f.states.at(-1), "connected");
    assert.equal(f.counts().refreshes, 3);
  } finally { f.stop(); }
});
test("database error degrades status even when presence may still work", async () => {
  const f = fixture();
  try {
    await flush();
    f.handlers.get("system")!({ extension: "postgres_changes", status: "error" });
    assert.equal(f.states.at(-1), "reconnecting");
    f.handlers.get("messages")!();
    assert.equal(f.states.at(-1), "connected");
    assert.equal(f.counts().refreshes, 1);
  } finally { f.stop(); }
});
test("account switch during session lookup cannot create a stale subscription", async () => {
  const f = fixture(true);
  f.stop();
  f.resolveSession({ data: { session: { user: { id: "old-user" } } }, error: null });
  await flush();
  assert.equal(f.counts().created, 0);
});
test("cleanup removes the channel and ignores late events", async () => {
  const f = fixture();
  await flush();
  f.stop();
  f.handlers.get("messages")!();
  f.status("CLOSED");
  assert.deepEqual(f.counts(), { removed: 1, created: 1, refreshes: 0 });
  assert.deepEqual(f.states, ["connecting"]);
});
