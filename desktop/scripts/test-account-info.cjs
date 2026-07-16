const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readAccountInfo } = require("../account-info.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-account-"));
const authPath = path.join(directory, "auth.json");
fs.writeFileSync(authPath, JSON.stringify({
  "https://auth.x.ai": {
    key: "SECRET_TOKEN_FIXTURE", auth_mode: "oidc", create_time: "2026-07-16T08:00:00Z",
    user_id: "user-fixture", email: "ada@example.com", first_name: "Ada", last_name: "Lovelace",
    team_name: "Analytical Engines", team_role: "member", coding_data_retention_opt_out: true
  }
}));
const account = readAccountInfo(authPath, {});
assert.equal(account.signedIn, true);
assert.equal(account.name, "Ada Lovelace");
assert.equal(account.team, "Analytical Engines");
assert.equal(account.dataSharing, false);
assert.doesNotMatch(JSON.stringify(account), /SECRET_TOKEN_FIXTURE/);
assert.equal(readAccountInfo(path.join(directory, "missing.json"), {}).signedIn, false);
assert.equal(readAccountInfo(path.join(directory, "missing.json"), { XAI_API_KEY: "secret" }).method, "api_key");
fs.rmSync(directory, { recursive: true, force: true });
console.log("Redacted Grok account profile parsing verified.");
