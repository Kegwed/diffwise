import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { loadEnvFile } from "./env-file.ts";
import { withFixtures } from "./fixture-forge.ts";
import { fileGitHubAppStore } from "./github-app.ts";
import { githubForge } from "./github-forge.ts";
import { modelProvidersFromEnv } from "./model-provider-config.ts";
import { createReviews } from "./reviews.ts";

loadEnvFile();

const modelProviders = modelProvidersFromEnv(process.env);
const port = Number(process.env.DIFFWISE_PORT ?? 3001);

const githubAppStore = fileGitHubAppStore(
  process.env.DIFFWISE_GITHUB_APP ?? fileURLToPath(new URL("../../github-app.json", import.meta.url)),
);

const forge = withFixtures(githubForge(() => githubAppStore.load()));

const app = createApp({
  forge,
  githubApp: { store: githubAppStore },
  modelProviders,
  reviews: createReviews({
    forge,
    modelProviders,
    db: openDatabase(process.env.DIFFWISE_DB ?? fileURLToPath(new URL("../../diffwise.db", import.meta.url))),
  }),
});

serve({ fetch: app.fetch, port }, () => {
  const names = modelProviders.map((provider) => provider.name).join(", ") || "none (see README.md)";
  console.log(`Diffwise backend on http://localhost:${port}. Model Providers: ${names}`);
});
