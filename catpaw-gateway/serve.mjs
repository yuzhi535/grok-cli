#!/usr/bin/env node
import { startOpenAiGateway } from "./openai-gateway.mjs";

const gateway = await startOpenAiGateway({ port: 18765 });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => gateway.close(() => process.exit(0)));
}
