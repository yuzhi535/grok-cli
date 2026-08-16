export const CATPAW_BASE_URL = "https://catpaw.sankuai.com";
export const CATPAW_CLI_VERSION = "1.0.3";
export const CATPAW_CLI_TARBALL_URL =
  "http://r.npm.sankuai.com/@catpaw/cli/download/@catpaw/cli-1.0.3.tgz";

export const ATTESTED_MODELS = Object.freeze({
  "82": Object.freeze({
    id: 82,
    name: "gpt-5.6-sol",
    resolvedModelPattern: /^gpt-5\.6-sol(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?$/,
    stability: "stable",
  }),
  "69": Object.freeze({
    id: 69,
    name: "claude-opus-4.8",
    resolvedModelPattern: /^(?:aws\.)?claude-opus-4\.8$/,
    stability: "unstable-upstream-538",
    warning: "Claude Opus 4.8 has observed intermittent upstream 538 failures.",
  }),
  "77": Object.freeze({
    id: 77,
    name: "LongCat-2.0",
    resolvedModelPattern: /^LongCat-2\.0$/i,
    stability: "verified-live",
  }),
  "75": Object.freeze({
    id: 75,
    name: "glm-5.2",
    resolvedModelPattern: /^glm-5\.2$/i,
    stability: "verified-live",
  }),
  "70": Object.freeze({
    id: 70,
    name: "MiniMax-M3",
    resolvedModelPattern: /^MiniMax-M3$/i,
    stability: "verified-live",
  }),
  "78": Object.freeze({
    id: 78,
    name: "kimi-k2.7-code",
    resolvedModelPattern: /^kimi-k2\.7-code$/i,
    stability: "verified-live",
  }),
  "81": Object.freeze({
    id: 81,
    name: "gpt-5.6-luna",
    resolvedModelPattern: /^gpt-5\.6-luna(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?$/,
    stability: "verified-live",
  }),
  "80": Object.freeze({
    id: 80,
    name: "gpt-5.6-terra",
    resolvedModelPattern: /^gpt-5\.6-terra(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?$/,
    stability: "verified-live",
  }),
  "63": Object.freeze({
    id: 63,
    name: "deepseek-v4-flash",
    resolvedModelPattern: /^deepseek-v4-flash(?:-[0-9]+)?$/i,
    stability: "verified-live",
  }),
  "64": Object.freeze({
    id: 64,
    name: "deepseek-v4-pro",
    resolvedModelPattern: /^deepseek-v4-pro(?:-[0-9]+)?$/i,
    stability: "verified-live",
  }),
  "60": Object.freeze({
    id: 60,
    name: "glm-5v-turbo",
    resolvedModelPattern: /^glm-5v-turbo$/i,
    stability: "verified-live",
  }),
  "45": Object.freeze({
    id: 45,
    name: "claude-opus-4.6",
    resolvedModelPattern: /^(?:aws\.)?claude-opus-4\.6$/,
    stability: "verified-live",
  }),
});

export const DEFAULT_MODEL_ID = 82;

export const GORK_MODEL_PREFIX = "catpaw-";

export function getAttestedModel(modelId) {
  return ATTESTED_MODELS[String(modelId)] ?? null;
}

export function attestedModelIds() {
  return Object.values(ATTESTED_MODELS).map((model) => model.id);
}

export function getAttestedModelByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const withoutPrefix = normalized.startsWith(GORK_MODEL_PREFIX)
    ? normalized.slice(GORK_MODEL_PREFIX.length)
    : normalized;
  return Object.values(ATTESTED_MODELS).find(
    (model) => model.name.toLowerCase() === withoutPrefix || String(model.id) === withoutPrefix,
  ) ?? null;
}

export function gorkModelName(model) {
  return `${GORK_MODEL_PREFIX}${model.name}`;
}
