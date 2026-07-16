const fs = require("node:fs");

function readAccountInfo(authPath, environment = process.env) {
  let entries = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    entries = Object.entries(parsed || {}).filter(([, value]) => value && typeof value === "object");
  } catch {}
  entries.sort((a, b) => String(b[1].create_time || "").localeCompare(String(a[1].create_time || "")));
  const [scope, auth] = entries.find(([, value]) => value.email || value.user_id || value.key) || [];
  if (auth) {
    const fullName = [auth.first_name, auth.last_name].filter(Boolean).join(" ");
    return {
      signedIn: true,
      method: auth.auth_mode || "account",
      scope,
      email: auth.email || null,
      name: fullName || auth.email?.split("@")[0] || "Grok 用户",
      team: auth.team_name || auth.organization_name || null,
      role: auth.team_role || auth.organization_role || null,
      principalType: auth.principal_type || null,
      expiresAt: auth.expires_at || null,
      dataSharing: !auth.coding_data_retention_opt_out
    };
  }
  if (environment.XAI_API_KEY || environment.GROK_CODE_XAI_API_KEY) {
    return { signedIn: true, method: "api_key", email: null, name: "API Key 用户", team: null, role: null };
  }
  return { signedIn: false, method: null, email: null, name: "登录 Grok", team: null, role: null };
}

module.exports = { readAccountInfo };
