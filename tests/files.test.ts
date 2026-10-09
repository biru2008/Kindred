import { test } from "node:test";
import assert from "node:assert/strict";
import { fileInfo, MAX_FILE_BYTES } from "../src/lib/files.ts";
test("file validation accepts media and documents, including browsers with no MIME value", () => {
  assert.equal(
    fileInfo({ name: "Photo.JPG", size: 1024, type: "" }).mime,
    "image/jpeg",
  );
  assert.equal(
    fileInfo({ name: "notes.pdf", size: 1024, type: "application/pdf" }).mime,
    "application/pdf",
  );
});
test("file validation rejects active documents, unknown formats, empty and oversized files", () => {
  for (const name of ["page.html", "picture.svg", "program.exe", "archive.zip"])
    assert.throws(() => fileInfo({ name, size: 100, type: "" }));
  assert.throws(() => fileInfo({ name: "photo.png", size: 0, type: "" }));
  assert.throws(() =>
    fileInfo({ name: "photo.png", size: MAX_FILE_BYTES + 1, type: "" }),
  );
});
