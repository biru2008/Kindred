import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMessages, validMessage } from "../src/lib/types.ts";
import type { Message } from "../src/lib/types.ts";
const m = (
  id: string,
  time: string,
  status?: "sending" | "failed",
): Message => ({
  id,
  created_at: time,
  conversation_id: "room",
  sender_id: "me",
  body: "Hello",
  edited_at: null,
  deleted_at: null,
  status,
});
test("server acknowledgement replaces optimistic message without duplicates", () => {
  const result = mergeMessages(
    [m("a", "2026-01-01T10:00:00Z", "sending")],
    [m("a", "2026-01-01T10:00:01Z")],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].status, undefined);
});
test("reconnect deduplicates and orders equal timestamps deterministically", () => {
  const result = mergeMessages(
    [m("b", "2026-01-01"), m("c", "2026-01-02")],
    [m("a", "2026-01-01"), m("c", "2026-01-02")],
  );
  assert.deepEqual(
    result.map((x) => x.id),
    ["a", "b", "c"],
  );
});
test("empty and oversized messages are rejected", () => {
  assert.equal(validMessage(" \n "), false);
  assert.equal(validMessage("x".repeat(4001)), false);
  assert.equal(validMessage("x".repeat(4000)), true);
  assert.equal(validMessage(" hello "), true);
});
