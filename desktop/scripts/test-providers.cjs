const assert = require("node:assert/strict");
const http = require("node:http");
const {
  discoverModels,
  makeEnvKey,
  makeLocalModelId,
  mergeManagedConfig,
  renderManagedConfig
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
  assert.doesNotMatch(generated, /sk-ant/);
  const merged = mergeManagedConfig('[ui]\ntheme = "dark"\n', [provider]);
  assert.match(merged, /\[ui\]/);
  assert.equal((merged.match(/grok-desktop custom models >>>/g) || []).length, 1);
  assert.equal((mergeManagedConfig(merged, [provider]).match(/grok-desktop custom models >>>/g) || []).length, 1);
  console.log("Provider discovery and generated Grok model configuration verified for OpenAI and Anthropic protocols.");
})().catch((error) => { console.error(error); process.exit(1); });
