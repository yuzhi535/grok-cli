import { randomUUID } from "node:crypto";
import { CATPAW_BASE_URL } from "./constants.mjs";

export const CATPAW_TOOL_VERSION = "2.0.0";

export class CatPawTurnClient {
  constructor({ cookie, fetchImpl = fetch, baseUrl = CATPAW_BASE_URL }) {
    this.cookie = cookie;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async startRound(request) {
    await this.postJson("/api/agent/conversation/round", request);
    await this.setConversationStatus(request.conversationId, "running");
  }

  async submitToolResults(conversationId, message) {
    return this.postJson("/api/agent/conversation/turn-end", {
      conversationId,
      message,
      toolVersion: CATPAW_TOOL_VERSION,
    });
  }

  async setConversationStatus(conversationId, status, extra = {}) {
    return this.postJson("/api/agent/conversation/event", {
      conversationId,
      eventType: "conversation",
      data: { timestamp: Date.now(), status, ...extra },
    });
  }

  async *turn(request) {
    const response = await this.fetchImpl(new URL("/api/agent/conversation/turn", this.baseUrl), {
      method: "POST",
      headers: this.headers("text/event-stream"),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`CatPaw turn returned HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    yield* parseSseJson(response.body);
  }

  async postJson(pathname, body) {
    const response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
      method: "POST",
      headers: this.headers("application/json"),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`CatPaw API returned HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    const payload = await response.json();
    if (payload && typeof payload === "object" && "code" in payload && Number(payload.code) !== 0) {
      throw new Error(`CatPaw API error ${payload.code}: ${payload.msg || "unknown error"}`);
    }
    return payload?.data ?? payload;
  }

  headers(accept) {
    return {
      accept,
      "content-type": "application/json",
      cookie: this.cookie,
    };
  }
}

export function buildTurnRequest({
  conversationId,
  modelId,
  message,
  tools = [],
  systemPrompt = "",
  cwd,
}) {
  const enabledTools = tools.map((tool) => tool.function?.name).filter(Boolean);
  return {
    conversationId,
    message,
    modelType: modelId,
    source: "Gork",
    mode: "CLI",
    permissionMode: "default",
    toolVersion: CATPAW_TOOL_VERSION,
    toolConfigs: tools.map(openAiToolToCatPaw),
    memoryEnabled: false,
    enableTodos: false,
    systemPromptContext: {
      useV2Template: true,
      agentSystemPrompt: systemPrompt || undefined,
      cwd: cwd || undefined,
      currentDirectory: cwd || undefined,
      enabledTools,
      isNonInteractiveSession: false,
    },
    initialPromptContext: systemPrompt ? { rulesMessage: systemPrompt } : undefined,
    rulesMessage: systemPrompt || undefined,
  };
}

export function userMessage(text, messageId = randomUUID()) {
  return {
    type: "user",
    messageId,
    content: [{ type: "text", text }],
    finished: true,
  };
}

export function toolResultMessage(results, messageId = randomUUID()) {
  return {
    type: "tool",
    messageId,
    content: results.map((result) => ({
      type: "tool_result",
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      toolResult: result.toolResult,
    })),
    finished: true,
  };
}

export function openAiToolToCatPaw(tool) {
  const fn = tool?.function ?? {};
  if (tool?.type !== "function" || typeof fn.name !== "string" || !fn.name) {
    throw new Error("Gork sent an unsupported non-function tool");
  }
  return {
    name: fn.name,
    enable: true,
    description: typeof fn.description === "string" ? fn.description : undefined,
    inputSchema: fn.parameters && typeof fn.parameters === "object" ? fn.parameters : {},
    fromClient: true,
  };
}

export async function* parseSseJson(body) {
  if (!body) throw new Error("CatPaw turn returned no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const value = parseSseBlock(block);
      if (value !== undefined) yield value;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const value = parseSseBlock(buffer);
    if (value !== undefined) yield value;
  }
}

function parseSseBlock(block) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`CatPaw returned invalid SSE JSON: ${error.message}`);
  }
}

async function safeResponseText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "unreadable response";
  }
}
