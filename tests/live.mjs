/** Run only against a configured test project with three existing, email-confirmed accounts.
 * Sends a clearly marked test message between A and B, then soft-deletes it.
 * Never uses the service-role key and never outputs passwords or tokens.
 */
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const required = [
  "SUPABASE_TEST_EMAIL_A",
  "SUPABASE_TEST_PASSWORD_A",
  "SUPABASE_TEST_EMAIL_B",
  "SUPABASE_TEST_PASSWORD_B",
  "SUPABASE_TEST_EMAIL_C",
  "SUPABASE_TEST_PASSWORD_C",
];
if (!url || !key || required.some((name) => !process.env[name])) {
  console.error(
    "Live test not run. Set the Supabase URL/public key and three test account email/password pairs in .env. See README.",
  );
  process.exit(2);
}
const clients = Array.from({ length: 3 }, () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
let channel;
let messageId;
let sent = false;
let succeeded = false;
try {
  const users = await Promise.all(
    clients.map(async (c, i) => {
      const suffix = "ABC"[i];
      const { data, error } = await c.auth.signInWithPassword({
        email: process.env[`SUPABASE_TEST_EMAIL_${suffix}`],
        password: process.env[`SUPABASE_TEST_PASSWORD_${suffix}`],
      });
      if (error) throw error;
      const status = await c.rpc("account_status");
      if (status.error) throw status.error;
      assert.equal(
        status.data.email_verified,
        true,
        `Test account ${suffix} must confirm its email first.`,
      );
      return data.user;
    }),
  );
  const [a, b, c] = clients;
  const starts = await Promise.all([
    a.rpc("start_conversation", { member_ids: [users[1].id] }),
    b.rpc("start_conversation", { member_ids: [users[0].id] }),
  ]);
  for (const result of starts) if (result.error) throw result.error;
  const room = starts[0].data;
  assert.equal(starts[1].data, room);
  console.log("PASS concurrent direct-chat creation returns one conversation");
  messageId = crypto.randomUUID();
  let resolveDelivery;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let receivedAt;
  const delivered = new Promise((resolve) => {
    resolveDelivery = resolve;
  });
  channel = b
    .channel(`updates:${users[1].id}`, { config: { private: true, broadcast: { replication_ready: true } } })
    .on("system", {}, (payload) => {
      if (!["system", "postgres_changes"].includes(payload.extension)) return;
      if (payload.status === "ok") resolveReady();
      else if (payload.status === "error") rejectReady(new Error("Database replication is not ready."));
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${room}`,
      },
      (payload) => {
        if (payload.new.id === messageId) {
          receivedAt = performance.now();
          resolveDelivery(payload.new);
        }
      },
    );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "Realtime subscription timed out. Check migration and private channel policies.",
          ),
        ),
      20000,
    );
    ready.then(() => { clearTimeout(timeout); resolve(); }, (error) => { clearTimeout(timeout); reject(error); });
    channel.subscribe((status) => {
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        rejectReady(new Error("Realtime channel could not connect."));
      }
    });
  });
  const body = `[Kindred live test] ${new Date().toISOString()}`;
  const sentAt = performance.now();
  const send = await a.rpc("send_message", {
    conversation: room,
    message_id: messageId,
    message_body: body,
  });
  if (send.error) throw send.error;
  sent = true;
  let deliveryTimer;
  const received = await Promise.race([
    delivered,
    new Promise((_, reject) => {
      deliveryTimer = setTimeout(
        () => reject(new Error("No WebSocket delivery within 15 seconds.")),
        15000,
      );
    }),
  ]).finally(() => clearTimeout(deliveryTimer));
  assert.equal(received.sender_id, users[0].id);
  assert.equal(received.body, body);
  console.log(`PASS real WebSocket delivery between two signed-in accounts (${Math.round(receivedAt - sentAt)} ms from send request)`);
  const retry = await a.rpc("send_message", {
    conversation: room,
    message_id: messageId,
    message_body: body,
  });
  if (retry.error) throw retry.error;
  const history = await b.rpc("message_history", { conversation: room });
  if (history.error) throw history.error;
  assert.equal(history.data.filter((m) => m.id === messageId).length, 1);
  console.log("PASS persisted history and idempotent retry");
  const outsider = await c.from("messages").select("id").eq("id", messageId);
  if (outsider.error) throw outsider.error;
  assert.equal(outsider.data.length, 0);
  const badSend = await c.rpc("send_message", {
    conversation: room,
    message_id: crypto.randomUUID(),
    message_body: "[Kindred test] must fail",
  });
  assert.ok(badSend.error);
  console.log(
    "PASS third account cannot read or send to the private conversation",
  );
  succeeded = true;
} catch (error) {
  console.error(
    "FAIL",
    error instanceof Error
      ? error.message
      : error.message || "Live verification failed",
  );
  process.exitCode = 1;
} finally {
  if (sent) {
    const { error } = await clients[0].rpc("delete_message", {
      message_id: messageId,
    });
    if (error) {
      console.error(
        "Could not clean up test message. Delete it from account A.",
      );
      process.exitCode = 1;
    }
  }
  if (channel) await clients[1].removeChannel(channel);
  await Promise.all(clients.map((c) => c.auth.signOut()));
  if (succeeded && process.exitCode !== 1)
    console.log("Live verification passed. Test message was soft-deleted.");
}
