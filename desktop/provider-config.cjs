const crypto = require("node:crypto");

const BLOCK_START = "# >>> grok-desktop custom models >>>";
const BLOCK_END = "# <<< grok-desktop custom models <<<";
const TOOL_PROBE_VERSION = 3;
const PROBE_TOOLS_OPENAI = [
  { type: "function", function: { name: "probe_terminal", description: "Run a harmless diagnostic command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } },
  { type: "function", function: { name: "probe_directory", description: "Inspect a harmless directory path", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } }
];
const PROBE_TOOL_NAMES = new Set(["probe_terminal", "probe_directory"]);

function cleanBaseUrl(input) {
  const value = String(input || "").trim();
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("URL 需要使用 http 或 https 协议");
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function endpointCandidates(input) {
  const url = cleanBaseUrl(input);
  if (/\/models$/i.test(url)) return [{ listUrl: url, baseUrl: url.replace(/\/models$/i, "") }];
  if (/\/v1$/i.test(url)) return [{ listUrl: `${url}/models`, baseUrl: url }];
  return [
    { listUrl: `${url}/models`, baseUrl: url },
    { listUrl: `${url}/v1/models`, baseUrl: `${url}/v1` }
  ];
}

function protocolOrder(url, key) {
  const hint = `${url} ${key}`.toLowerCase();
  return hint.includes("anthropic") || hint.includes("claude") || hint.includes("sk-ant")
    ? ["anthropic", "openai"]
    : ["openai", "anthropic"];
}

function headersFor(protocol, key) {
  if (protocol === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json" };
  }
  return { authorization: `Bearer ${key}`, accept: "application/json" };
}

function parseModels(body, protocol) {
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
  if (!data) throw new Error("响应中没有模型列表");
  return data
    .map((item) => typeof item === "string" ? { id: item } : item)
    .filter((item) => typeof item?.id === "string" && item.id.trim())
    .map((item) => {
      const id = item.id.trim();
      const name = item.display_name || item.name || id;
      return {
      id,
      name,
      owner: item.owned_by || (protocol === "anthropic" ? "anthropic" : "provider"),
      created: item.created_at || item.created || null,
      contextWindow: Number(item.max_input_tokens) > 0 ? Number(item.max_input_tokens) : null,
      maxOutput: Number(item.max_tokens) > 0 ? Number(item.max_tokens) : null,
      ...classifyModelCapability(id, name)
    };
    });
}

async function discoverModels({ baseUrl, apiKey }, fetchImpl = globalThis.fetch) {
  const url = cleanBaseUrl(baseUrl);
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("请填写 API 密钥");
  const attempts = [];
  for (const protocol of protocolOrder(url, key)) {
    for (const endpoint of endpointCandidates(url)) {
      try {
        const response = await fetchImpl(endpoint.listUrl, {
          method: "GET",
          headers: headersFor(protocol, key),
          signal: AbortSignal.timeout(12_000)
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 220).replace(/\s+/g, " ");
          attempts.push(`${protocol} ${response.status}${detail ? `: ${detail}` : ""}`);
          continue;
        }
        const body = await response.json();
        const models = parseModels(body, protocol);
        if (!models.length) {
          attempts.push(`${protocol}: 返回了空模型列表`);
          continue;
        }
        return { protocol, baseUrl: endpoint.baseUrl, listUrl: endpoint.listUrl, models };
      } catch (error) {
        attempts.push(`${protocol}: ${error.message}`);
      }
    }
  }
  throw new Error(`模型发现失败。${attempts.slice(-3).join("；")}`);
}

function slug(value, fallback = "model") {
  const result = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return result || fallback;
}

function makeProviderId(baseUrl) {
  return `provider-${crypto.createHash("sha256").update(cleanBaseUrl(baseUrl)).digest("hex").slice(0, 10)}`;
}

function makeEnvKey(providerId) {
  return `GROK_DESKTOP_KEY_${providerId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

function classifyModelCapability(id, name = id) {
  const value = `${id || ""} ${name || ""}`.toLowerCase();
  const nonAgent = /embedding|reranker|tts|speech|asr|cosyvoice|sensevoice|(?:^|[\/_-])(image|audio|realtime|ocr|kolors|i2v|t2v|bge)(?:$|[\/_\-.0-9])/;
  if (nonAgent.test(value)) {
    return { toolCapability: "unsupported", toolCapabilityDetail: "该模型类型不适合作为工具 Agent" };
  }
  return { toolCapability: "unknown", toolCapabilityDetail: "尚未检测工具调用能力" };
}

function apiEndpoint(baseUrl, endpoint) {
  return `${cleanBaseUrl(baseUrl).replace(/\/+$/, "")}/${endpoint}`;
}

async function parseProbeResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, text: text.slice(0, 200_000), body };
}

function chatProbeCalls(result) {
  const jsonCalls = result.body?.choices?.[0]?.message?.tool_calls || [];
  if (jsonCalls.length) return jsonCalls.map((call) => call.function || call);
  const streamed = new Map();
  for (const line of String(result.text || "").split(/\r?\n/)) {
    const value = line.replace(/^data:\s*/, "").trim();
    if (!value || value === "[DONE]") continue;
    let event;
    try { event = JSON.parse(value); } catch { continue; }
    for (const call of event?.choices?.[0]?.delta?.tool_calls || []) {
      const index = Number(call.index) || 0;
      const current = streamed.get(index) || { name: "", arguments: "" };
      current.name += call.function?.name || "";
      current.arguments += call.function?.arguments || "";
      streamed.set(index, current);
    }
  }
  return [...streamed.values()];
}

async function probeOpenAiChat({ baseUrl, apiKey, model }, fetchImpl) {
  const response = await fetchImpl(apiEndpoint(baseUrl, "chat/completions"), {
    method: "POST",
    headers: { ...headersFor("openai", apiKey), "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Call probe_terminal with command pwd. Do not answer with text." }],
      tools: PROBE_TOOLS_OPENAI,
      stream: true
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const result = await parseProbeResponse(response);
  if (!result.ok) return { ...result, capability: null };
  const calls = chatProbeCalls(result);
  const call = calls[0] || result.body?.choices?.[0]?.message?.function_call;
  const name = String(call?.name || "").trim();
  return { ...result, capability: PROBE_TOOL_NAMES.has(name) ? "native" : (calls.length || call ? "bridge" : null) };
}

async function probeOpenAiResponses({ baseUrl, apiKey, model }, fetchImpl) {
  const response = await fetchImpl(apiEndpoint(baseUrl, "responses"), {
    method: "POST",
    headers: { ...headersFor("openai", apiKey), "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: "Call probe_terminal with command pwd. Do not answer with text.",
      tools: PROBE_TOOLS_OPENAI.map((tool) => ({ type: "function", ...tool.function, strict: false })),
      tool_choice: "required",
      max_output_tokens: 64,
      stream: false
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const result = await parseProbeResponse(response);
  if (!result.ok) return { ...result, capability: null };
  const call = (result.body?.output || []).find((item) => item?.type === "function_call");
  const name = String(call?.name || "").trim();
  return { ...result, capability: PROBE_TOOL_NAMES.has(name) ? "native" : (call ? "bridge" : null) };
}

async function probeAnthropicMessages({ baseUrl, apiKey, model }, fetchImpl) {
  const response = await fetchImpl(apiEndpoint(baseUrl, "messages"), {
    method: "POST",
    headers: { ...headersFor("anthropic", apiKey), "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Call probe_terminal with command pwd. Do not answer with text." }],
      tools: PROBE_TOOLS_OPENAI.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })),
      tool_choice: { type: "any" },
      max_tokens: 64,
      stream: false
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const result = await parseProbeResponse(response);
  if (!result.ok) return { ...result, capability: null };
  const call = (result.body?.content || []).find((item) => item?.type === "tool_use");
  const name = String(call?.name || "").trim();
  return { ...result, capability: PROBE_TOOL_NAMES.has(name) ? "native" : (call ? "bridge" : null) };
}

async function probeModelTools(payload, fetchImpl = globalThis.fetch) {
  const finish = (result) => ({ ...result, toolProbeVersion: TOOL_PROBE_VERSION });
  const classified = classifyModelCapability(payload?.model, payload?.name);
  if (classified.toolCapability === "unsupported") return finish({ ...classified, apiBackend: payload?.protocol === "anthropic" ? "messages" : "chat_completions", streamToolCalls: false });
  const input = { baseUrl: cleanBaseUrl(payload.baseUrl), apiKey: String(payload.apiKey || "").trim(), model: String(payload.model || "").trim() };
  if (!input.apiKey || !input.model) throw new Error("工具能力检测缺少 API 密钥或模型 ID");
  if (payload.protocol === "anthropic") {
    const result = await probeAnthropicMessages(input, fetchImpl);
    if (result.capability === "native") return finish({ toolCapability: "native", toolCapabilityDetail: "支持 Anthropic 原生工具调用", apiBackend: "messages", streamToolCalls: false });
    return finish({ toolCapability: "unsupported", toolCapabilityDetail: `未检测到工具调用支持${result.status ? `（HTTP ${result.status}）` : ""}`, apiBackend: "messages", streamToolCalls: false });
  }

  const chat = await probeOpenAiChat(input, fetchImpl);
  if (chat.capability === "native") return finish({ toolCapability: "native", toolCapabilityDetail: "支持 OpenAI Chat Completions 工具调用", apiBackend: "chat_completions", streamToolCalls: false });
  const responses = await probeOpenAiResponses(input, fetchImpl);
  if (responses.capability === "native") return finish({ toolCapability: "native", toolCapabilityDetail: "已回退到 OpenAI Responses 工具协议", apiBackend: "responses", streamToolCalls: false });
  if (chat.capability === "bridge") return finish({ toolCapability: "bridge", toolCapabilityDetail: "Chat Completions 工具名需要兼容桥修复", apiBackend: "chat_completions", streamToolCalls: false });
  const statuses = [chat.status, responses.status].filter(Boolean).join("/");
  return finish({ toolCapability: "unsupported", toolCapabilityDetail: `未检测到兼容的工具调用协议${statuses ? `（HTTP ${statuses}）` : ""}`, apiBackend: "chat_completions", streamToolCalls: false });
}

function makeLocalModelId(_providerId, remoteId) {
  return String(remoteId || "").trim();
}

function isLegacyDesktopModelId(value) {
  return /^desktop-provider[a-z0-9_-]*-/i.test(String(value || "").trim());
}

function stripLegacyDesktopModelSections(input) {
  const lines = String(input || "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let skippingLegacyModel = false;
  for (const line of lines) {
    const table = line.match(/^\s*\[model\.(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\]\s*(?:#.*)?$/);
    if (table) {
      skippingLegacyModel = isLegacyDesktopModelId(table[1] || table[2] || table[3]);
      if (skippingLegacyModel) continue;
    } else if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line)) {
      skippingLegacyModel = false;
    }
    if (!skippingLegacyModel) output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function providerAliasSuffix(provider) {
  let host = "";
  try { host = new URL(provider.baseUrl).hostname.replace(/^api\./i, "").split(".")[0]; } catch {}
  const label = slug(host || provider.name || "provider", "provider").slice(0, 18);
  const fingerprint = String(provider.id || crypto.createHash("sha256").update(String(provider.baseUrl || "")).digest("hex"))
    .replace(/^provider-/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toLowerCase() || "custom";
  return `${label}-${fingerprint}`;
}

function normalizeProviderModelIds(providers) {
  const list = Array.isArray(providers) ? providers : [];
  const ownersByModel = new Map();
  for (const provider of list) {
    for (const model of provider.models || []) {
      const remoteId = String(model.id || "").trim();
      if (!remoteId) continue;
      if (!ownersByModel.has(remoteId)) ownersByModel.set(remoteId, new Set());
      ownersByModel.get(remoteId).add(provider.id);
    }
  }

  const used = new Set();
  return list.map((provider) => ({
    ...provider,
    models: (provider.models || []).map((model) => {
      const remoteId = String(model.id || "").trim();
      const shared = (ownersByModel.get(remoteId)?.size || 0) > 1;
      let localId = shared ? `${remoteId}@${providerAliasSuffix(provider)}` : makeLocalModelId(provider.id, remoteId);
      if (used.has(localId)) {
        const hash = crypto.createHash("sha256").update(`${provider.id}\0${remoteId}`).digest("hex").slice(0, 6);
        localId = `${localId}-${hash}`;
      }
      used.add(localId);
      const capability = model.toolCapability ? {} : classifyModelCapability(remoteId, model.name);
      return {
        ...model,
        ...capability,
        id: remoteId,
        localId,
        apiBackend: model.apiBackend || (provider.protocol === "anthropic" ? "messages" : "chat_completions"),
        streamToolCalls: false
      };
    })
  }));
}

function mergeDiscoveredProviderModels(discovered, existing = []) {
  const previousById = new Map((existing || []).map((model) => [model.id, model]));
  return (discovered || []).map((model) => {
    const previous = previousById.get(model.id);
    if (!previous) return model;
    return {
      ...model,
      toolCapability: previous.toolCapability,
      toolCapabilityDetail: previous.toolCapabilityDetail,
      toolCapabilityCheckedAt: previous.toolCapabilityCheckedAt,
      toolProbeVersion: previous.toolProbeVersion,
      apiBackend: previous.apiBackend,
      streamToolCalls: false
    };
  });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function renderManagedConfig(providers) {
  const lines = [BLOCK_START, "# Generated by Grok Build Desktop. Edit providers in Desktop Settings."];
  for (const provider of providers) {
    for (const model of provider.models || []) {
      lines.push(
        "",
        `[model.${tomlString(model.localId)}]`,
        `model = ${tomlString(model.id)}`,
        `base_url = ${tomlString(model.runtimeBaseUrl || provider.runtimeBaseUrl || provider.baseUrl)}`,
        `name = ${tomlString(model.name || model.id)}`,
        `description = ${tomlString(`${provider.protocol === "anthropic" ? "Anthropic" : "OpenAI"} · ${provider.baseUrl}`)}`,
        `env_key = ${tomlString(provider.envKey)}`,
        `api_backend = ${tomlString(model.apiBackend || (provider.protocol === "anthropic" ? "messages" : "chat_completions"))}`,
        `context_window = ${Math.max(1, Number(model.contextWindow) || 200000)}`,
        `stream_tool_calls = ${model.streamToolCalls === true ? "true" : "false"}`,
        "supported_in_api = true"
      );
      if (provider.protocol === "anthropic") {
        lines.push('auth_scheme = "x_api_key"', 'extra_headers = { "anthropic-version" = "2023-06-01" }');
      }
      if (Number(model.maxOutput) > 0) lines.push(`max_completion_tokens = ${Math.round(Number(model.maxOutput))}`);
    }
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

function mergeManagedConfig(existing, providers) {
  const escapedStart = BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "g");
  const clean = stripLegacyDesktopModelSections(String(existing || "").replace(pattern, "\n")).trimEnd();
  const generated = renderManagedConfig(providers);
  return `${clean}${clean ? "\n\n" : ""}${generated}\n`;
}

module.exports = {
  BLOCK_START,
  BLOCK_END,
  TOOL_PROBE_VERSION,
  cleanBaseUrl,
  classifyModelCapability,
  discoverModels,
  endpointCandidates,
  makeProviderId,
  makeEnvKey,
  makeLocalModelId,
  isLegacyDesktopModelId,
  mergeDiscoveredProviderModels,
  mergeManagedConfig,
  normalizeProviderModelIds,
  parseModels,
  probeModelTools,
  renderManagedConfig,
  stripLegacyDesktopModelSections
};
