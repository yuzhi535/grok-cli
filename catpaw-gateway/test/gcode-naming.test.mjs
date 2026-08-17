import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTurnRequest, toolResultMessage } from "../catpaw-turn.mjs";
import { GCODE_MODEL_PREFIX, gcodeModelName } from "../constants.mjs";

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
  assert.doesNotMatch(launcher, /catpaw-gork-model-gateway|\[gork\]/);
});
