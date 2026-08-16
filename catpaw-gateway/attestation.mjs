import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchConversationHistory } from "./catpaw-api.mjs";
import { getAttestedModel } from "./constants.mjs";

export class ModelAttestationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ModelAttestationError";
    this.details = details;
  }
}

export async function attestConversationModel({
  cookie,
  conversationId,
  requestedModelId,
  fetchHistory = fetchConversationHistory,
  attempts = 8,
  retryDelayMs = 250,
}) {
  const expected = getAttestedModel(requestedModelId);
  if (!expected) {
    throw new ModelAttestationError(`Model ${requestedModelId} is not in the attested allowlist`, {
      conversationId,
      requestedModelId,
    });
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const items = await fetchHistory({ cookie, conversationId });
      const assistant = [...items]
        .reverse()
        .find((item) => item?.type === "assistant" || item?.role === "assistant");
      const resolvedModel = assistant?.model;
      if (typeof resolvedModel !== "string" || resolvedModel.length === 0) {
        throw new Error("latest assistant history item has no model");
      }
      if (!expected.resolvedModelPattern.test(resolvedModel)) {
        throw new ModelAttestationError(
          `Resolved model mismatch: requested ${expected.name} (${expected.id}), got ${resolvedModel}`,
          { conversationId, requestedModelId: expected.id, resolvedModel },
        );
      }
      return {
        conversationId,
        requestedModelId: expected.id,
        requestedModelName: expected.name,
        resolvedModel,
        verified: true,
        verifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof ModelAttestationError) throw error;
      lastError = error;
      if (attempt < attempts) await delay(retryDelayMs);
    }
  }
  throw new ModelAttestationError(
    `Could not attest model for conversation ${conversationId}: ${lastError?.message || "unknown error"}`,
    { conversationId, requestedModelId },
  );
}

export function defaultAuditPath(env = process.env) {
  const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return env.CATPAW_ORCA_AUDIT_PATH || path.join(stateHome, "catpaw-orca", "attestations.jsonl");
}

export async function appendAttestationAudit(attestation, auditPath = defaultAuditPath()) {
  await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await appendFile(auditPath, `${JSON.stringify(attestation)}\n`, { encoding: "utf8", mode: 0o600 });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
