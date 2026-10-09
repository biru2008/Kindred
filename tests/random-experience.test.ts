import { test } from "node:test";
import assert from "node:assert/strict";
import {
  remainingGrace,
  feedbackCategories,
} from "../src/lib/randomExperience.ts";
test("Reconnect countdown handles clock drift and never goes below zero", () => {
  assert.equal(remainingGrace(60, 10000, 15000), 55);
  assert.equal(remainingGrace(60, 10000, 90000), 0);
  assert.equal(remainingGrace(undefined, 10000, 11000), 0);
});
test("Feedback distinguishes ordinary incompatibility and technical trouble from safety concerns", () => {
  for (const id of [
    "not_vibe",
    "technical",
    "harassment",
    "spam",
    "inappropriate",
  ])
    assert.ok(feedbackCategories.some((c) => c.id === id));
  assert.equal(
    new Set(feedbackCategories.map((c) => c.id)).size,
    feedbackCategories.length,
  );
});
