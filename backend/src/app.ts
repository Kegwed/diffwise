import { Hono } from "hono";
import type { ApiError, ModelProviderListing, PullRequestSummary, Review, StartReviewRequest } from "@diffwise/shared";
import { getReview, saveReview, type Database } from "./db.ts";
import type { Forge } from "./forge.ts";
import type { ModelProvider } from "./model-provider.ts";
import { runReview } from "./review-engine.ts";

export interface AppDependencies {
  forge: Forge;
  /** The configured Model Providers, in the order the Model listing shows them. */
  modelProviders: ModelProvider[];
  db: Database;
  /** How long to wait for one Model call before giving up on it; defaults to DEFAULT_MODEL_CALL_TIMEOUT_MS. */
  modelCallTimeoutMs?: number;
}

export function createApp({ forge, modelProviders, db, modelCallTimeoutMs }: AppDependencies) {
  const app = new Hono();

  app.get("/api/models", async (c) => {
    const listings = await Promise.all(
      modelProviders.map(async (modelProvider): Promise<ModelProviderListing> => {
        try {
          return { modelProvider: modelProvider.name, status: "available", models: await modelProvider.listModels() };
        } catch (error) {
          return { modelProvider: modelProvider.name, status: "unavailable", reason: (error as Error).message };
        }
      }),
    );
    return c.json<ModelProviderListing[]>(listings);
  });

  app.get("/api/pull-requests", async (c) => {
    return c.json<PullRequestSummary[]>(await forge.listPullRequests());
  });

  app.post("/api/reviews", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as Partial<StartReviewRequest> | undefined;
    const ref = body?.pullRequest;
    if (!ref || typeof ref.owner !== "string" || typeof ref.repo !== "string" || typeof ref.number !== "number") {
      return c.json<ApiError>({ error: "Expected { pullRequest: { owner, repo, number }, modelProvider, model }" }, 400);
    }
    const modelProvider = modelProviders.find((provider) => provider.name === body?.modelProvider);
    if (!modelProvider) {
      return c.json<ApiError>({ error: `No Model Provider named ${JSON.stringify(body?.modelProvider)} is configured` }, 400);
    }
    const model = body?.model;
    if (typeof model !== "string" || model === "") {
      return c.json<ApiError>({ error: "Expected a Model to run the Review" }, 400);
    }
    const pullRequest = await forge.getPullRequest(ref);
    if (!pullRequest) {
      return c.json<ApiError>({ error: `Pull Request ${ref.owner}/${ref.repo}#${ref.number} not found` }, 404);
    }
    const review = await runReview(pullRequest, model, modelProvider, { modelCallTimeoutMs });
    saveReview(db, review);
    return c.json<Review>(review, 201);
  });

  app.get("/api/reviews/:id", (c) => {
    const review = getReview(db, c.req.param("id"));
    if (!review) return c.json<ApiError>({ error: "Review not found" }, 404);
    return c.json<Review>(review);
  });

  return app;
}
