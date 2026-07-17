const assert = require("node:assert/strict");
const { buildCliArgs, effectivePrompt, normalizePermissionMode } = require("../cli-runtime.cjs");

const base = {
  cwd: "/tmp/project",
  prompt: "Inspect the project",
  model: "grok-4.5",
  effort: "high",
  attachments: ["src/main.rs"]
};

assert.equal(normalizePermissionMode("auto"), "auto");
assert.equal(normalizePermissionMode("dontAsk"), "dontAsk");
assert.equal(normalizePermissionMode("always-approve"), "always-approve");
assert.equal(normalizePermissionMode("ask"), "auto");
assert.match(effectivePrompt(base), /Attached local files:\n- src\/main\.rs/);

const automatic = buildCliArgs({ ...base, permissionMode: "auto" }, "new-session");
assert.deepEqual(automatic.slice(0, 6), ["--cwd", base.cwd, "-p", effectivePrompt(base), "--output-format", "streaming-json"]);
assert.deepEqual(automatic.slice(6, 8), ["--session-id", "new-session"]);
assert.ok(automatic.includes("auto"));
assert.ok(!automatic.includes("--always-approve"));

const strict = buildCliArgs({ ...base, permissionMode: "dontAsk" }, "strict-session");
assert.deepEqual(strict.slice(-2), ["--permission-mode", "dontAsk"]);

const unrestricted = buildCliArgs({ ...base, sessionId: "existing-session", permissionMode: "always-approve" }, "ignored-session");
assert.ok(unrestricted.includes("--resume"));
assert.ok(!unrestricted.includes("--session-id"));
assert.ok(unrestricted.includes("--always-approve"));

console.log("Generic CLI arguments and permission-mode mapping verified.");
