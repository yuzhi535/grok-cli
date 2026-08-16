import { randomUUID } from "node:crypto";
import http from "node:http";
import { appendAttestationAudit, attestConversationModel } from "./attestation.mjs";
import { loadCatPawAuth } from "./auth.mjs";
import {
  buildTurnRequest,
  CatPawTurnClient,
  toolResultMessage,
  userMessage,
} from "./catpaw-turn.mjs";
import {
  ATTESTED_MODELS,
  CATPAW_CLI_VERSION,
  getAttestedModelByName,
  gorkModelName,
} from "./constants.mjs";

export async function startOpenAiGateway({
  host = process.env.CATPAW_GORK_HOST || "127.0.0.1",
  port = Number(process.env.CATPAW_GORK_PORT || 18765),
  env = process.env,
  fetchImpl = fetch,
  output = process.stderr,
} = {}) {
  const auth = await loadCatPawAuth(env);
  const client = new CatPawTurnClient({ cookie: auth.cookie, fetchImpl });
  const gateway = createOpenAiGateway({ client, cookie: auth.cookie, env });
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(port, host, resolve);
  });
  const address = gateway.address();
  output.write(`[catpaw-gork] model gateway listening on http://${host}:${address.port}/v1\n`);
  return gateway;
}

export function createOpenAiGateway({
  client,
  cookie,
  env = process.env,
  attest = attestConversationModel,
  appendAudit = appendAttestationAudit,
}) {
  const sessions = new Map();
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, service: "catpaw-gork-model-gateway" });
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(response, 200, modelCatalog());
      }
      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
        return sendOpenAiError(response, 404, "unsupported endpoint", "not_found");
      }
      const body = await readJsonBody(request);
      await handleChatCompletion({
        request,
        response,
        body,
        client,
        cookie,
        env,
        sessions,
        attest,
        appendAudit,
      });
    } catch (error) {
      if (!response.headersSent) {
        sendOpenAiError(response, error.statusCode || 500, safeError(error), "catpaw_gateway_error");
      } else {
        response.destroy(error);
      }
    }
  });
}

export async function handleChatCompletion({
  request,
  response,
  body,
  client,
  cookie,
  env,
  sessions,
  attest,
  appendAudit,
}) {
  const model = getAttestedModelByName(body.model);
  if (!model) throw httpError(400, `Unknown CatPaw model: ${body.model}`);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw httpError(400, "messages must be a non-empty array");
  }

  const sessionKey = request.headers["x-grok-session-id"]
    || request.headers["x-grok-conv-id"]
    || randomUUID();
  let session = sessions.get(sessionKey);
  if (!session) {
    session = { conversationId: randomUUID(), modelId: model.id, active: false };
    sessions.set(sessionKey, session);
  }
  if (session.modelId !== model.id && session.active) {
    throw httpError(409, "Cannot switch CatPaw models while a tool call is active");
  }
  session.modelId = model.id;

  const systemPrompt = extractSystemPrompt(body.messages);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const lastRole = body.messages.at(-1)?.role;
  let catpawMessage;
  if (lastRole === "tool") {
    if (!session.active) throw httpError(409, "Tool results have no active CatPaw turn");
    catpawMessage = toolResultMessage(extractTrailingToolResults(body.messages));
    await client.submitToolResults(session.conversationId, catpawMessage);
  } else if (lastRole === "user") {
    const text = messageText(body.messages.at(-1)?.content);
    catpawMessage = userMessage(text);
    const roundRequest = buildTurnRequest({
      conversationId: session.conversationId,
      modelId: model.id,
      message: catpawMessage,
      tools,
      systemPrompt,
      cwd: request.headers["x-grok-cwd"],
    });
    await client.startRound(roundRequest);
    session.active = true;
  } else {
    throw httpError(400, `Unsupported final message role: ${lastRole || "missing"}`);
  }

  const turnRequest = buildTurnRequest({
    conversationId: session.conversationId,
    modelId: model.id,
    message: catpawMessage,
    tools,
    systemPrompt,
    cwd: request.headers["x-grok-cwd"],
  });
  const upstreamEvents = [];
  for await (const event of client.turn(turnRequest)) {
    if (event?.error) throw httpError(event.error.httpStatus || 502, event.error.message || "CatPaw turn failed");
    upstreamEvents.push(event);
  }
  const normalized = normalizeCatPawSnapshots(upstreamEvents);

  const attestationMode = env.CATPAW_GORK_ATTESTATION || "strict";
  if (attestationMode !== "off") {
    const verified = await attest({
      cookie,
      conversationId: session.conversationId,
      requestedModelId: model.id,
    });
    await appendAudit({ ...verified, catpawCliVersion: CATPAW_CLI_VERSION, surface: "gork-model-gateway" });
  }

  session.active = normalized.toolCalls.length > 0;
  if (!session.active) await client.setConversationStatus(session.conversationId, "completed");

  if (body.stream === true) {
    streamOpenAiResponse(response, normalized, model, body);
  } else {
    sendJson(response, 200, completionResponse(normalized, model));
  }
}

