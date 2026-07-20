const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { matchesImageSignature, saveClipboardImage } = require("../attachment-store.cjs");

const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-attachments-"));
try {
  assert.equal(matchesImageSignature(fixture, "image/png"), true);
  const saved = saveClipboardImage({ mimeType: "image/png", bytes: new Uint8Array(fixture) }, root);
  assert.equal(path.dirname(saved), root);
  assert.equal(path.extname(saved), ".png");
  assert.deepEqual(fs.readFileSync(saved), fixture);
  assert.throws(() => saveClipboardImage({ mimeType: "text/plain", bytes: fixture }, root), /格式/);
  assert.throws(() => saveClipboardImage({ mimeType: "image/jpeg", bytes: fixture }, root), /不匹配/);
  console.log("Clipboard image validation and temporary attachment persistence verified.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
