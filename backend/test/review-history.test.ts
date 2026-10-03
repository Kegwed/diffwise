import { describe, expect, test } from "vitest";
import type { ReviewSummary } from "@diffwise/shared";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import type { ModelProvider } from "../src/model-provider.ts";
import { createReviews, type Reviews } from "../src/reviews.ts";
import { fakeForge, fakeModelProvider, held } from "./fakes.ts";
import { completedReview, followReview, startReview } from "./reviewing.ts";

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

function setup(modelProviders: ModelProvider[], others: PullRequestSnapshot[] = []) {
  const pullRequests = [pullRequest, ...others];
  const reviews = createReviews({ forge: fakeForge(pullRequests), modelProviders, db: openDatabase(":memory:") });
  /** Moves the Pull Request's head commit on, as pushing new commits to it does. The fake Forge serves `pullRequests` as it then is. */
  const push = (headCommit: string) => void (pullRequests[0] = { ...pullRequest, headCommit });
  return { reviews, push };
}

async function listReviews(reviews: Reviews, number = pullRequest.number): Promise<ReviewSummary[]> {
  const listed = await reviews.list({ ...pullRequest, number });
  expect(listed).toBeDefined();
  return listed!;
}

describe("A Pull Request's Reviews", () => {
  test("are listed with their Model, head commit, date and Finding counts", async () => {
    const { reviews } = setup([fakeModelProvider([{ findings: [sqlInjection, vagueName, { ...sqlInjection, startLine: 2, endLine: 2 }] }]).provider]);
    const review = await completedReview(reviews, pullRequest);

    expect(await listReviews(reviews)).toEqual<ReviewSummary[]>([
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
    const { reviews, push } = setup([fakeModelProvider([{ findings: [sqlInjection] }, { findings: [] }]).provider]);
    const before = await completedReview(reviews, pullRequest);
    expect(await listReviews(reviews)).toMatchObject([{ id: before.id, outdated: false }]);

    push("def5678");

    expect(await listReviews(reviews)).toMatchObject([{ id: before.id, headCommit: "abc1234", outdated: true }]);

    const after = await completedReview(reviews, pullRequest);

    expect(await listReviews(reviews)).toMatchObject([
      { id: after.id, headCommit: "def5678", outdated: false },
      { id: before.id, headCommit: "abc1234", outdated: true },
    ]);
  });

  test("Outdated isn't saved: a Review is current again when the Pull Request's head commit moves back to its own", async () => {
    const { reviews, push } = setup([fakeModelProvider([{ findings: [] }]).provider]);
    await completedReview(reviews, pullRequest);
    push("def5678");
    expect(await listReviews(reviews)).toMatchObject([{ outdated: true }]);

    // A force-push put the reviewed commit back at the head.
    push("abc1234");

    expect(await listReviews(reviews)).toMatchObject([{ outdated: false }]);
  });

  test("several Models can review the same commit, and each Review is listed and can be opened", async () => {
    const ollama = fakeModelProvider([{ findings: [sqlInjection] }], { name: "Ollama", models: ["llama3.1:8b"] });
    const openAI = fakeModelProvider([{ findings: [sqlInjection, vagueName] }], { name: "OpenAI-compatible", models: ["gpt-4o"] });
    const { reviews } = setup([ollama.provider, openAI.provider]);

    const local = await completedReview(reviews, pullRequest, { modelProvider: "Ollama", model: "llama3.1:8b" });
    const paid = await completedReview(reviews, pullRequest, { modelProvider: "OpenAI-compatible", model: "gpt-4o" });

    const listed = await listReviews(reviews);
    expect(listed).toMatchObject([
      { id: paid.id, modelProvider: "OpenAI-compatible", model: "gpt-4o", headCommit: "abc1234", findingCounts: { "bad-practice": 1, "security-issue": 1 }, outdated: false },
      { id: local.id, modelProvider: "Ollama", model: "llama3.1:8b", headCommit: "abc1234", findingCounts: { "bad-practice": 0, "security-issue": 1 }, outdated: false },
    ]);
    const opened = await Promise.all(listed.map(({ id }) => reviews.get(id)!));
    expect(opened.map((review) => review.findings.map((finding) => finding.title))).toEqual([["SQL injection", "Vague name"], ["SQL injection"]]);
  });

  test("another Pull Request's Reviews aren't listed", async () => {
    const other = { ...pullRequest, number: 8 };
    const { reviews } = setup([fakeModelProvider([{ findings: [] }]).provider], [other]);
    await completedReview(reviews, other);

    expect(await listReviews(reviews)).toEqual([]);
    expect(await listReviews(reviews, 8)).toHaveLength(1);
  });

  test("a Review still running is listed as running, with its Finding counts so far", async () => {
    const twoFiles = {
      ...pullRequest,
      number: 8,
      files: [pullRequest.files[0]!, { path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }],
    };
    const users = held({ findings: [sqlInjection] });
    const config = held({ findings: [] });
    const { reviews } = setup([fakeModelProvider([users, config]).provider], [twoFiles]);
    const { id } = await startReview(reviews, twoFiles);
    const stream = followReview(reviews, id);
    users.release();
    // The Review has reached its last file.
    for (let event = await stream.next(); event?.type !== "file-reviewing"; event = await stream.next());

    expect(await listReviews(reviews, 8)).toMatchObject([
      { id, status: "running", findingCounts: { "bad-practice": 0, "security-issue": 1 }, outdated: false },
    ]);

    config.release();
    await stream.rest();

    expect(await listReviews(reviews, 8)).toMatchObject([{ id, status: "complete" }]);
  });
});
