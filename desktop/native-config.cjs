const fs = require("node:fs");
const path = require("node:path");

const SETTINGS = [
  { id: "default_model", section: "models", key: "default", type: "string", default: "" },
  { id: "web_search_model", section: "models", key: "web_search", type: "string", default: "grok-4.20-multi-agent" },
  { id: "auto_update", section: "cli", key: "auto_update", type: "boolean", default: true },
  { id: "show_tips", section: "cli", key: "show_tips", type: "boolean", default: true },
  { id: "auto_compact", section: "session", key: "auto_compact_threshold_percent", type: "integer", default: 85, min: 50, max: 100 },
  { id: "load_envrc", section: "session", key: "load_envrc", type: "boolean", default: true },
  { id: "remote_fetch", section: "features", key: "remote_fetch", type: "boolean", default: true },

  { id: "theme", section: "ui", key: "theme", type: "enum", default: "groknight", choices: ["auto", "groknight", "grokday", "tokyonight", "rosepine-moon", "oscura-midnight"] },
  { id: "auto_dark_theme", section: "ui", key: "auto_dark_theme", type: "enum", default: "groknight", choices: ["groknight", "grokday", "tokyonight", "rosepine-moon", "oscura-midnight"] },
  { id: "auto_light_theme", section: "ui", key: "auto_light_theme", type: "enum", default: "grokday", choices: ["groknight", "grokday", "tokyonight", "rosepine-moon", "oscura-midnight"] },
  { id: "compact_mode", section: "ui", key: "compact_mode", type: "boolean", default: false },
  { id: "screen_mode", section: "ui", key: "screen_mode", type: "enum", default: "fullscreen", choices: ["fullscreen", "minimal"] },
  { id: "show_timestamps", section: "ui", key: "show_timestamps", type: "boolean", default: true },
  { id: "show_thinking_blocks", section: "ui", key: "show_thinking_blocks", type: "boolean", default: true },
  { id: "group_tool_verbs", section: "ui", key: "group_tool_verbs", type: "boolean", default: true },
  { id: "collapsed_edit_blocks", section: "ui", key: "collapsed_edit_blocks", type: "boolean", default: false },
  { id: "max_thoughts_width", section: "ui", key: "max_thoughts_width", type: "integer", default: 120, min: 40, max: 500 },
  { id: "render_mermaid", section: "ui", key: "render_mermaid", type: "enum", default: "auto", choices: ["auto", "on", "off"] },
  { id: "display_refresh_auto_cadence", section: "ui.display_refresh", key: "auto_cadence_enabled", type: "boolean", default: false },

  { id: "permission_mode", section: "ui", key: "permission_mode", type: "enum", default: "auto", choices: ["default", "ask", "auto", "always-approve"] },
  { id: "remember_tool_approvals", section: "ui", key: "remember_tool_approvals", type: "boolean", default: false },
  { id: "default_selected_permission", section: "ui", key: "default_selected_permission", type: "enum", default: "always_allow_all_sessions", choices: ["always_allow_all_sessions", "allow_command_always", "allow_once", "reject"] },
  { id: "ask_question_timeout", section: "toolset.ask_user_question", key: "timeout_enabled", type: "boolean", default: true },
  { id: "fork_secondary_model", section: "ui", key: "fork_secondary_model", type: "string", default: "" },
  { id: "subagents_enabled", section: "subagents", key: "enabled", type: "boolean", default: true },
  { id: "two_pass_compaction", section: "features", key: "two_pass_compaction", type: "boolean", default: false },
  { id: "cancel_subagents", section: "ui", key: "cancel_subagents_on_turn_cancel", type: "enum", default: "ask", choices: ["ask", "always_stop", "always_continue"] },

  { id: "simple_mode", section: "ui", key: "simple_mode", type: "boolean", default: true },
  { id: "vim_mode", section: "ui", key: "vim_mode", type: "boolean", default: false },
  { id: "prompt_suggestions", section: "ui", key: "prompt_suggestions", type: "boolean", default: true },
  { id: "voice_capture_mode", section: "ui", key: "voice_capture_mode", type: "enum", default: "hold", choices: ["hold", "toggle"] },
  { id: "voice_stt_language", section: "ui", key: "voice_stt_language", type: "enum", default: "en", choices: ["en", "auto", "ar", "cs", "da", "nl", "fil", "fr", "de", "hi", "id", "it", "ja", "ko", "mk", "ms", "fa", "pl", "pt", "ro", "ru", "es", "sv", "th", "tr", "vi"] },
  { id: "scroll_speed", section: "ui", key: "scroll_speed", type: "integer", default: 50, min: 1, max: 100 },
  { id: "scroll_mode", section: "ui", key: "scroll_mode", type: "enum", default: "auto", choices: ["auto", "wheel", "trackpad"] },
  { id: "scroll_lines", section: "ui", key: "scroll_lines", type: "integer", default: 3, min: 1, max: 10 },
  { id: "invert_scroll", section: "ui", key: "invert_scroll", type: "boolean", default: false },
  { id: "keep_text_selection", section: "ui", key: "keep_text_selection", type: "enum", default: "flash", choices: ["flash", "hold", "word_select"] },
  { id: "hint_undo", section: "ui.contextual_hints", key: "undo", type: "boolean", default: true },
  { id: "hint_plan_mode", section: "ui.contextual_hints", key: "plan_mode", type: "boolean", default: true },
  { id: "hint_image_input", section: "ui.contextual_hints", key: "image_input", type: "boolean", default: true },
  { id: "hint_send_now", section: "ui.contextual_hints", key: "send_now", type: "boolean", default: true },
  { id: "hint_small_screen", section: "ui.contextual_hints", key: "small_screen", type: "boolean", default: true },
  { id: "hint_word_select", section: "ui.contextual_hints", key: "word_select", type: "boolean", default: true },

  { id: "respect_gitignore", section: "tools", key: "respect_gitignore", type: "boolean", default: false },
  { id: "bash_timeout", section: "toolset.bash", key: "timeout_secs", type: "integer", default: 120, min: 5, max: 3600 },
  { id: "bash_output_limit", section: "toolset.bash", key: "output_byte_limit", type: "integer", default: 20000, min: 1000, max: 1000000 },
  { id: "lsp_tools", section: "features", key: "lsp_tools", type: "boolean", default: false },
  { id: "codebase_indexing", section: "features", key: "codebase_indexing", type: "boolean", default: true },

  { id: "memory_enabled", section: "memory", key: "enabled", type: "boolean", default: false },
  { id: "memory_save_on_end", section: "memory.session", key: "save_on_end", type: "boolean", default: true },
  { id: "memory_watcher", section: "memory.watcher", key: "enabled", type: "boolean", default: true },
  { id: "memory_max_results", section: "memory.search", key: "max_results", type: "integer", default: 6, min: 1, max: 50 },
  { id: "memory_min_score", section: "memory.search", key: "min_score", type: "number", default: 0.35, min: 0, max: 1 },
  { id: "memory_initial_injection", section: "memory.initial_injection", key: "enabled", type: "boolean", default: true },

  { id: "new_worktree_mode", section: "hints", key: "new_session_worktree_mode", type: "enum", default: "never", choices: ["ask", "always", "never"] },
  { id: "fork_worktree_mode", section: "hints", key: "fork_worktree_mode", type: "enum", default: "ask", choices: ["ask", "always", "never"] },
  { id: "hunk_tracker_mode", section: "ui", key: "hunk_tracker_mode", type: "enum", default: "agent_only", choices: ["agent_only", "all_dirty", "off"] },

  { id: "telemetry", section: "features", key: "telemetry", type: "boolean", default: false },
  { id: "feedback", section: "features", key: "feedback", type: "boolean", default: true }
];

