import assert from "node:assert/strict";
import test from "node:test";

import {
  applyModelsDefault,
  collectModels,
  removeLegacyPiModelBlocks,
  renderImportBlock,
  replaceImportBlock,
  resolveDefaultModelKey,
} from "./import-pi-models.mjs";

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
    "openai-codex": {
      models: [
        {
          id: "codex-fixture",
          name: "Codex Fixture",
          api: "openai-codex-responses",
          baseUrl: "https://chatgpt.com/backend-api",
          provider: "openai-codex",
        },
      ],
    },
  });
  const block = renderImportBlock(
    records,
    { defaultProvider: "openai", defaultModel: "gpt-fixture" },
    { helperPath: "/tmp/gcode-openai-codex-auth" },
  );

  assert.match(block, /api_backend = "chat_completions"/);
  assert.doesNotMatch(block, /auth_scheme/);
  assert.match(block, /api_backend = "responses"/);
  // Import block must NOT emit a second [models] table (duplicate-key crash).
  assert.doesNotMatch(block, /\[models\]/);
  assert.match(block, /api_key = "fixture-secret-must-not-appear-in-output"/);
  // Codex OAuth: no static key; auth_provider + chatgpt base URL like PI.
  assert.match(block, /auth_provider = "openai-codex"/);
  assert.match(block, /base_url = "https:\/\/chatgpt\.com\/backend-api"/);
  assert.match(block, /\[auth_provider\.openai-codex\]/);
  assert.match(block, /command = "\/tmp\/gcode-openai-codex-auth"/);
  assert.doesNotMatch(block, /api_key = ".*codex/i);

  assert.equal(
    resolveDefaultModelKey(records, { defaultProvider: "openai", defaultModel: "gpt-fixture" }),
    "pi-openai-gpt-fixture",
  );
});

test("applyModelsDefault updates existing [models] without duplicating the table", () => {
  const existing = `[models]\ndefault = "old"\ndefault_reasoning_effort = "high"\n\n[ui]\ntheme = "dark"\n\n# >>> gork: pi-model-import begin\nmodels\n# <<< gork: pi-model-import end\n`;
  const output = applyModelsDefault(existing, "pi-openai-codex-gpt-5-6-terra");
  assert.match(output, /\[models\]\ndefault = "pi-openai-codex-gpt-5-6-terra"\ndefault_reasoning_effort = "high"/);
  assert.equal((output.match(/^\[models\]/gm) ?? []).length, 1);
  assert.match(output, /\[ui\]/);
});

test("applyModelsDefault inserts [models] when missing", () => {
  const existing = `[ui]\ntheme = "dark"\n\n# >>> gork: pi-model-import begin\nx\n# <<< gork: pi-model-import end\n`;
  const output = applyModelsDefault(existing, "pi-new");
  assert.match(output, /\[models\]\ndefault = "pi-new"\n\n# >>> gork: pi-model-import begin/);
  assert.equal((output.match(/^\[models\]/gm) ?? []).length, 1);
});

test("converts Friday Anthropic endpoints to the OpenAI-compatible endpoint", () => {
  const records = collectModels({
    providers: {
      friday: {
        api: "openai-completions",
        baseUrl: "https://aigc.sankuai.com/v1/anthropic",
        models: [{ id: "deepseek-v4-pro" }],
      },
    },
  }, {});

  assert.equal(records[0].backend, "chat_completions");
  assert.equal(records[0].baseUrl, "https://aigc.sankuai.com/v1/openai/native");
  assert.equal(records[0].id, "deepseek-v4-pro");
});

test("replaces only its managed block on repeat import", () => {
  const first = replaceImportBlock("[ui]\ntheme = \"dark\"\n", "# >>> gork: pi-model-import begin\nold\n# <<< gork: pi-model-import end\n");
  const second = replaceImportBlock(first, "# >>> gork: pi-model-import begin\nnew\n# <<< gork: pi-model-import end\n");

  assert.match(second, /\[ui\]/);
  assert.match(second, /new/);
  assert.doesNotMatch(second, /old/);
  assert.equal((second.match(/gork: pi-model-import begin/g) ?? []).length, 1);
});

test("removes only legacy unmarked PI model sections", () => {
  const output = removeLegacyPiModelBlocks(
    "[models]\ndefault = \"pi-old\"\n[model.pi-old]\nmodel = \"old\"\napi_key = \"fixture\"\n[ui]\ntheme = \"dark\"\n# >>> gork: pi-model-import begin\nnew\n# <<< gork: pi-model-import end\n",
  );

  assert.match(output, /\[models\]/);
  assert.match(output, /\[ui\]/);
  assert.match(output, /theme = "dark"/);
  assert.match(output, /gork: pi-model-import begin/);
  assert.doesNotMatch(output, /\[model\.pi-old\]/);
  assert.doesNotMatch(output, /api_key = "fixture"/);
});
