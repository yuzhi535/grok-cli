import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const GCODE_RELEASE_REPO = "yuzhi535/gcode";
const RELEASE_API = `https://api.github.com/repos/${GCODE_RELEASE_REPO}/releases`;

export function isGcodeUpdateCommand(args) {
  return args[0] === "update";
}

export function platformAsset(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return "gcode-macos-arm64.tar.gz";
  if (platform === "linux" && arch === "x64") return "gcode-linux-x86_64.tar.gz";
  throw new Error(`Gcode releases do not support ${platform}/${arch}.`);
}

export function selectRelease(releases, requestedTag, assetName) {
  const normalizedTag = requestedTag && (requestedTag.startsWith("gcode-v")
    ? requestedTag
    : `gcode-v${requestedTag}`);
  const candidates = releases
    .filter((release) =>
      !release.draft
      && release.tag_name?.startsWith("gcode-v")
      && (!normalizedTag || release.tag_name === normalizedTag)
      && release.assets?.some((asset) => asset.name === assetName)
      && release.assets?.some((asset) => asset.name === `${assetName}.sha256`))
    .sort((left, right) => Date.parse(right.published_at || 0) - Date.parse(left.published_at || 0));
  if (candidates.length === 0) {
    throw new Error(normalizedTag
      ? `Gcode release ${normalizedTag} was not found or has incomplete assets.`
      : "No installable Gcode release was found.");
  }
  return candidates[0];
}

export function parseUpdateArgs(args) {
  const options = { check: false, json: false, force: false, version: null };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--force-reinstall") options.force = true;
    else if (arg === "--version") {
      options.version = args[index + 1];
      index += 1;
      if (!options.version) throw new Error("--version requires a Gcode version or release tag.");
    } else if (["--alpha", "--stable", "--enterprise"].includes(arg)) {
      throw new Error("Gcode has one release channel; channel selection flags are not supported.");
    } else if (["--auto"].includes(arg) || arg === "--trigger") {
      if (arg === "--trigger") index += 1;
    } else {
      throw new Error(`Unknown gcode update option: ${arg}`);
    }
  }
  if (options.json && !options.check) throw new Error("--json requires --check.");
  return options;
}

export async function runGcodeUpdate({ args, installRoot, fetchImpl = fetch }) {
  const options = parseUpdateArgs(args);
  const metadata = await readReleaseMetadata(installRoot);
  const assetName = platformAsset();
  const requestedTag = options.version && (options.version.startsWith("gcode-v")
    ? options.version
    : `gcode-v${options.version}`);
  const releases = requestedTag
    ? [await fetchJson(`${RELEASE_API}/tags/${encodeURIComponent(requestedTag)}`, fetchImpl)]
    : await fetchJson(`${RELEASE_API}?per_page=100`, fetchImpl);
  const release = selectRelease(releases, options.version, assetName);
  const currentTag = metadata.tag;
  const updateAvailable = currentTag !== release.tag_name;

  if (options.check) {
    const status = {
      product: "gcode",
      repository: GCODE_RELEASE_REPO,
      currentVersion: metadata.version,
      currentTag,
      latestVersion: release.tag_name.replace(/^gcode-v/, ""),
      latestTag: release.tag_name,
      updateAvailable,
    };
    if (options.json) process.stdout.write(`${JSON.stringify(status)}\n`);
    else if (updateAvailable) {
      process.stdout.write(`A new Gcode release is available: ${currentTag} -> ${release.tag_name}\n`);
    } else {
      process.stdout.write(`Gcode is up to date (${currentTag}).\n`);
    }
    return;
  }

  if (!updateAvailable && !options.force) {
    process.stdout.write(`Gcode is already up to date (${currentTag}).\n`);
    return;
  }

  const asset = release.assets.find((item) => item.name === assetName);
  const checksumAsset = release.assets.find((item) => item.name === `${assetName}.sha256`);
  const archive = Buffer.from(await fetchBytes(asset.browser_download_url, fetchImpl));
  const checksumText = Buffer.from(await fetchBytes(checksumAsset.browser_download_url, fetchImpl)).toString("utf8");
  const expectedHash = checksumText.trim().split(/\s+/)[0]?.toLowerCase();
  const actualHash = createHash("sha256").update(archive).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== actualHash) {
    throw new Error(`SHA-256 verification failed for ${assetName}; the current Gcode install was not changed.`);
  }

  const installBase = resolveInstallBase(installRoot);
  const releasesDir = path.join(installBase, "releases");
  await mkdir(releasesDir, { recursive: true, mode: 0o755 });
  const stagingDir = await mkdtemp(path.join(releasesDir, `.${release.tag_name}-`));
  const archivePath = path.join(stagingDir, assetName);
  const extractedDir = path.join(stagingDir, "release");
  await mkdir(extractedDir);
  try {
    await writeFile(archivePath, archive, { mode: 0o600 });
    await run("tar", ["-xzf", archivePath, "-C", extractedDir]);
    await run(path.join(extractedDir, "gcode"), ["--version"], { GCODE_HOME: metadata.home });
    const finalDir = path.join(releasesDir, release.tag_name);
    let activatedDir = finalDir;
    try {
      await lstat(finalDir);
      activatedDir = `${finalDir}.install.${Date.now()}`;
      await rename(extractedDir, activatedDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await rename(extractedDir, finalDir);
    }
    await activateLauncher(path.join(activatedDir, "gcode"));
    process.stdout.write(`Updated Gcode to ${release.tag_name} from https://github.com/${GCODE_RELEASE_REPO}/releases/tag/${release.tag_name}\n`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function readReleaseMetadata(installRoot) {
  const metadataPath = path.join(installRoot, "share", "gcode", "release.json");
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`This Gcode build has no valid release metadata (${metadataPath}): ${error.message}`);
  }
  if (metadata.repository !== GCODE_RELEASE_REPO || !metadata.tag || !metadata.version) {
    throw new Error(`Invalid Gcode release metadata in ${metadataPath}.`);
  }
  return {
    ...metadata,
    home: process.env.GCODE_HOME || process.env.GORK_HOME || process.env.GROK_HOME || path.join(os.homedir(), ".gcode"),
  };
}

function resolveInstallBase(installRoot) {
  if (path.basename(path.dirname(installRoot)) === "releases") return path.dirname(path.dirname(installRoot));
  return process.env.GCODE_INSTALL_ROOT || path.join(os.homedir(), ".local", "share", "gcode");
}

async function activateLauncher(target) {
  const binDir = process.env.GCODE_BIN_DIR || path.join(os.homedir(), ".local", "bin");
  const link = path.join(binDir, "gcode");
  await mkdir(binDir, { recursive: true, mode: 0o755 });
  try {
    const stat = await lstat(link);
    if (!stat.isSymbolicLink()) throw new Error(`${link} exists and is not a symlink; refusing to replace it.`);
    await readlink(link);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporaryLink = path.join(binDir, `.gcode-update-${process.pid}-${Date.now()}`);
  await symlink(target, temporaryLink);
  await rename(temporaryLink, link);
}

async function fetchJson(url, fetchImpl) {
  return JSON.parse(Buffer.from(await fetchBytes(url, fetchImpl)).toString("utf8"));
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "gcode-updater" },
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}) for ${url}.`);
  return response.arrayBuffer();
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code ?? signal}): ${stderr.trim()}`));
    });
  });
}