const SETTING_MAP = new Map(SETTINGS.map((item) => [item.id, item]));

function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== "\\") quote = quote === char ? null : quote || char;
    if (char === "#" && !quote) return value.slice(0, i).trim();
  }
  return value.trim();
}

function parseValue(raw) {
  const value = stripComment(raw);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(value)) return Number.parseFloat(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function sectionBounds(lines, section) {
  const exact = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === exact);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function getValue(text, definition) {
  const lines = String(text || "").split(/\r?\n/);
  const bounds = sectionBounds(lines, definition.section);
  if (!bounds) return definition.default;
  const keyPattern = new RegExp(`^\\s*${definition.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)$`);
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    const match = lines[i].match(keyPattern);
    if (match) return parseValue(match[1]);
  }
  return definition.default;
}

function normalizeValue(definition, input) {
  if (definition.type === "boolean") return Boolean(input);
  if (definition.type === "string") return String(input ?? "").slice(0, 512);
  if (definition.type === "enum") {
    const value = String(input);
    if (!definition.choices.includes(value)) throw new Error(`不支持的 ${definition.id} 值`);
    return value;
  }
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error(`${definition.id} 需要数值`);
  const clamped = Math.min(definition.max, Math.max(definition.min, value));
  return definition.type === "integer" ? Math.round(clamped) : clamped;
}

function formatValue(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function setValue(text, definition, input) {
  const value = normalizeValue(definition, input);
  const newline = String(text).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(text || "").split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s*${definition.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  let bounds = sectionBounds(lines, definition.section);
  if (!bounds) {
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push(`[${definition.section}]`, `${definition.key} = ${formatValue(value)}`);
  } else {
    const index = lines.findIndex((line, lineIndex) => lineIndex > bounds.start && lineIndex < bounds.end && keyPattern.test(line));
    if (index >= 0) lines[index] = `${definition.key} = ${formatValue(value)}`;
    else lines.splice(bounds.end, 0, `${definition.key} = ${formatValue(value)}`);
  }
  return `${lines.join(newline).replace(/(?:\r?\n)+$/, "")}${newline}`;
}

function readNativeConfig(configPath) {
  const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  return {
    path: configPath,
    exists: fs.existsSync(configPath),
    raw,
    values: Object.fromEntries(SETTINGS.map((definition) => [definition.id, getValue(raw, definition)]))
  };
}

function writeAtomic(configPath, content) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (fs.existsSync(configPath)) fs.copyFileSync(configPath, `${configPath}.desktop-backup`);
  const temporary = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, configPath);
}

function updateNativeSetting(configPath, id, input) {
  const definition = SETTING_MAP.get(id);
  if (!definition) throw new Error("未知的原生设置项");
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const next = setValue(current, definition, input);
  writeAtomic(configPath, next);
  return { id, value: getValue(next, definition), raw: next };
}

function validateRawConfig(raw) {
  const text = String(raw ?? "");
  let quote = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && !/^\[\[?.+\]\]?$/.test(trimmed)) throw new Error(`第 ${index + 1} 行的表头格式有误`);
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if ((char === '"' || char === "'") && line[i - 1] !== "\\") quote = quote === char ? null : quote || char;
    }
    if (quote) quote = null;
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

function saveRawConfig(configPath, raw) {
  const normalized = validateRawConfig(raw);
  writeAtomic(configPath, normalized);
  return readNativeConfig(configPath);
}

module.exports = { SETTINGS, getValue, readNativeConfig, saveRawConfig, setValue, updateNativeSetting, validateRawConfig };
