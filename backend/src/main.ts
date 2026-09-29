import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { fixtureForge } from "./fixture-forge.ts";
import { modelProvidersFromEnv } from "./openai-compatible.ts";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const modelProviders = modelProvidersFromEnv(process.env);
const port = Number(process.env.DIFFWISE_PORT ?? 3001);

const app = createApp({
  forge: fixtureForge(),
  modelProviders,
  db: openDatabase(process.env.DIFFWISE_DB ?? fileURLToPath(new URL("../../diffwise.db", import.meta.url))),
});

serve({ fetch: app.fetch, port }, () => {
  const names = modelProviders.map((provider) => provider.name).join(", ") || "none (see README.md)";
  console.log(`Diffwise backend on http://localhost:${port}. Model Providers: ${names}`);
});
