import assert from "node:assert/strict";
import test from "node:test";

import { collectModels, renderImportBlock, replaceImportBlock } from "./import-pi-models.mjs";

const models = {
  providers: {
    anthropic: {
      api: "anthropic-messages",
      baseUrl: "https://anthropic.example/v1",
      apiKey: "fixture-secret-must-not-appear-in-output",
      models: [{ id: "claude-fixture", name: "Claude Fixture", contextWindow: 200000, maxTokens: 8192 }],
    },
    openai: {
      api: "openai-completions",
      baseUrl: "https://openai.example/v1",
      models: [{ id: "gpt-fixture", name: "GPT Fixture" }],
    },
  },
};

test("imports PI protocol metadata into gork model configuration", () => {
  const records = collectModels(models, {
    codex: { models: [{ id: "codex-fixture", name: "Codex Fixture", api: "openai-codex-responses", baseUrl: "https://codex.example/v1" }] },
  });
  const block = renderImportBlock(records, { defaultProvider: "openai", defaultModel: "gpt-fixture" });

  assert.match(block, /api_backend = "chat_completions"/);
  assert.doesNotMatch(block, /auth_scheme/);
  assert.match(block, /api_backend = "chat_completions"/);
  assert.match(block, /api_backend = "responses"/);
  assert.match(block, /\[models\]\ndefault = "pi-openai-gpt-fixture"/);
  assert.match(block, /api_key = "fixture-secret-must-not-appear-in-output"/);
});

test("replaces only its managed block on repeat import", () => {
  const first = replaceImportBlock("[ui]\ntheme = \"dark\"\n", "# >>> gork: pi-model-import begin\nold\n# <<< gork: pi-model-import end\n");
  const second = replaceImportBlock(first, "# >>> gork: pi-model-import begin\nnew\n# <<< gork: pi-model-import end\n");

  assert.match(second, /\[ui\]/);
  assert.match(second, /new/);
  assert.doesNotMatch(second, /old/);
  assert.equal((second.match(/gork: pi-model-import begin/g) ?? []).length, 1);
});
