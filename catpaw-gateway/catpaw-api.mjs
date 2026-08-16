import { CATPAW_BASE_URL } from "./constants.mjs";

export async function fetchAgentModels({ cookie, fetchImpl = fetch, baseUrl = CATPAW_BASE_URL }) {
  const payload = await fetchJson(
    `${baseUrl}/api/agent/models?mode=AGENT`,
    cookie,
    fetchImpl,
  );
  const models = payload?.data?.models ?? payload?.data ?? [];
  if (!Array.isArray(models)) throw new Error("CatPaw model catalog has an unexpected shape");
  return models;
}

export async function fetchConversationHistory({
  cookie,
  conversationId,
  fetchImpl = fetch,
  baseUrl = CATPAW_BASE_URL,
}) {
  const url = new URL("/api/agent/conversation/history", baseUrl);
  url.searchParams.set("conversationId", conversationId);
  url.searchParams.set("size", "20");
  const payload = await fetchJson(url, cookie, fetchImpl);
  return normalizeHistoryItems(payload);
}

export function normalizeHistoryItems(payload) {
  const data = payload?.data;
  const candidates = [data?.items, data?.list, data, payload?.items, payload?.list];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.items)) return candidate.items;
    if (Array.isArray(candidate?.list)) return candidate.list;
  }
  throw new Error("CatPaw conversation history has an unexpected shape");
}

async function fetchJson(url, cookie, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      cookie,
    },
  });
  if (!response.ok) throw new Error(`CatPaw API returned HTTP ${response.status}`);
  return response.json();
}
