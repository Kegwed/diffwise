import { describe, expect, test } from "vitest";
import type { ApiError, PullRequestRef } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import type { FixturePullRequest } from "../src/fixture-forge.ts";
import { fakeForge, fakeModelProvider, standInReviews } from "./fakes.ts";

const pullRequest: FixturePullRequest = {
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
    reviews: standInReviews(),
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
    expect(await response.json()).toMatchObject<PullRequestRef>({ owner: "acme", repo: "shop", number: 7 });
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

  test("a Repository the GitHub App isn't installed on is an error saying to install it there", async () => {
    const response = await resolve(setup({ notInstalledOn: ["acme/shop"] }), "https://github.com/acme/shop/pull/7");

    expect(response.status).toBe(403);
    const { error } = (await response.json()) as ApiError;
    expect(error).toMatch(/isn't installed on acme\/shop/);
    expect(error).toMatch(/install it/i);
  });

  test("a Pull Request that doesn't exist in a Repository the GitHub App is installed on is a 404", async () => {
    const response = await resolve(setup(), "https://github.com/acme/shop/pull/8");

    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiError).error).toMatch(/acme\/shop#8 not found/);
  });

  test("any other error reaching the Forge is reported with its message", async () => {
    const app = createApp({
      forge: {
        listRepositories: async () => ({ repositories: [] }),
        listOpenPullRequests: async () => [],
        getPullRequest: async () => {
          throw new Error("GitHub replied 503 when fetching acme/shop#7: unavailable");
        },
        getPullRequestSummary: async () => {
          throw new Error("GitHub replied 503 when fetching acme/shop#7: unavailable");
        },
      },
      modelProviders: [],
      reviews: standInReviews(),
    });

    const response = await resolve(app, "https://github.com/acme/shop/pull/7");

    expect(response.status).toBe(500);
    expect(((await response.json()) as ApiError).error).toBe("GitHub replied 503 when fetching acme/shop#7: unavailable");
  });
});
