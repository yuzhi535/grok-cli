import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTurnRequest, toolResultMessage } from "../catpaw-turn.mjs";
import { GCODE_MODEL_PREFIX, gcodeModelName } from "../constants.mjs";
import {
  GCODE_RELEASE_REPO,
  isGcodeUpdateCommand,
  parseUpdateArgs,
  platformAsset,
  selectRelease,
} from "../gcode-update.mjs";

const configUrl = new URL("../config.toml", import.meta.url);
const launcherUrl = new URL("../gcode-launcher.mjs", import.meta.url);

test("CatPaw tools and model names are owned by Gcode", () => {
  assert.equal(GCODE_MODEL_PREFIX, "catpaw-");
  assert.equal(gcodeModelName({ name: "gpt-5.6-sol" }), "catpaw-gpt-5.6-sol");

  const request = buildTurnRequest({
    conversationId: "conversation",
    modelId: 82,
    message: toolResultMessage([{ toolCallId: "call-1", toolName: "write_file", toolResult: "ok" }]),
    tools: [{ type: "function", function: { name: "write_file", parameters: { type: "object" } } }],
  });
  assert.equal(request.source, "Gcode");
  assert.equal(request.toolConfigs[0].fromClient, true);
});

test("managed configuration exposes only the Gcode environment name", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.match(config, /^# catpaw-gcode-managed$/m);
  assert.match(config, /env_key = "CATPAW_GCODE_LOCAL_TOKEN"/);
  assert.doesNotMatch(config, /Gork|gork|GORK/);
});

test("launcher prefers Gcode names while accepting legacy input variables", async () => {
  const launcher = await readFile(launcherUrl, "utf8");
  assert.match(launcher, /process\.env\.GCODE_HOME/);
  assert.match(launcher, /process\.env\.GORK_HOME/);
  assert.match(launcher, /process\.env\.GROK_HOME/);
  assert.match(launcher, /process\.env\.CATPAW_GCODE_LOCAL_TOKEN/);
  assert.match(launcher, /process\.env\.CATPAW_GORK_LOCAL_TOKEN/);
  assert.match(launcher, /catpaw-gcode-model-gateway/);
  assert.match(launcher, /\["--no-auto-update", \.\.\.process\.argv\.slice\(2\)\]/);
  assert.doesNotMatch(launcher, /catpaw-gork-model-gateway|\[gork\]/);
});

test("public updates use only the Gcode GitHub release channel", () => {
  assert.equal(GCODE_RELEASE_REPO, "yuzhi535/gcode");
  assert.equal(isGcodeUpdateCommand(["update", "--check"]), true);
  assert.deepEqual(parseUpdateArgs(["update", "--check", "--json"]), {
    check: true,
    json: true,
    force: false,
    version: null,
  });
  assert.equal(platformAsset("darwin", "arm64"), "gcode-macos-arm64.tar.gz");
  assert.equal(platformAsset("linux", "x64"), "gcode-linux-x86_64.tar.gz");

  const release = selectRelease([
    {
      draft: false,
      prerelease: true,
      published_at: "2026-08-17T01:00:00Z",
      tag_name: "gcode-v1.2.3-gcode.8",
      assets: [
        { name: "gcode-macos-arm64.tar.gz" },
        { name: "gcode-macos-arm64.tar.gz.sha256" },
      ],
    },
    {
      draft: false,
      prerelease: true,
      published_at: "2026-08-17T02:00:00Z",
      tag_name: "gcode-v1.2.3-gcode.9",
      assets: [
        { name: "gcode-macos-arm64.tar.gz" },
        { name: "gcode-macos-arm64.tar.gz.sha256" },
      ],
    },
  ], null, "gcode-macos-arm64.tar.gz");
  assert.equal(release.tag_name, "gcode-v1.2.3-gcode.9");
});

test("Gcode update rejects Grok channel selection", () => {
  assert.throws(() => parseUpdateArgs(["update", "--stable"]), /one release channel/);
});
