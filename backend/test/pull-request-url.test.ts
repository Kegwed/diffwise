import { describe, expect, test } from "vitest";
import type { ApiError, PullRequestSummary } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import { fakeForge, fakeModelProvider } from "./fakes.ts";

const pullRequest: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [{ path: "src/users.ts", patch: "@@ -0,0 +1 @@\n+export const x = 1;" }],
};

function setup(options: Parameters<typeof fakeForge>[1] = {}) {
  return createApp({
    forge: fakeForge([pullRequest], options),
    modelProviders: [fakeModelProvider([]).provider],
    db: openDatabase(":memory:"),
  });
}

async function resolve(app: ReturnType<typeof createApp>, url: string) {
  return app.request(`/api/pull-requests/by-url?url=${encodeURIComponent(url)}`);
}

describe("Resolving a Pull Request URL", () => {
  test.each([
    "https://github.com/acme/shop/pull/7",
    "https://github.com/acme/shop/pull/7/files",
    "https://github.com/acme/shop/pull/7/files?diff=split#diff-abc",
    "https://www.github.com/acme/shop/pull/7/",
    "http://github.com/acme/shop/pull/7",
    "github.com/acme/shop/pull/7",
    "  https://github.com/acme/shop/pull/7  ",
  ])("%s resolves to the Pull Request", async (url) => {
    const response = await resolve(setup(), url);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<PullRequestSummary>({
      owner: "acme",
      repo: "shop",
      number: 7,
      title: "Add user lookup",
      author: "octocat",
      headCommit: "abc1234",
    });
  });

  test.each([
    "",
    "not a url",
    "https://gitlab.com/acme/shop/pull/7",
    "https://github.com.evil.example/acme/shop/pull/7",
    "https://github.com/acme/shop/issues/7",
    "https://github.com/acme/shop/pull/",
    "https://github.com/acme/shop/pull/0",
    "https://github.com/acme/shop/pull/7abc",
    "https://github.com/acme/pull/7",
    "ftp://github.com/acme/shop/pull/7",
  ])("%j isn't a GitHub Pull Request URL", async (url) => {
    const response = await resolve(setup(), url);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as ApiError;
    expect(error).toMatch(/isn't a GitHub Pull Request URL/);
    expect(error).toContain("https://github.com/owner/repo/pull/123");
  });

  test("a repo the GitHub App isn't installed on is an error saying to install it there", async () => {
    const response = await resolve(setup({ notInstalledOn: ["acme/shop"] }), "https://github.com/acme/shop/pull/7");

    expect(response.status).toBe(403);
    const { error } = (await response.json()) as ApiError;
    expect(error).toMatch(/isn't installed on acme\/shop/);
    expect(error).toMatch(/install it/i);
  });

  test("a Pull Request that doesn't exist in an installed repo is a 404", async () => {
    const response = await resolve(setup(), "https://github.com/acme/shop/pull/8");

    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiError).error).toMatch(/acme\/shop#8 not found/);
  });

  test("any other error reaching the Forge is reported with its message", async () => {
    const app = createApp({
      forge: {
        listPullRequests: async () => [],
        getPullRequest: async () => {
          throw new Error("GitHub replied 503 when fetching acme/shop#7: unavailable");
        },
      },
      modelProviders: [],
      db: openDatabase(":memory:"),
    });

    const response = await resolve(app, "https://github.com/acme/shop/pull/7");

    expect(response.status).toBe(500);
    expect(((await response.json()) as ApiError).error).toBe("GitHub replied 503 when fetching acme/shop#7: unavailable");
  });

  test("starting a Review of a Pull Request in a repo the GitHub App isn't installed on is the same error", async () => {
    const app = setup({ notInstalledOn: ["acme/shop"] });

    const response = await app.request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "Ollama", model: "test-model" }),
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiError).error).toMatch(/isn't installed on acme\/shop/);
  });
});
