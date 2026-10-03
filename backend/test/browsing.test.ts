import { describe, expect, test } from "vitest";
import type { ApiError, PullRequestDetail, PullRequestSummary, RepositoryListing } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { withFixtures } from "../src/fixture-forge.ts";
import type { Forge, PullRequestSnapshot } from "../src/forge.ts";
import { fakeForge, fakeModelProvider, standInReviews } from "./fakes.ts";

const userLookup: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [
    { path: "src/users.ts", patch: "@@ -0,0 +1 @@\n+export const x = 1;" },
    { path: "package-lock.json", patch: '@@ -1 +1 @@\n-"a"\n+"b"' },
  ],
};

const checkout: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 9,
  title: "Speed up checkout",
  author: "hubot",
  headCommit: "def5678",
  description: "",
  files: [{ path: "src/checkout.ts", patch: "@@ -0,0 +1 @@\n+export const y = 2;" }],
};

const docsTypo: PullRequestSnapshot = {
  owner: "acme",
  repo: "docs",
  number: 2,
  title: "Fix a typo",
  author: "octocat",
  headCommit: "0a1b2c3",
  description: "",
  files: [{ path: "README.md", patch: "@@ -1 +1 @@\n-teh\n+the" }],
};

function setup(options: Parameters<typeof fakeForge>[1] = {}) {
  return createApp({
    forge: fakeForge([userLookup, checkout, docsTypo], options),
    modelProviders: [fakeModelProvider([]).provider],
    reviews: standInReviews(),
  });
}

describe("Browsing Repositories", () => {
  test("lists the Repositories the GitHub App is installed on", async () => {
    const response = await setup().request("/api/repositories");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<RepositoryListing>({
      repositories: [
        { owner: "acme", repo: "shop" },
        { owner: "acme", repo: "docs" },
      ],
    });
  });

  test("lists a Repository's open Pull Requests, and no other Repository's", async () => {
    const response = await setup().request("/api/repositories/acme/shop/pull-requests");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<PullRequestSummary[]>([
      { owner: "acme", repo: "shop", number: 7, title: "Add user lookup", author: "octocat", headCommit: "abc1234" },
      { owner: "acme", repo: "shop", number: 9, title: "Speed up checkout", author: "hubot", headCommit: "def5678" },
    ]);
  });

  test("listing the Pull Requests of a Repository the GitHub App isn't installed on is an error saying to install it there", async () => {
    const response = await setup({ notInstalledOn: ["acme/shop"] }).request("/api/repositories/acme/shop/pull-requests");

    expect(response.status).toBe(403);
    const { error } = (await response.json()) as ApiError;
    expect(error).toMatch(/isn't installed on acme\/shop/);
    expect(error).toMatch(/install it/i);
  });
});

describe("A Pull Request's detail", () => {
  test("has its title, author, head commit and changed files, in the Pull Request's file order", async () => {
    const response = await setup().request("/api/repositories/acme/shop/pull-requests/7");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<PullRequestDetail>({
      owner: "acme",
      repo: "shop",
      number: 7,
      title: "Add user lookup",
      author: "octocat",
      headCommit: "abc1234",
      changedFiles: ["src/users.ts", "package-lock.json"],
    });
  });

  test("a pasted URL resolves to the same detail", async () => {
    const app = setup();

    const byUrl = await app.request(`/api/pull-requests/by-url?url=${encodeURIComponent("https://github.com/acme/shop/pull/7")}`);

    expect(await byUrl.json()).toEqual(await (await app.request("/api/repositories/acme/shop/pull-requests/7")).json());
  });

  test.each(["8", "0", "7abc", "-7", "7.5"])("Pull Request number %j in a Repository the GitHub App is installed on is a 404", async (number) => {
    const response = await setup().request(`/api/repositories/acme/shop/pull-requests/${number}`);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiError).error).toMatch(/not found/);
  });

  test("a Pull Request in a Repository the GitHub App isn't installed on is an error saying to install it there", async () => {
    const response = await setup({ notInstalledOn: ["acme/shop"] }).request("/api/repositories/acme/shop/pull-requests/7");

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiError).error).toMatch(/isn't installed on acme\/shop/);
  });
});

describe("Browsing with the fixture Pull Requests alongside GitHub's", () => {
  function setupWithFixtures(forge: Forge) {
    return createApp({ forge: withFixtures(forge, [docsTypo]), modelProviders: [], reviews: standInReviews() });
  }

  test("the fixture Repositories are listed before the ones the GitHub App is installed on", async () => {
    const app = setupWithFixtures(fakeForge([userLookup, checkout]));

    expect(await (await app.request("/api/repositories")).json()).toEqual<RepositoryListing>({
      repositories: [
        { owner: "acme", repo: "docs" },
        { owner: "acme", repo: "shop" },
      ],
    });
  });

  test("each Repository lists its own open Pull Requests, fixture or not", async () => {
    const app = setupWithFixtures(fakeForge([userLookup, checkout]));

    const fixture = (await (await app.request("/api/repositories/acme/docs/pull-requests")).json()) as PullRequestSummary[];
    const installed = (await (await app.request("/api/repositories/acme/shop/pull-requests")).json()) as PullRequestSummary[];

    expect(fixture.map((pr) => pr.title)).toEqual(["Fix a typo"]);
    expect(installed.map((pr) => pr.title)).toEqual(["Add user lookup", "Speed up checkout"]);
  });

  test("when GitHub's Repositories can't be listed, the fixture ones still are, with the reason the rest are missing", async () => {
    const app = setupWithFixtures({
      ...fakeForge([userLookup]),
      listRepositories: async () => {
        throw new Error("GitHub replied 401 when listing the GitHub App's installations: Bad credentials");
      },
    });

    const response = await app.request("/api/repositories");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<RepositoryListing>({
      repositories: [{ owner: "acme", repo: "docs" }],
      unlisted: "GitHub replied 401 when listing the GitHub App's installations: Bad credentials",
    });
  });
});
