import assert from "node:assert/strict";
import test from "node:test";
import { CatPawTurnClient, toolResultMessage } from "../catpaw-turn.mjs";
import { createOpenAiGateway } from "../openai-gateway.mjs";

test("active CatPaw conversations surface as non-retryable conflicts", async () => {
  const client = new CatPawTurnClient({
    cookie: "ssoid=redacted",
    fetchImpl: async () => new Response(JSON.stringify({
      code: 400,
      msg: "会话正在执行中，无法创建新轮次",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    client.submitToolResults("conversation", toolResultMessage([])),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.providerCode, 400);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("a failed tool continuation is retired before Gcode retries it", async (t) => {
  const roundConversationIds = [];
  let submitCount = 0;
  let turnCount = 0;
  const client = {
    async startRound(request) { roundConversationIds.push(request.conversationId); },
    async submitToolResults() {
      submitCount += 1;
      const error = new Error("CatPaw API error 400: 会话正在执行中，无法创建新轮次");
      error.statusCode = 409;
      error.retryable = false;
      throw error;
    },
    async setConversationStatus() {},
    async *turn() {
      turnCount += 1;
      if (turnCount === 1) {
        yield snapshot([{ type: "tool_use", toolCallId: "call-1", toolName: "write_file", toolParams: "{}" }]);
      } else {
        yield snapshot([{ type: "text", text: "fresh conversation", reasoningContent: "" }]);
      }
    },
  };
  const { base, headers } = await startGateway(t, client, "retire-session");
  const first = await postCompletion(base, headers, userRequest("write a file"));
  const continuation = continuationRequest(first.body, "done");

  assert.equal((await postCompletion(base, headers, continuation)).status, 409);
  assert.equal((await postCompletion(base, headers, continuation)).status, 409);
  assert.equal(submitCount, 1);

  const fresh = await postCompletion(base, headers, userRequest("continue in a fresh conversation"));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.choices[0].message.content, "fresh conversation");
  assert.equal(roundConversationIds.length, 2);
  assert.notEqual(roundConversationIds[0], roundConversationIds[1]);
});

test("duplicate tool continuations share and replay one upstream request", async (t) => {
  let submitCount = 0;
  let turnCount = 0;
  let releaseContinuation;
  const continuationGate = new Promise((resolve) => { releaseContinuation = resolve; });
  let markSubmitted;
  const submitted = new Promise((resolve) => { markSubmitted = resolve; });
  const client = {
    async startRound() {},
    async submitToolResults() {
      submitCount += 1;
      markSubmitted();
    },
    async setConversationStatus() {},
    async *turn() {
      turnCount += 1;
      if (turnCount === 1) {
        yield snapshot([{ type: "tool_use", toolCallId: "call-1", toolName: "write_file", toolParams: "{}" }]);
      } else {
        await continuationGate;
        yield snapshot([{ type: "text", text: "done once", reasoningContent: "" }]);
      }
    },
  };
  const { base, headers } = await startGateway(t, client, "dedupe-session");
  const first = await postCompletion(base, headers, userRequest("write a file"));
  const continuation = continuationRequest(first.body, "done");

  const firstContinuation = postCompletion(base, headers, continuation);
  await submitted;
  const concurrentCopy = postCompletion(base, headers, continuation);
  releaseContinuation();
  const [completed, concurrent] = await Promise.all([firstContinuation, concurrentCopy]);
  const replayed = await postCompletion(base, headers, continuation);

  assert.equal(completed.status, 200);
  assert.equal(concurrent.status, 200);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.choices[0].message.content, "done once");
  assert.equal(submitCount, 1);
  assert.equal(turnCount, 2);
});

async function startGateway(t, client, sessionId) {
  const server = createOpenAiGateway({
    client,
    cookie: "ssoid=redacted",
    attest: async ({ conversationId, requestedModelId }) => ({ conversationId, requestedModelId, verified: true }),
    appendAudit: async () => {},
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    headers: { "content-type": "application/json", "x-grok-session-id": sessionId },
  };
}

async function postCompletion(base, headers, body) {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function userRequest(content) {
  return {
    model: "catpaw-gpt-5.6-sol",
    messages: [{ role: "user", content }],
    tools: tools(),
  };
}

function continuationRequest(firstResponse, result) {
  return {
    model: "catpaw-gpt-5.6-sol",
    messages: [
      { role: "assistant", tool_calls: firstResponse.choices[0].message.tool_calls },
      { role: "tool", tool_call_id: "call-1", content: result },
    ],
    tools: tools(),
  };
}

function tools() {
  return [{ type: "function", function: { name: "write_file", parameters: { type: "object" } } }];
}

function snapshot(content) {
  return {
    conversationId: "conversation",
    message: { type: "assistant", messageId: "message", content, finished: true },
  };
}
