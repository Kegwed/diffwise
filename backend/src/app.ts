import { Hono } from "hono";
import type { ApiError, PullRequestSummary, Review, StartReviewRequest } from "@diffwise/shared";
import { getReview, saveReview, type Database } from "./db.ts";
import type { Forge } from "./forge.ts";
import type { ModelProvider } from "./model-provider.ts";
import { runReview } from "./review-engine.ts";

export interface AppDependencies {
  forge: Forge;
  modelProvider: ModelProvider;
  /** The Model every Review runs on. */
  model: string;
  db: Database;
}

export function createApp({ forge, modelProvider, model, db }: AppDependencies) {
  const app = new Hono();

  app.get("/api/pull-requests", async (c) => {
    return c.json<PullRequestSummary[]>(await forge.listPullRequests());
  });

  app.post("/api/reviews", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as Partial<StartReviewRequest> | undefined;
    const ref = body?.pullRequest;
    if (!ref || typeof ref.owner !== "string" || typeof ref.repo !== "string" || typeof ref.number !== "number") {
      return c.json<ApiError>({ error: "Expected { pullRequest: { owner, repo, number } }" }, 400);
    }
    const pullRequest = await forge.getPullRequest(ref);
    if (!pullRequest) {
      return c.json<ApiError>({ error: `Pull Request ${ref.owner}/${ref.repo}#${ref.number} not found` }, 404);
    }
    const review = await runReview(pullRequest, model, modelProvider);
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
