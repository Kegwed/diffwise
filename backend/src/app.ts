import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type {
  ApiError,
  GitHubAppStatus,
  ModelProviderListing,
  PullRequestDetail,
  PullRequestSummary,
  RepositoryListing,
  RepositoryRef,
  Review,
  StartReviewRequest,
} from "@diffwise/shared";
import { getReview, saveReview, type Database } from "./db.ts";
import { ForgeAccessError, type Forge, type PullRequestSnapshot } from "./forge.ts";
import {
  appManifest,
  convertManifestCode,
  installUrl,
  manifestPage,
  memoryGitHubAppStore,
  type GitHubAppCredentials,
  type GitHubAppStore,
} from "./github-app.ts";
import type { ModelProvider } from "./model-provider.ts";
import { parsePullRequestUrl } from "./pull-request-url.ts";
import { runReview } from "./review-engine.ts";

export interface AppDependencies {
  forge: Forge;
  /** The configured Model Providers, in the order the Model listing shows them. */
  modelProviders: ModelProvider[];
  db: Database;
  /** How long to wait for one Model call before giving up on it; defaults to DEFAULT_MODEL_CALL_TIMEOUT_MS. */
  modelCallTimeoutMs?: number;
  /** Where Diffwise's GitHub App credentials are saved, and how they're fetched from GitHub; defaults to nothing saved yet. */
  githubApp?: {
    store: GitHubAppStore;
    convertManifestCode?: (code: string) => Promise<GitHubAppCredentials>;
  };
}

export function createApp({
  forge,
  modelProviders,
  db,
  modelCallTimeoutMs,
  githubApp: { store: githubAppStore, convertManifestCode: convertCode = convertManifestCode } = {
    store: memoryGitHubAppStore(),
  },
}: AppDependencies) {
  const app = new Hono();
  /** The state each Manifest page sent to GitHub, so only GitHub's redirect back from one of them is accepted. */
  const manifestStates = new Set<string>();

  app.get("/api/github-app", (c) => {
    const credentials = githubAppStore.load();
    return c.json<GitHubAppStatus>(
      credentials
        ? { status: "created", name: credentials.name, htmlUrl: credentials.htmlUrl, installUrl: installUrl(credentials) }
        : { status: "not-created" },
    );
  });

  app.get("/api/github-app/new", (c) => {
    if (githubAppStore.load()) return c.redirect("/");
    const state = randomUUID();
    manifestStates.add(state);
    return c.html(manifestPage(appManifest(new URL(c.req.url).origin), state));
  });

  app.get("/api/github-app/callback", async (c) => {
    const { code, state } = c.req.query();
    if (!code || !state || !manifestStates.delete(state)) {
      return c.text("This isn't a redirect back from a GitHub App Diffwise asked GitHub to create. Start again from Diffwise.", 400);
    }
    try {
      githubAppStore.save(await convertCode(code));
    } catch (error) {
      return c.text(`${(error as Error).message}\n\nStart again from Diffwise.`, 502);
    }
    return c.redirect("/");
  });

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

  app.get("/api/repositories", async (c) => {
    return c.json<RepositoryListing>(await forge.listRepositories());
  });

  app.get("/api/repositories/:owner/:repo/pull-requests", async (c) => {
    const { owner, repo } = c.req.param();
    return c.json<PullRequestSummary[]>(await forge.listOpenPullRequests({ owner, repo }));
  });

  app.get("/api/pull-requests/by-url", async (c) => {
    const url = c.req.query("url") ?? "";
    const ref = parsePullRequestUrl(url);
    if (!ref) {
      return c.json<ApiError>(
        {
          error: `${JSON.stringify(url.trim())} isn't a GitHub Pull Request URL. Paste one like https://github.com/owner/repo/pull/123`,
        },
        400,
      );
    }
    const pullRequest = await forge.getPullRequest(ref);
    if (!pullRequest) return c.json<ApiError>({ error: pullRequestNotFound(ref) }, 404);
    return c.json<PullRequestDetail>(detail(pullRequest));
  });

  app.get("/api/repositories/:owner/:repo/pull-requests/:number", async (c) => {
    const { owner, repo, number } = c.req.param();
    // No Pull Request has a number that isn't a positive integer, so the Forge isn't asked.
    const pullRequest = /^[1-9]\d*$/.test(number) ? await forge.getPullRequest({ owner, repo, number: Number(number) }) : undefined;
    if (!pullRequest) return c.json<ApiError>({ error: pullRequestNotFound({ owner, repo, number }) }, 404);
    return c.json<PullRequestDetail>(detail(pullRequest));
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
      return c.json<ApiError>({ error: pullRequestNotFound(ref) }, 404);
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

  app.onError((error, c) => {
    if (error instanceof ForgeAccessError) return c.json<ApiError>({ error: error.message }, 403);
    // Self-hosted and single-user, so the message (e.g. GitHub's reply) is more use to the user than a bare 500.
    console.error(error);
    return c.json<ApiError>({ error: error.message }, 500);
  });

  return app;
}

function detail({ owner, repo, number, title, author, headCommit, files }: PullRequestSnapshot): PullRequestDetail {
  return { owner, repo, number, title, author, headCommit, changedFiles: files.map((file) => file.path) };
}

/** `number` as asked for, which in a URL may not be a number at all. */
function pullRequestNotFound({ owner, repo, number }: RepositoryRef & { number: number | string }): string {
  return `Pull Request ${owner}/${repo}#${number} not found`;
}
