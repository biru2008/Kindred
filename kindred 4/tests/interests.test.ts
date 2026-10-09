import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commonInterests,
  normalizeInterest,
  normalizeInterests,
} from "../src/lib/interests.ts";
test("restored preferences discard invalid tags and cap selection at five", () => {
  assert.deepEqual(
    normalizeInterests(["Music", "Music", "<invalid>", "Books"]),
    ["Music", "Books"],
  );
  assert.equal(
    normalizeInterests(["Music", "Gaming", "Books", "Movies", "Anime", "Art"])
      .length,
    5,
  );
  assert.deepEqual(normalizeInterests(null), []);
});
test("shared-interest labels only show mutual normalized tags", () => {
  assert.deepEqual(commonInterests(["Music", "Books"], ["Gaming", "Music"]), [
    "Music",
  ]);
  assert.deepEqual(commonInterests(undefined, ["Music"]), []);
});

test("custom tags normalize case and whitespace without losing custom preferences", () => {
  assert.deepEqual(
    normalizeInterests([" Indie   Music ", "indie music", "MUSIC", "k-pop"]),
    ["indie music", "Music", "k-pop"],
  );
  assert.deepEqual(
    commonInterests(["ASTRONOMY", "Music"], [" astronomy ", "gaming"]),
    ["astronomy"],
  );
});
test("custom tag validation rejects markup, punctuation, and length violations", () => {
  for (const tag of [null, "", "x", "<script>", "name@email", "x".repeat(31)])
    assert.equal(normalizeInterest(tag), null);
  assert.equal(normalizeInterest("night walks"), "night walks");
});
