#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isGcodeUpdateCommand, runGcodeUpdate, waitForExit } from "./gcode-update.mjs";

const launcherPath = await realpath(fileURLToPath(import.meta.url));
const installRoot = path.dirname(launcherPath);
const core = process.env.GCODE_CORE_BIN
  || process.env.GORK_CORE_BIN
  || path.join(installRoot, "gcode-core");
const packagedConfig = path.join(installRoot, "share", "gcode", "managed_config.toml");
const gatewayEntry = path.join(installRoot, "lib", "catpaw-gateway", "serve.mjs");
const gcodeHome = process.env.GCODE_HOME
  || process.env.GORK_HOME
  || process.env.GROK_HOME
  || path.join(os.homedir(), ".gcode");
const managedConfig = path.join(gcodeHome, "managed_config.toml");

await requireReadable(core, "Gcode core binary");
await requireReadable(packagedConfig, "CatPaw model config");
await requireReadable(gatewayEntry, "CatPaw model gateway");
await installManagedConfig();

if (isGcodeUpdateCommand(process.argv.slice(2))) {
  try {
    await runGcodeUpdate({ args: process.argv.slice(2), installRoot });
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

const childEnv = {
  ...process.env,
  GCODE_HOME: gcodeHome,
  GORK_HOME: gcodeHome,
  GROK_HOME: gcodeHome,
  CATPAW_GCODE_LOCAL_TOKEN: process.env.CATPAW_GCODE_LOCAL_TOKEN
    || process.env.CATPAW_GORK_LOCAL_TOKEN
    || "loopback-only",
};

let gateway = null;
if (!isOfflineCommand(process.argv.slice(2))) {
  const health = await gatewayHealth();
  if (health === "foreign") {
    fail("Port 18765 is occupied by a service that is not the CatPaw Gcode gateway.");
  }
  if (health !== "ready") {
    gateway = spawn(process.execPath, [gatewayEntry], { env: childEnv, stdio: ["ignore", "ignore", "inherit"] });
    await waitForGateway(gateway);
  }
}

// The Gcode distribution updates as one GitHub release (launcher + core +
// gateway + config). Never let the embedded upstream core update itself from
// the Grok npm/x.ai/GCS channels.
const coreProcess = spawn(core, ["--no-auto-update", ...process.argv.slice(2)], { env: childEnv, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => coreProcess.kill(signal));
}
const exit = await waitForExit(coreProcess);
if (gateway) {
  gateway.kill("SIGTERM");
  await waitForExit(gateway).catch(() => undefined);
}
process.exitCode = exit.code ?? (exit.signal ? 128 : 1);

async function installManagedConfig() {
  await mkdir(gcodeHome, { recursive: true, mode: 0o700 });
  try {
    const current = await readFile(managedConfig, "utf8");
    if (!current.includes("catpaw-gcode-managed") && !current.includes("catpaw-gork-managed")) {
      fail(`${managedConfig} already exists and is not owned by the CatPaw Gcode distribution.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(packagedConfig, managedConfig, fsConstants.COPYFILE_FICLONE);
}

async function gatewayHealth() {
  try {
    const response = await fetch("http://127.0.0.1:18765/health", { signal: AbortSignal.timeout(500) });
    if (!response.ok) return "foreign";
    const body = await response.json();
    return body?.service === "catpaw-gcode-model-gateway" ? "ready" : "foreign";
  } catch {
    return "absent";
  }
}

async function waitForGateway(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) fail(`CatPaw model gateway exited with code ${child.exitCode}.`);
    if (await gatewayHealth() === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  fail("Timed out starting the CatPaw model gateway.");
}

function isOfflineCommand(args) {
  const first = args[0];
  return args.includes("--version")
    || args.includes("--help")
    || ["version", "help", "models", "doctor", "inspect", "completions"].includes(first);
}

async function requireReadable(filename, label) {
  try {
    await access(filename, fsConstants.R_OK);
  } catch {
    fail(`${label} is missing from the release: ${filename}`);
  }
}

function fail(message) {
  process.stderr.write(`[gcode] ${message}\n`);
  process.exit(1);
}
