import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { fixtureForge } from "./fixture-forge.ts";
import { OLLAMA_BASE_URL, openAICompatibleProvider } from "./openai-compatible.ts";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const model = process.env.DIFFWISE_MODEL;
if (!model) {
  console.error("Set DIFFWISE_MODEL to the Model that should run Reviews (e.g. DIFFWISE_MODEL=llama3.1:8b). See README.md.");
  process.exit(1);
}
const baseUrl = process.env.DIFFWISE_OLLAMA_URL ?? OLLAMA_BASE_URL;
const port = Number(process.env.DIFFWISE_PORT ?? 3001);

const app = createApp({
  forge: fixtureForge(),
  modelProvider: openAICompatibleProvider({ baseUrl }),
  model,
  db: openDatabase(process.env.DIFFWISE_DB ?? fileURLToPath(new URL("../../diffwise.db", import.meta.url))),
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`Diffwise backend on http://localhost:${port}, reviewing with ${model} via ${baseUrl}`);
});
