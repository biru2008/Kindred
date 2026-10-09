/** Use two distinct disposable confirmed accounts in a test project.
 * Persists marked test messages, tests private Broadcast + authorized history,
 * then soft-deletes those messages. No Postgres Changes subscription is used.
 */
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { notifySavedMessage } from "../src/lib/liveUpdates.ts";

const url = process.env.VITE_SUPABASE_URL;
const key =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const names = [
  "SUPABASE_TEST_EMAIL_A",
  "SUPABASE_TEST_PASSWORD_A",
  "SUPABASE_TEST_EMAIL_B",
  "SUPABASE_TEST_PASSWORD_B",
];
if (!url || !key || names.some((name) => !process.env[name])) {
  console.error(
    "Test not run: configure public Supabase settings and two disposable test accounts in the ignored .env. See README.",
  );
  process.exit(2);
}
const clients = [0, 1].map(() =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
const channels = [];
const saved = [];
let waiting;
function join(channel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Private conversation channel did not connect within 15 seconds.",
          ),
        ),
      15000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timer);
        reject(new Error(`Private channel: ${status}`));
      }
    });
  });
}
try {
  const users = await Promise.all(
    clients.map(async (client, i) => {
      const suffix = "AB"[i];
      const { data, error } = await client.auth.signInWithPassword({
        email: process.env[`SUPABASE_TEST_EMAIL_${suffix}`],
        password: process.env[`SUPABASE_TEST_PASSWORD_${suffix}`],
      });
      if (error) throw error;
      return data.user;
    }),
  );
  assert.notEqual(users[0].id, users[1].id, "Test accounts must be different.");
  const start = await clients[0].rpc("start_conversation", {
    member_ids: [users[1].id],
  });
  if (start.error) throw start.error;
  const room = start.data;
  for (const client of clients)
    channels.push(
      client.channel(`conversation:${room}`, {
        config: { private: true, broadcast: { self: false, ack: true } },
      }),
    );
  channels[1].on("broadcast", { event: "message_saved" }, ({ payload }) => {
    if (payload?.conversation_id === room) waiting?.();
  });
  await Promise.all(channels.map(join));
  for (let sample = 1; sample <= 3; sample++) {
    const id = crypto.randomUUID();
    const body = `[Kindred delivery test ${sample}] ${id}`;
    let timer;
    let receive;
    let failDelivery;
    const arrived = new Promise((resolve, reject) => {
      receive = resolve;
      failDelivery = reject;
    });
    // Avoid an unhandled rejection while a slow save is still outstanding.
    void arrived.catch(() => {});
    waiting = receive;
    const began = performance.now();
    try {
      const result = await clients[0].rpc("send_message", {
        conversation: room,
        message_id: id,
        message_body: body,
      });
      if (result.error) throw result.error;
      saved.push(id);
      const persisted = performance.now();
      timer = setTimeout(
        () =>
          failDelivery(
            new Error("No private broadcast within 10 seconds after save."),
          ),
        10000,
      );
      void notifySavedMessage(channels[0], room);
      await arrived;
      const history = await clients[1].rpc("message_history", {
        conversation: room,
      });
      if (history.error) throw history.error;
      assert.equal(
        history.data.find((message) => message.id === id)?.body,
        body,
      );
      const end = performance.now();
      console.log(
        `PASS sample ${sample}: save ${Math.round(persisted - began)} ms; private notification + history ${Math.round(end - persisted)} ms; total ${Math.round(end - began)} ms`,
      );
    } finally {
      clearTimeout(timer);
      waiting = undefined;
    }
  }
} catch (error) {
  console.error("FAIL", error.message || "Delivery test failed");
  process.exitCode = 1;
} finally {
  for (const id of saved) {
    const result = await clients[0].rpc("delete_message", { message_id: id });
    if (result.error) {
      console.error(
        "Test message cleanup failed; remove marked test messages from account A.",
      );
      process.exitCode = 1;
    }
  }
  await Promise.all(
    channels.map((channel, index) => clients[index].removeChannel(channel)),
  );
  await Promise.all(
    clients.map((client) => client.auth.signOut({ scope: "local" })),
  );
}
