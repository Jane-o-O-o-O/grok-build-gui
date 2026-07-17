function effectivePrompt(payload) {
  let prompt = String(payload?.prompt || "");
  if (Array.isArray(payload?.attachments) && payload.attachments.length) {
    const attachmentNote = payload.attachments.map((file) => `- ${file}`).join("\n");
    prompt += `\n\nAttached local files:\n${attachmentNote}`;
  }
  return prompt;
}

function normalizePermissionMode(value) {
  if (value === "always-approve" || value === "bypassPermissions") return "always-approve";
  if (value === "dontAsk") return "dontAsk";
  return "auto";
}

function buildCliArgs(payload, newSessionId) {
  const args = ["--cwd", payload.cwd, "-p", effectivePrompt(payload), "--output-format", "streaming-json"];
  if (payload.sessionId) args.push("--resume", payload.sessionId);
  else if (newSessionId) args.push("--session-id", newSessionId);
  if (payload.model && payload.model !== "auto") args.push("--model", payload.model);
  if (payload.effort && payload.effort !== "auto") args.push("--reasoning-effort", payload.effort);

  const permissionMode = normalizePermissionMode(payload.permissionMode);
  if (permissionMode === "always-approve") args.push("--always-approve");
  else args.push("--permission-mode", permissionMode);
  return args;
}

module.exports = { buildCliArgs, effectivePrompt, normalizePermissionMode };
