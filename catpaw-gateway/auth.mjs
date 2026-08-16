import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function defaultSsoConfigPath(env = process.env) {
  return env.CATPAW_SSO_CONFIG || path.join(os.homedir(), ".catpaw", "sso_config.json");
}

export async function loadCatPawAuth(env = process.env) {
  const explicitCookie = env.CATPAW_COOKIE?.trim();
  if (explicitCookie) {
    return {
      cookie: explicitCookie.startsWith("ssoid=") ? explicitCookie : `ssoid=${explicitCookie}`,
      source: "CATPAW_COOKIE",
      permissions: null,
    };
  }

  const configPath = defaultSsoConfigPath(env);
  await access(configPath, fsConstants.R_OK);
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof raw.ssoid !== "string" || raw.ssoid.trim() === "") {
    throw new Error(`CatPaw SSO config has no usable ssoid: ${configPath}`);
  }
  const fileStat = await stat(configPath);
  return {
    cookie: `ssoid=${raw.ssoid}`,
    source: configPath,
    permissions: fileStat.mode & 0o777,
  };
}

export function childEnvironmentWithAuth(auth, env = process.env) {
  const childEnv = {
    ...env,
    CATPAW_COOKIE: auth.cookie,
    NO_PROXY: mergeNoProxy(env.NO_PROXY, ".sankuai.com", "catpaw.sankuai.com"),
    no_proxy: mergeNoProxy(env.no_proxy, ".sankuai.com", "catpaw.sankuai.com"),
  };
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ]) {
    delete childEnv[key];
  }
  return childEnv;
}

function mergeNoProxy(current, ...entries) {
  const values = new Set(
    String(current || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const entry of entries) values.add(entry);
  return [...values].join(",");
}
