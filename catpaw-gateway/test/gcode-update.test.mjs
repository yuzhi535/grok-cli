import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createHash } from "node:crypto";
import { platformAsset, runGcodeUpdate, waitForExit } from "../gcode-update.mjs";

const execFileAsync = promisify(execFile);

test("waitForExit resolves after a child has already exited", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let timeout;
  const outcome = await Promise.race([
    waitForExit(child),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("waitForExit hung")), 250);
    }),
  ]).finally(() => clearTimeout(timeout));
  assert.deepEqual(outcome, { code: 0, signal: null });
});

test("Gcode updater verifies and atomically activates a complete release", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcode-update-test-"));
  const current = path.join(root, "current");
  const payload = path.join(root, "payload");
  const installBase = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const home = path.join(root, "home");
  const assetName = platformAsset();
  const archivePath = path.join(root, assetName);
  const oldEnv = {
    GCODE_BIN_DIR: process.env.GCODE_BIN_DIR,
    GCODE_INSTALL_ROOT: process.env.GCODE_INSTALL_ROOT,
    GCODE_HOME: process.env.GCODE_HOME,
  };
  try {
    await mkdir(path.join(current, "share", "gcode"), { recursive: true });
    await mkdir(path.join(payload, "share", "gcode"), { recursive: true });
    await writeFile(path.join(current, "share", "gcode", "release.json"), JSON.stringify({
      repository: "yuzhi535/gcode",
      tag: "gcode-v1.0.0-gcode.1",
      version: "1.0.0-gcode.1",
      commit: "old",
    }));
    await writeFile(path.join(payload, "share", "gcode", "release.json"), JSON.stringify({
      repository: "yuzhi535/gcode",
      tag: "gcode-v1.0.0-gcode.2",
      version: "1.0.0-gcode.2",
      commit: "new",
    }));
    const fakeLauncher = path.join(payload, "gcode");
    await writeFile(fakeLauncher, "#!/usr/bin/env node\nprocess.stdout.write('gcode 1.0.0-gcode.2 (new)\\n');\n");
    await chmod(fakeLauncher, 0o755);
    await execFileAsync("tar", ["-czf", archivePath, "-C", payload, "."]);
    const archive = await import("node:fs/promises").then(({ readFile }) => readFile(archivePath));
    const checksum = createHash("sha256").update(archive).digest("hex");
    const assetUrl = "https://downloads.example/gcode.tar.gz";
    const checksumUrl = `${assetUrl}.sha256`;
    const releases = [{
      draft: false,
      prerelease: true,
      published_at: "2026-08-17T02:00:00Z",
      tag_name: "gcode-v1.0.0-gcode.2",
      assets: [
        { name: assetName, browser_download_url: assetUrl },
        { name: `${assetName}.sha256`, browser_download_url: checksumUrl },
      ],
    }];
    const fetchImpl = async (url) => {
      if (url.includes("api.github.com")) return new Response(JSON.stringify(releases));
      if (url === assetUrl) return new Response(archive);
      if (url === checksumUrl) return new Response(`${checksum}  ${assetName}\n`);
      return new Response("not found", { status: 404 });
    };
    process.env.GCODE_BIN_DIR = binDir;
    process.env.GCODE_INSTALL_ROOT = installBase;
    process.env.GCODE_HOME = home;

    await runGcodeUpdate({ args: ["update"], installRoot: current, fetchImpl });

    const target = await readlink(path.join(binDir, "gcode"));
    assert.equal(target, path.join(installBase, "releases", "gcode-v1.0.0-gcode.2", "gcode"));
  } finally {
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
