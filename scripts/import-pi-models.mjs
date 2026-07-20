#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const BLOCK_START = "# >>> gork: pi-model-import begin";
const BLOCK_END = "# <<< gork: pi-model-import end";

function tomlString(value) {
  return JSON.stringify(String(value));
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "model";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function apiBackend(api) {
  switch (api) {
    case "anthropic-messages":
      return "chat_completions";
    case "openai-completions":
      return "chat_completions";
    case "openai-responses":
    case "openai-codex-responses":
      return "responses";
    default:
      return undefined;
  }
}

function modelRecord({ provider, providerConfig = {}, model, source }) {
  const id = model?.id;
  const baseUrl = model?.baseUrl ?? providerConfig.baseUrl;
  const backend = apiBackend(model?.api ?? providerConfig.api);
  if (!id || !baseUrl || !backend) return undefined;

  return {
    provider,
    id: String(id),
    baseUrl: String(baseUrl),
    backend,
    name: model.name ? String(model.name) : String(id),
    contextWindow: positiveInteger(model.contextWindow),
    maxTokens: positiveInteger(model.maxTokens),
    apiKey: model.apiKey ?? providerConfig.apiKey,
    source,
  };
}

export function collectModels(modelsJson, storeJson) {
  const records = [];
  for (const [provider, config] of Object.entries(modelsJson?.providers ?? {})) {
    for (const model of config?.models ?? []) {
      const record = modelRecord({ provider, providerConfig: config, model, source: "models.json" });
      if (record) records.push(record);
    }
  }
  for (const [provider, config] of Object.entries(storeJson ?? {})) {
    for (const model of config?.models ?? []) {
      const record = modelRecord({ provider: model.provider ?? provider, model, source: "models-store.json" });
      if (record) records.push(record);
    }
  }

  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.provider}\0${record.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assignKeys(records) {
  const counts = new Map();
  return records.map((record) => {
    const base = `pi-${slug(record.provider)}-${slug(record.id)}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...record, key: count === 1 ? base : `${base}-${count}` };
  });
}

function renderModel(record) {
  const lines = [
    `[model.${tomlString(record.key)}]`,
    `model = ${tomlString(record.id)}`,
    `base_url = ${tomlString(record.baseUrl)}`,
    `name = ${tomlString(record.name)}`,
    `api_backend = ${tomlString(record.backend)}`,
  ];
  if (record.contextWindow) lines.push(`context_window = ${record.contextWindow}`);
  if (record.maxTokens) lines.push(`max_completion_tokens = ${record.maxTokens}`);
  if (record.apiKey) lines.push(`api_key = ${tomlString(record.apiKey)}`);
  return lines.join("\n");
}

export function renderImportBlock(records, settings = {}) {
  const keyed = assignKeys(records);
  const defaultRecord = keyed.find(
    (record) => record.provider === settings.defaultProvider && record.id === settings.defaultModel,
  );
  const lines = [
    BLOCK_START,
    "# Generated from PI model catalogs. Re-run `node scripts/import-pi-models.mjs` to refresh.",
  ];
  if (defaultRecord) lines.push("", "[models]", `default = ${tomlString(defaultRecord.key)}`);
  for (const record of keyed) lines.push("", renderModel(record));
  lines.push(BLOCK_END, "");
  return lines.join("\n");
}

export function replaceImportBlock(existing, block) {
  const start = existing.indexOf(BLOCK_START);
  if (start < 0) return `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}\n${block}`;
  const end = existing.indexOf(BLOCK_END, start);
  if (end < 0) throw new Error("existing gork PI import block has no end marker");
  return `${existing.slice(0, start)}${block}${existing.slice(end + BLOCK_END.length)}`;
}

function parseArgs(args) {
  const options = { sourceDir: path.join(os.homedir(), ".pi", "agent"), dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--source-dir") options.sourceDir = args[++i];
    else if (args[i] === "--target") options.target = args[++i];
    else if (args[i] === "--dry-run") options.dryRun = true;
    else if (args[i] === "--help") options.help = true;
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  return options;
}

export function defaultTarget() {
  return path.join(process.env.GORK_HOME || path.join(os.homedir(), ".gork"), "config.toml");
}

export function importPiModels({ sourceDir, target = defaultTarget(), dryRun = false }) {
  const modelsJson = JSON.parse(fs.readFileSync(path.join(sourceDir, "models.json"), "utf8"));
  const storePath = path.join(sourceDir, "models-store.json");
  const storeJson = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : {};
  const records = collectModels(modelsJson, storeJson);
  const settingsPath = path.join(sourceDir, "settings.json");
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
  const block = renderImportBlock(records, settings);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const output = replaceImportBlock(existing, block);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, { mode: 0o600 });
  }
  return { imported: records.length, target, wrote: !dryRun };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/import-pi-models.mjs [--source-dir DIR] [--target FILE] [--dry-run]");
    return;
  }
  const result = importPiModels({ ...options, target: options.target });
  console.log(`${result.wrote ? "Imported" : "Validated"} ${result.imported} PI models into ${result.target}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`PI model import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