export function normalizeCatPawSnapshots(events) {
  let text = "";
  let reasoning = "";
  let messageId = null;
  let usage = null;
  const tools = new Map();
  const deltas = [];

  for (const event of events) {
    if (event?.usage) usage = normalizeUsage(event.usage);
    if (event?.contextInfo?.usage) usage = normalizeUsage(event.contextInfo.usage);
    const message = event?.message;
    if (!message) continue;
    messageId = message.messageId || messageId;
    for (const content of message.content || []) {
      if (content.type === "text") {
        const nextText = content.text || "";
        const nextReasoning = content.reasoningContent || "";
        const textDelta = cumulativeDelta(text, nextText, "text");
        const reasoningDelta = cumulativeDelta(reasoning, nextReasoning, "reasoning");
        text = nextText;
        reasoning = nextReasoning;
        if (textDelta || reasoningDelta) deltas.push({ text: textDelta, reasoning: reasoningDelta });
      } else if (content.type === "tool_use") {
        const previous = tools.get(content.toolCallId);
        const nextArguments = content.toolParams || "";
        const argumentDelta = cumulativeDelta(previous?.arguments || "", nextArguments, "tool arguments");
        const tool = {
          id: content.toolCallId,
          name: content.toolName,
          arguments: nextArguments,
          index: previous?.index ?? tools.size,
        };
        tools.set(content.toolCallId, tool);
        if (!previous || argumentDelta) {
          deltas.push({ tool: { ...tool, arguments: argumentDelta, first: !previous } });
        }
      }
    }
  }
  return { messageId: messageId || `chatcmpl-${randomUUID()}`, text, reasoning, toolCalls: [...tools.values()], usage, deltas };
}

export function extractTrailingToolResults(messages) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const names = new Map((assistant?.tool_calls || []).map((call) => [call.id, call.function?.name]));
  const trailing = [];
  for (let index = messages.length - 1; index >= 0 && messages[index].role === "tool"; index -= 1) {
    trailing.unshift(messages[index]);
  }
  return trailing.map((message) => {
    const toolCallId = message.tool_call_id;
    const toolName = names.get(toolCallId);
    if (!toolCallId || !toolName) throw httpError(400, `Cannot resolve tool name for ${toolCallId || "missing tool_call_id"}`);
    return { toolCallId, toolName, toolResult: messageText(message.content) };
  });
}

function streamOpenAiResponse(response, normalized, model, body) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const created = Math.floor(Date.now() / 1000);
  const id = normalized.messageId;
  writeSse(response, chunk(id, created, body.model, { role: "assistant", content: "" }, null));
  for (const delta of normalized.deltas) {
    if (delta.text) writeSse(response, chunk(id, created, body.model, { content: delta.text }, null));
    if (delta.tool) {
      const fn = { arguments: delta.tool.arguments };
      if (delta.tool.first) fn.name = delta.tool.name;
      writeSse(response, chunk(id, created, body.model, {
        tool_calls: [{
          index: delta.tool.index,
          ...(delta.tool.first ? { id: delta.tool.id, type: "function" } : {}),
          function: fn,
        }],
      }, null));
    }
  }
  writeSse(response, chunk(id, created, body.model, {}, normalized.toolCalls.length ? "tool_calls" : "stop"));
  if (normalized.usage) {
    writeSse(response, {
      id,
      object: "chat.completion.chunk",
      created,
      model: body.model,
      choices: [],
      usage: normalized.usage,
    });
  }
  response.end("data: [DONE]\n\n");
}

function completionResponse(normalized, model) {
  return {
    id: normalized.messageId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: gorkModelName(model),
    choices: [{
      index: 0,
      finish_reason: normalized.toolCalls.length ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content: normalized.text || null,
        ...(normalized.toolCalls.length ? {
          tool_calls: normalized.toolCalls.map((tool) => ({
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: tool.arguments },
          })),
        } : {}),
      },
    }],
    usage: normalized.usage || undefined,
  };
}

function modelCatalog() {
  return {
    object: "list",
    data: Object.values(ATTESTED_MODELS).map((model) => ({
      id: gorkModelName(model),
      object: "model",
      created: 0,
      owned_by: "catpaw",
    })),
  };
}

function extractSystemPrompt(messages) {
  return messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => messageText(message.content))
    .filter(Boolean)
    .join("\n\n");
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text" || part?.type === "input_text") return part.text || "";
    return JSON.stringify(part);
  }).join("\n");
}

function cumulativeDelta(previous, next, label) {
  if (next.startsWith(previous)) return next.slice(previous.length);
  if (next === previous) return "";
  throw new Error(`CatPaw ${label} snapshot was not cumulative`);
}

function normalizeUsage(usage) {
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.promptTokens ?? 0),
    completion_tokens: Number(usage.completion_tokens ?? usage.completionTokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? usage.totalTokens ?? 0),
  };
}

function chunk(id, created, model, delta, finishReason) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function writeSse(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendOpenAiError(response, status, message, code) {
  sendJson(response, status, { error: { message, type: "invalid_request_error", code } });
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10 * 1024 * 1024) throw httpError(413, "request body too large");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "request body is not valid JSON");
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeError(error) {
  return error instanceof Error ? error.message : "unknown gateway error";
}
