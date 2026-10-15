import { describe, expect, test } from "vitest";
import type { ApiError, OpenPullRequest, PullRequestDetail, RepositoryListing } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { FIXTURE_UPDATED_AT, withFixtures, type FixturePullRequest } from "../src/fixture-forge.ts";
import type { Forge } from "../src/forge.ts";
import { fakeForge, fakeModelProvider, held, standInReviews } from "./fakes.ts";
import { completedReview, followReview, setupReviews, sqlInjection, startReview, usersPatch } from "./reviewing.ts";

const userLookup: FixturePullRequest = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  updatedAt: "2026-10-01T09:30:00Z",
  state: "open",
  baseBranch: "develop",
  headBranch: "user-lookup",
  description: "Adds an endpoint to look users up by name.",
  files: [
    { path: "src/users.ts", patch: "@@ -0,0 +1,2 @@\n+export const x = 1;\n+export const y = 2;" },
    { path: "package-lock.json", patch: '@@ -1 +1 @@\n-"a"\n+"b"' },
    // GitHub sends no patch for a binary file.
    { path: "assets/logo.png", patch: "" },
  ],
};

const checkout: FixturePullRequest = {
  owner: "acme",
  repo: "shop",
  number: 9,
  title: "Speed up checkout",
  author: "hubot",
  headCommit: "def5678",
  description: "",
  files: [{ path: "src/checkout.ts", patch: "@@ -0,0 +1 @@\n+export const y = 2;" }],
};

const docsTypo: FixturePullRequest = {
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

  test("lists a Repository's open Pull Requests with their branches and when they were last updated, and no other Repository's", async () => {
    const response = await setup().request("/api/repositories/acme/shop/pull-requests");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<OpenPullRequest[]>([
      {
        owner: "acme",
        repo: "shop",
        number: 7,
        title: "Add user lookup",
        author: "octocat",
        headCommit: "abc1234",
        baseBranch: "develop",
        headBranch: "user-lookup",
        updatedAt: "2026-10-01T09:30:00Z",
      },
      {
        owner: "acme",
        repo: "shop",
        number: 9,
        title: "Speed up checkout",
        author: "hubot",
        headCommit: "def5678",
        baseBranch: "main",
        headBranch: "fixture",
        updatedAt: FIXTURE_UPDATED_AT,
      },
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
  test("has its title, author, head commit, state, branches and changed files, in the Pull Request's file order", async () => {
    const response = await setup().request("/api/repositories/acme/shop/pull-requests/7");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<PullRequestDetail>({
      owner: "acme",
      repo: "shop",
      number: 7,
      title: "Add user lookup",
      author: "octocat",
      headCommit: "abc1234",
      updatedAt: "2026-10-01T09:30:00Z",
      state: "open",
      baseBranch: "develop",
      headBranch: "user-lookup",
      changedFiles: [
        { path: "src/users.ts", additions: 2, deletions: 0, binary: false },
        { path: "package-lock.json", additions: 1, deletions: 1, binary: false },
        { path: "assets/logo.png", additions: 0, deletions: 0, binary: true },
      ],
    });
  });

  test("of a fixture Pull Request is open into main unless it says otherwise", async () => {
    const response = await setup().request("/api/repositories/acme/shop/pull-requests/9");

    expect(await response.json()).toMatchObject({ state: "open", baseBranch: "main" });
  });

  test("of a merged Pull Request says so, and it isn't listed among the open ones", async () => {
    const app = createApp({
      forge: fakeForge([userLookup, { ...checkout, state: "merged" }]),
      modelProviders: [],
      reviews: standInReviews(),
    });

    const detail = (await (await app.request("/api/repositories/acme/shop/pull-requests/9")).json()) as PullRequestDetail;
    const open = (await (await app.request("/api/repositories/acme/shop/pull-requests")).json()) as OpenPullRequest[];

    expect(detail.state).toBe("merged");
    expect(open.map((pr) => pr.number)).toEqual([7]);
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

    const fixture = (await (await app.request("/api/repositories/acme/docs/pull-requests")).json()) as OpenPullRequest[];
    const installed = (await (await app.request("/api/repositories/acme/shop/pull-requests")).json()) as OpenPullRequest[];

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

describe("Each open Pull Request's latest Review", () => {
  const lookup: FixturePullRequest = { ...userLookup, files: [{ path: "src/users.ts", patch: usersPatch }] };

  /** The fake Forge, recording the name of each method called on it, so a test can say what the listing asked it. */
  function countingForge(pullRequests: FixturePullRequest[]) {
    const calls: string[] = [];
    const forge = fakeForge(pullRequests);
    const counted = Object.fromEntries(
      Object.entries(forge).map(([method, call]: [string, (...args: never[]) => unknown]) => [
        method,
        (...args: never[]) => {
          calls.push(method);
          return call(...args);
        },
      ]),
    ) as unknown as Forge;
    return { forge: counted, calls };
  }

  function setupListing(pullRequests: FixturePullRequest[], modelResponses: unknown[]) {
    const { forge, calls } = countingForge(pullRequests);
    const { reviews } = setupReviews(modelResponses, { forge });
    const app = createApp({ forge, modelProviders: [], reviews });
    async function listOpen(): Promise<OpenPullRequest[]> {
      const response = await app.request("/api/repositories/acme/shop/pull-requests");
      expect(response.status).toBe(200);
      return (await response.json()) as OpenPullRequest[];
    }
    return { reviews, calls, listOpen };
  }

  test("is its newest Review, with its Finding counts; a Pull Request with no Reviews has none", async () => {
    const { reviews, listOpen } = setupListing([lookup, checkout], [{ findings: [] }, { findings: [sqlInjection] }]);
    await completedReview(reviews, lookup);
    const newest = await completedReview(reviews, lookup);

    const [reviewed, unreviewed] = await listOpen();

    expect(reviewed!.latestReview).toEqual({
      id: newest.id,
      modelProvider: "Ollama",
      model: "test-model",
      headCommit: "abc1234",
      createdAt: newest.createdAt,
      status: "complete",
      findingCounts: { "bad-practice": 0, "security-issue": 1 },
      severityCounts: { low: 0, medium: 0, high: 0, critical: 1 },
      outdated: false,
    });
    expect(unreviewed).not.toHaveProperty("latestReview");
  });

  test("is Outdated once new commits are pushed to its Pull Request", async () => {
    const pullRequests = [lookup];
    const { reviews, listOpen } = setupListing(pullRequests, [{ findings: [] }]);
    await completedReview(reviews, lookup);

    pullRequests[0] = { ...lookup, headCommit: "fed4321" };

    expect((await listOpen())[0]!.latestReview).toMatchObject({ headCommit: "abc1234", outdated: true });
  });

  test("says how many of its files have settled while it's running", async () => {
    const answer = held({ findings: [] });
    const { reviews, listOpen } = setupListing([lookup], [answer]);
    const { id } = await startReview(reviews, lookup);

    expect((await listOpen())[0]!.latestReview).toMatchObject({ id, status: "running", progress: { settled: 0, total: 1 }, outdated: false });

    answer.release();
    await followReview(reviews, id).rest();
  });

  test("is listed without asking the Forge for more than the open Pull Requests", async () => {
    const { reviews, calls, listOpen } = setupListing([lookup, checkout], [{ findings: [] }]);
    await completedReview(reviews, lookup);
    calls.length = 0;

    await listOpen();

    expect(calls).toEqual(["listOpenPullRequests"]);
  });
});
