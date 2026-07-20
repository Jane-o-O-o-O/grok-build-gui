const assert = require("node:assert/strict");
const http = require("node:http");
const {
  classifyModelCapability,
  discoverModels,
  makeEnvKey,
  makeLocalModelId,
  isLegacyDesktopModelId,
  mergeDiscoveredProviderModels,
  mergeManagedConfig,
  normalizeProviderModelIds,
  probeModelTools,
  renderManagedConfig,
  stripLegacyDesktopModelSections
} = require("../provider-config.cjs");

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

(async () => {
  await withServer((request, response) => {
    if (request.url !== "/v1/models" || request.headers.authorization !== "Bearer sk-openai-test") {
      response.writeHead(401).end('{"error":"wrong auth"}'); return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "gpt-fixture", owned_by: "fixture" }] }));
  }, async (baseUrl) => {
    const result = await discoverModels({ baseUrl, apiKey: "sk-openai-test" });
    assert.equal(result.protocol, "openai");
    assert.equal(result.baseUrl, `${baseUrl}/v1`);
    assert.deepEqual(result.models.map((model) => model.id), ["gpt-fixture"]);
  });

  await withServer((request, response) => {
    if (request.url !== "/v1/models" || request.headers["x-api-key"] !== "sk-ant-fixture" || request.headers["anthropic-version"] !== "2023-06-01") {
      response.writeHead(401).end('{"error":"wrong auth"}'); return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "claude-fixture", display_name: "Claude Fixture", max_input_tokens: 180000 }] }));
  }, async (baseUrl) => {
    const result = await discoverModels({ baseUrl: `${baseUrl}/v1`, apiKey: "sk-ant-fixture" });
    assert.equal(result.protocol, "anthropic");
    assert.equal(result.models[0].name, "Claude Fixture");
    assert.equal(result.models[0].contextWindow, 180000);
  });

  const provider = {
    id: "provider-fixture",
    name: "Fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "anthropic",
    envKey: makeEnvKey("provider-fixture"),
    models: [{ id: "claude-fixture", name: "Claude Fixture", localId: makeLocalModelId("provider-fixture", "claude-fixture"), contextWindow: 180000 }]
  };
  const generated = renderManagedConfig([provider]);
  assert.match(generated, /api_backend = "messages"/);
  assert.match(generated, /auth_scheme = "x_api_key"/);
  assert.match(generated, /anthropic-version/);
  assert.match(generated, /stream_tool_calls = false/);
  assert.doesNotMatch(generated, /sk-ant/);
  assert.doesNotMatch(generated, /desktop-provider/);
  const merged = mergeManagedConfig('[ui]\ntheme = "dark"\n', [provider]);
  assert.match(merged, /\[ui\]/);
  assert.equal((merged.match(/grok-desktop custom models >>>/g) || []).length, 1);
  assert.equal((mergeManagedConfig(merged, [provider]).match(/grok-desktop custom models >>>/g) || []).length, 1);

  assert.equal(makeLocalModelId("provider-fixture", "deepseek-ai/DeepSeek-V4-Pro"), "deepseek-ai/DeepSeek-V4-Pro");
  assert.equal(isLegacyDesktopModelId("desktop-providerdcfb966d81-deepseek-ai-deepseek-v4-pro"), true);
  assert.equal(isLegacyDesktopModelId("deepseek-ai/DeepSeek-V4-Pro"), false);
  const migrated = normalizeProviderModelIds([{
    ...provider,
    models: [{ id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", localId: "desktop-providerfixture-deepseek-ai-deepseek-v4-pro" }]
  }]);
  assert.equal(migrated[0].models[0].localId, "deepseek-ai/DeepSeek-V4-Pro");
  assert.equal(migrated[0].models[0].enabled, true);

  const collisions = normalizeProviderModelIds([
    { ...provider, id: "provider-aaaaaa1111", name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", models: [{ id: "shared-model", localId: "legacy-a" }] },
    { ...provider, id: "provider-bbbbbb2222", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", models: [{ id: "shared-model", localId: "legacy-b" }] }
  ]);
  assert.match(collisions[0].models[0].localId, /^shared-model@siliconflow-[a-z0-9]{6}$/);
  assert.match(collisions[1].models[0].localId, /^shared-model@openrouter-[a-z0-9]{6}$/);
  assert.notEqual(collisions[0].models[0].localId, collisions[1].models[0].localId);

  const legacyConfig = `[ui]\ntheme = "dark"\n\n[model.desktop-providerdcfb966d81-old-model]\nmodel = "old/model"\nbase_url = "https://old.invalid/v1"\n\n[model."keep/model"]\nmodel = "keep/model"\nbase_url = "https://keep.invalid/v1"\n`;
  const stripped = stripLegacyDesktopModelSections(legacyConfig);
  assert.doesNotMatch(stripped, /desktop-providerdcfb966d81-old-model/);
  assert.doesNotMatch(stripped, /old\.invalid/);
  assert.match(stripped, /\[ui\]/);
  assert.match(stripped, /\[model\."keep\/model"\]/);
  assert.match(stripped, /keep\.invalid/);
  const migratedConfig = mergeManagedConfig(legacyConfig, [provider]);
  assert.doesNotMatch(migratedConfig, /desktop-providerdcfb966d81-old-model/);
  assert.equal((migratedConfig.match(/claude-fixture/g) || []).length > 0, true);

  const refreshed = mergeDiscoveredProviderModels([
    { id: "existing-model", name: "Existing Model", toolCapability: "unknown" },
    { id: "new-model", name: "New Model", toolCapability: "unknown" }
  ], [{ id: "existing-model", name: "Old Name", toolCapability: "native", toolCapabilityDetail: "已检测", apiBackend: "responses", toolProbeVersion: 3 }]);
  assert.equal(refreshed[0].name, "Existing Model");
  assert.equal(refreshed[0].toolCapability, "native");
  assert.equal(refreshed[0].apiBackend, "responses");
  assert.equal(refreshed[0].enabled, true);
  assert.equal(refreshed[1].toolCapability, "unknown");
  assert.equal(refreshed[1].enabled, false);

  const disabledConfig = renderManagedConfig([{ ...provider, models: [
    { ...provider.models[0], enabled: true },
    { id: "disabled-model", name: "Disabled Model", localId: "disabled-model", enabled: false }
  ] }]);
  assert.match(disabledConfig, /claude-fixture/);
  assert.doesNotMatch(disabledConfig, /disabled-model/);

  assert.equal(classifyModelCapability("BAAI/bge-m3").toolCapability, "unsupported");
  assert.equal(classifyModelCapability("Qwen/Qwen-Image").toolCapability, "unsupported");

  const responsesFallback = await probeModelTools({ baseUrl: "https://fixture.invalid/v1", apiKey: "sk-fixture", protocol: "openai", model: "gpt-fixture" }, async (url) => {
    if (url.endsWith("/chat/completions")) return new Response('{"error":"unsupported"}', { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ output: [{ type: "function_call", name: "probe_terminal", arguments: '{"command":"pwd"}' }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(responsesFallback.toolCapability, "native");
  assert.equal(responsesFallback.apiBackend, "responses");

  const bridgeFallback = await probeModelTools({ baseUrl: "https://fixture.invalid/v1", apiKey: "sk-fixture", protocol: "openai", model: "gpt-fixture" }, async (url) => {
    if (url.endsWith("/responses")) return new Response('{"error":"unsupported"}', { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "", arguments: '{"command":"pwd"}' } }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(bridgeFallback.toolCapability, "bridge");
  assert.equal(bridgeFallback.apiBackend, "chat_completions");
  console.log("Provider discovery and generated Grok model configuration verified for OpenAI and Anthropic protocols.");
})().catch((error) => { console.error(error); process.exit(1); });
