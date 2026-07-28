#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BLOCK_START = "# >>> gork: pi-model-import begin";
const BLOCK_END = "# <<< gork: pi-model-import end";

const OPENAI_CODEX_AUTH_PROVIDER = "openai-codex";
const OPENAI_CODEX_API = "openai-codex-responses";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_AUTH_HELPER = path.join(__dirname, "gcode-openai-codex-auth");

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

function openAiCompatibleBaseUrl(baseUrl, api) {
  const normalized = String(baseUrl).replace(/\/+$/, "");

  try {
    const url = new URL(normalized);
    if (url.hostname === "aigc.sankuai.com" && url.pathname === "/v1/anthropic") {
      url.pathname = "/v1/openai/native";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Preserve an unparseable provider URL; the model validation will surface it.
  }

  // PI stores openai-codex baseUrl as https://chatgpt.com/backend-api and
  // appends /codex/responses at request time. Keep that base here; gcode's
  // sampler applies the same rewrite.
  if (api === OPENAI_CODEX_API && !normalized) {
    return DEFAULT_CODEX_BASE_URL;
  }
  return normalized;
}

function modelRecord({ provider, providerConfig = {}, model, source }) {
  const id = model?.id;
  const api = model?.api ?? providerConfig.api;
  const baseUrl = model?.baseUrl ?? providerConfig.baseUrl ?? (api === OPENAI_CODEX_API ? DEFAULT_CODEX_BASE_URL : undefined);
  const backend = apiBackend(api);
  if (!id || !baseUrl || !backend) return undefined;

  const apiKey = model.apiKey ?? providerConfig.apiKey;
  const isCodexOAuth = api === OPENAI_CODEX_API || provider === "openai-codex";

  return {
    provider,
    id: String(id),
    baseUrl: openAiCompatibleBaseUrl(baseUrl, api),
    backend,
    name: model.name ? String(model.name) : String(id),
    contextWindow: positiveInteger(model.contextWindow),
    maxTokens: positiveInteger(model.maxTokens),
    apiKey: isCodexOAuth ? undefined : apiKey,
    // ChatGPT OAuth models have no static API key; use the shared helper.
    authProvider: isCodexOAuth && !apiKey ? OPENAI_CODEX_AUTH_PROVIDER : undefined,
    api,
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
  if (record.authProvider) lines.push(`auth_provider = ${tomlString(record.authProvider)}`);
  return lines.join("\n");
}

function renderAuthProviderBlock(helperPath) {
  return [
    `[auth_provider.${OPENAI_CODEX_AUTH_PROVIDER}]`,
    `command = ${tomlString(helperPath)}`,
    "token_ttl_secs = 3600",
    "timeout_secs = 30",
  ].join("\n");
}

export function renderImportBlock(records, settings = {}, { helperPath } = {}) {
  const keyed = assignKeys(records);
  const needsCodexAuth = keyed.some((record) => record.authProvider === OPENAI_CODEX_AUTH_PROVIDER);
  const lines = [
    BLOCK_START,
    "# Generated from PI model catalogs. Re-run `node scripts/import-pi-models.mjs` to refresh.",
  ];
  if (needsCodexAuth && helperPath) {
    lines.push(
      "",
      "# ChatGPT / Codex OAuth helper (PI-compatible: same client_id + refresh flow).",
      renderAuthProviderBlock(helperPath),
    );
  }
  // Never emit a second `[models]` table here — the user config already has one
  // for defaults / reasoning effort. Default model is patched separately via
  // `applyModelsDefault` so TOML stays free of duplicate keys.
  for (const record of keyed) lines.push("", renderModel(record));
  lines.push(BLOCK_END, "");
  return lines.join("\n");
}

/**
 * Set or update `[models].default` in the non-import portion of the config.
 * Avoids a second `[models]` table (TOML duplicate-key error).
 */
export function applyModelsDefault(existing, defaultKey) {
  if (!defaultKey) return existing;

  const start = existing.indexOf(BLOCK_START);
  const head = start < 0 ? existing : existing.slice(0, start);
  const tail = start < 0 ? "" : existing.slice(start);

  // Match an existing top-level [models] table in the head only.
  const modelsHeader = /^\[models\][ \t]*$/m;
  const match = head.match(modelsHeader);
  if (match && match.index != null) {
    const headerEnd = match.index + match[0].length;
    // End of table: next top-level [section] (not [[array]]) or EOF of head.
    const rest = head.slice(headerEnd);
    const nextTable = rest.search(/\n\[(?!\[)/);
    const tableBody = nextTable < 0 ? rest : rest.slice(0, nextTable);
    const afterTable = nextTable < 0 ? "" : rest.slice(nextTable);

    let body = tableBody;
    // Only match `default =` at the start of a line (not the leading newline
    // before the first key — `\s*` under /m would swallow it and glue the
    // value onto `[models]`).
    if (/^[ \t]*default\s*=/m.test(body)) {
      body = body.replace(
        /^[ \t]*default\s*=\s*.*$/m,
        `default = ${tomlString(defaultKey)}`,
      );
    } else {
      // Insert default as the first key of the table, preserving a leading NL.
      if (body.length === 0 || body === "\n") {
        body = `\ndefault = ${tomlString(defaultKey)}\n`;
      } else if (body.startsWith("\n")) {
        body = `\ndefault = ${tomlString(defaultKey)}${body}`;
      } else {
        body = `\ndefault = ${tomlString(defaultKey)}\n${body}`;
      }
    }
    return `${head.slice(0, headerEnd)}${body}${afterTable}${tail}`;
  }

  // No [models] table yet — insert one just before the import block (or at EOF).
  const insert = `[models]\ndefault = ${tomlString(defaultKey)}\n\n`;
  if (start < 0) {
    const needsNl = existing && !existing.endsWith("\n");
    return `${existing}${needsNl ? "\n" : ""}${insert}`;
  }
  return `${head}${head && !head.endsWith("\n") ? "\n" : ""}${insert}${tail}`;
}

/** Resolve the PI default model key after assignKeys, if present. */
export function resolveDefaultModelKey(records, settings = {}) {
  const keyed = assignKeys(records);
  const defaultRecord = keyed.find(
    (record) => record.provider === settings.defaultProvider && record.id === settings.defaultModel,
  );
  return defaultRecord?.key;
}

export function replaceImportBlock(existing, block) {
  const start = existing.indexOf(BLOCK_START);
  if (start < 0) return `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}\n${block}`;
  const end = existing.indexOf(BLOCK_END, start);
  if (end < 0) throw new Error("existing gork PI import block has no end marker");
  return `${existing.slice(0, start)}${block}${existing.slice(end + BLOCK_END.length)}`;
}

export function removeLegacyPiModelBlocks(existing) {
  const start = existing.indexOf(BLOCK_START);
  const legacy = start < 0 ? existing : existing.slice(0, start);
  const managed = start < 0 ? "" : existing.slice(start);
  const lines = legacy.split(/(?<=\n)/);
  const output = [];
  let skipping = false;

  for (const line of lines) {
    if (/^\[model\.(?:"pi-|pi-)/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[/.test(line)) skipping = false;
    if (!skipping) output.push(line);
  }
  return `${output.join("")}${managed}`;
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

/** Prefer GCODE_HOME, then GORK_HOME / GROK_HOME, then ~/.gcode. */
export function defaultGcodeHome() {
  return (
    process.env.GCODE_HOME ||
    process.env.GORK_HOME ||
    process.env.GROK_HOME ||
    path.join(os.homedir(), ".gcode")
  );
}

export function defaultTarget() {
  return path.join(defaultGcodeHome(), "config.toml");
}

/**
 * Install the Codex OAuth helper into `$GCODE_HOME/bin` so auth_provider
 * commands do not depend on this repo checkout path.
 */
export function installAuthHelper(home = defaultGcodeHome()) {
  const binDir = path.join(home, "bin");
  const dest = path.join(binDir, "gcode-openai-codex-auth");
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(REPO_AUTH_HELPER, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

export function importPiModels({ sourceDir, target = defaultTarget(), dryRun = false }) {
  const modelsJson = JSON.parse(fs.readFileSync(path.join(sourceDir, "models.json"), "utf8"));
  const storePath = path.join(sourceDir, "models-store.json");
  const storeJson = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : {};
  const records = collectModels(modelsJson, storeJson);
  const settingsPath = path.join(sourceDir, "settings.json");
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};

  let helperPath;
  if (!dryRun) {
    const home = path.dirname(target);
    helperPath = installAuthHelper(home);
  } else {
    helperPath = path.join(path.dirname(target), "bin", "gcode-openai-codex-auth");
  }

  const defaultKey = resolveDefaultModelKey(records, settings);
  const block = renderImportBlock(records, settings, { helperPath });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  let output = replaceImportBlock(removeLegacyPiModelBlocks(existing), block);
  output = applyModelsDefault(output, defaultKey);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, { mode: 0o600 });
  }
  return { imported: records.length, target, wrote: !dryRun, helperPath, defaultKey };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/import-pi-models.mjs [--source-dir DIR] [--target FILE] [--dry-run]");
    return;
  }
  const result = importPiModels({ ...options, target: options.target });
  console.log(`${result.wrote ? "Imported" : "Validated"} ${result.imported} PI models into ${result.target}`);
  if (result.helperPath) {
    console.log(`Codex OAuth helper: ${result.helperPath}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`PI model import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
