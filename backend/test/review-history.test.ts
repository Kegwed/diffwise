import { describe, expect, test } from "vitest";
import type { ApiError, Review, ReviewSummary } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import type { ModelProvider } from "../src/model-provider.ts";
import { fakeForge, fakeModelProvider, held } from "./fakes.ts";
import { completedReview, fetchReview, followReview, startReview } from "./reviewing.ts";

const pullRequest: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [
    {
      path: "src/users.ts",
      patch: [
        "@@ -1,2 +1,4 @@",
        " import { db } from './db';",
        "+export function findUser(name: string) {",
        "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
        "+}",
      ].join("\n"),
    },
  ],
};

const sqlInjection = {
  kind: "security-issue",
  severity: "critical",
  startLine: 3,
  endLine: 3,
  title: "SQL injection",
  explanation: "The name is interpolated straight into the SQL string.",
};

const vagueName = {
  kind: "bad-practice",
  severity: "low",
  startLine: 2,
  endLine: 2,
  title: "Vague name",
  explanation: "findUser doesn't say it looks users up by name.",
};

type App = ReturnType<typeof createApp>;

function setup(modelProviders: ModelProvider[], others: PullRequestSnapshot[] = []) {
  const pullRequests = [pullRequest, ...others];
  const app = createApp({ forge: fakeForge(pullRequests), modelProviders, db: openDatabase(":memory:") });
  /** Moves the Pull Request's head commit on, as pushing new commits to it does. The fake Forge serves `pullRequests` as it then is. */
  const push = (headCommit: string) => void (pullRequests[0] = { ...pullRequest, headCommit });
  return { app, push };
}

async function listReviews(app: App, number = pullRequest.number): Promise<ReviewSummary[]> {
  const response = await app.request(`/api/repositories/acme/shop/pull-requests/${number}/reviews`);
  expect(response.status).toBe(200);
  return (await response.json()) as ReviewSummary[];
}

describe("A Pull Request's Reviews", () => {
  test("are listed with their Model, head commit, date and Finding counts", async () => {
    const { app } = setup([fakeModelProvider([{ findings: [sqlInjection, vagueName, { ...sqlInjection, startLine: 2, endLine: 2 }] }]).provider]);
    const review = await completedReview(app, pullRequest);

    expect(await listReviews(app)).toEqual<ReviewSummary[]>([
      {
        id: review.id,
        modelProvider: "Ollama",
        model: "test-model",
        headCommit: "abc1234",
        createdAt: review.createdAt,
        status: "complete",
        findingCounts: { "bad-practice": 1, "security-issue": 2 },
        outdated: false,
      },
    ]);
  });

  test("a Review is Outdated once the Pull Request's head commit moves on, and a Review of the new head commit isn't", async () => {
    const { app, push } = setup([fakeModelProvider([{ findings: [sqlInjection] }, { findings: [] }]).provider]);
    const before = await completedReview(app, pullRequest);
    expect(await listReviews(app)).toMatchObject([{ id: before.id, outdated: false }]);

    push("def5678");

    expect(await listReviews(app)).toMatchObject([{ id: before.id, headCommit: "abc1234", outdated: true }]);

    const after = await completedReview(app, pullRequest);

    expect(await listReviews(app)).toMatchObject([
      { id: after.id, headCommit: "def5678", outdated: false },
      { id: before.id, headCommit: "abc1234", outdated: true },
    ]);
  });

  test("Outdated isn't saved: a Review is current again when the Pull Request's head commit moves back to its own", async () => {
    const { app, push } = setup([fakeModelProvider([{ findings: [] }]).provider]);
    await completedReview(app, pullRequest);
    push("def5678");
    expect(await listReviews(app)).toMatchObject([{ outdated: true }]);

    // A force-push put the reviewed commit back at the head.
    push("abc1234");

    expect(await listReviews(app)).toMatchObject([{ outdated: false }]);
  });

  test("several Models can review the same commit, and each Review is listed and can be opened", async () => {
    const ollama = fakeModelProvider([{ findings: [sqlInjection] }], { name: "Ollama", models: ["llama3.1:8b"] });
    const openAI = fakeModelProvider([{ findings: [sqlInjection, vagueName] }], { name: "OpenAI-compatible", models: ["gpt-4o"] });
    const { app } = setup([ollama.provider, openAI.provider]);

    const local = await completedReview(app, pullRequest, { modelProvider: "Ollama", model: "llama3.1:8b" });
    const paid = await completedReview(app, pullRequest, { modelProvider: "OpenAI-compatible", model: "gpt-4o" });

    const listed = await listReviews(app);
    expect(listed).toMatchObject([
      { id: paid.id, modelProvider: "OpenAI-compatible", model: "gpt-4o", headCommit: "abc1234", findingCounts: { "bad-practice": 1, "security-issue": 1 }, outdated: false },
      { id: local.id, modelProvider: "Ollama", model: "llama3.1:8b", headCommit: "abc1234", findingCounts: { "bad-practice": 0, "security-issue": 1 }, outdated: false },
    ]);
    const opened = await Promise.all(listed.map(({ id }) => fetchReview(app, id)));
    expect(opened.map((review) => review.findings.map((finding) => finding.title))).toEqual([["SQL injection", "Vague name"], ["SQL injection"]]);
  });

  test("another Pull Request's Reviews aren't listed", async () => {
    const other = { ...pullRequest, number: 8 };
    const { app } = setup([fakeModelProvider([{ findings: [] }]).provider], [other]);
    await completedReview(app, other);

    expect(await listReviews(app)).toEqual([]);
    expect(await listReviews(app, 8)).toHaveLength(1);
  });

  test("a Review still running is listed as running, with its Finding counts so far", async () => {
    const twoFiles = {
      ...pullRequest,
      number: 8,
      files: [pullRequest.files[0]!, { path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }],
    };
    const users = held({ findings: [sqlInjection] });
    const config = held({ findings: [] });
    const { app } = setup([fakeModelProvider([users, config]).provider], [twoFiles]);
    const { id } = (await (await startReview(app, twoFiles)).json()) as Review;
    const stream = await followReview(app, id);
    users.release();
    // The Review has reached its last file.
    for (let event = await stream.next(); event?.type !== "file-reviewing"; event = await stream.next());

    expect(await listReviews(app, 8)).toMatchObject([
      { id, status: "running", findingCounts: { "bad-practice": 0, "security-issue": 1 }, outdated: false },
    ]);

    config.release();
    await stream.rest();

    expect(await listReviews(app, 8)).toMatchObject([{ id, status: "complete" }]);
  });

  test.each(["9", "0", "7abc"])("the Reviews of Pull Request number %j, which doesn't exist, are a 404", async (number) => {
    const { app } = setup([]);

    const response = await app.request(`/api/repositories/acme/shop/pull-requests/${number}/reviews`);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ApiError).error).toBe(`Pull Request acme/shop#${number} not found`);
  });

  test("the Reviews of a Pull Request in a Repository the GitHub App isn't installed on are a 403", async () => {
    const app = createApp({
      forge: fakeForge([pullRequest], { notInstalledOn: ["acme/shop"] }),
      modelProviders: [],
      db: openDatabase(":memory:"),
    });

    const response = await app.request("/api/repositories/acme/shop/pull-requests/7/reviews");

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiError).error).toMatch(/isn't installed on acme\/shop/);
  });
});
