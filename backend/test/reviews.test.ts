import { describe, expect, test } from "vitest";
import type { Review } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import { fakeModelProvider } from "./fakes.ts";

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
  suggestedFix: "return db.query('SELECT * FROM users WHERE name = ?', [name]);",
  securityReference: "CWE-89",
};

function setup(pullRequests: PullRequestSnapshot[], modelResponses: unknown[]) {
  const modelProvider = fakeModelProvider(modelResponses);
  const app = createApp({
    forge: fixtureForge(pullRequests),
    modelProvider: modelProvider.provider,
    model: "test-model",
    db: openDatabase(":memory:"),
  });
  return { app, modelRequests: modelProvider.requests };
}

async function startReview(app: ReturnType<typeof createApp>, pr: PullRequestSnapshot) {
  return app.request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pullRequest: { owner: pr.owner, repo: pr.repo, number: pr.number } }),
  });
}

describe("Reviews", () => {
  test("a started Review can be fetched by id with its Findings", async () => {
    const { app } = setup([pullRequest], [{ findings: [sqlInjection] }]);

    const started = await startReview(app, pullRequest);
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as Review;

    const fetched = await app.request(`/api/reviews/${id}`);
    expect(fetched.status).toBe(200);
    const review = (await fetched.json()) as Review;
    expect(review).toMatchObject({
      id,
      pullRequest: { owner: "acme", repo: "shop", number: 7 },
      headCommit: "abc1234",
      model: "test-model",
      findings: [{ ...sqlInjection, file: "src/users.ts" }],
    });
  });

  test("Findings that don't match the Finding schema are dropped", async () => {
    const { app } = setup(
      [pullRequest],
      [
        {
          findings: [
            { ...sqlInjection, kind: "typo" },
            { ...sqlInjection, severity: "catastrophic" },
            { ...sqlInjection, title: undefined },
            { ...sqlInjection, startLine: "three" },
            { ...sqlInjection, startLine: 4, endLine: 3 },
            sqlInjection,
          ],
        },
      ],
    );

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("each changed file is reviewed by its own Model call", async () => {
    const twoFiles: PullRequestSnapshot = {
      ...pullRequest,
      files: [
        pullRequest.files[0]!,
        { path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const apiKey = 'hunter2-api-key';" },
      ],
    };
    const hardCodedSecret = {
      kind: "security-issue",
      severity: "high",
      startLine: 1,
      endLine: 1,
      title: "Hard-coded secret",
      explanation: "An API key is committed to the repository.",
    };
    const { app, modelRequests } = setup([twoFiles], [{ findings: [sqlInjection] }, { findings: [hardCodedSecret] }]);

    const review = (await (await startReview(app, twoFiles)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(review.findings).toEqual([
      { ...sqlInjection, file: "src/users.ts" },
      { ...hardCodedSecret, file: "src/config.ts" },
    ]);
  });

  test("the Model sees the Pull Request's title and description", async () => {
    const { app, modelRequests } = setup([pullRequest], [{ findings: [] }]);

    await startReview(app, pullRequest);

    const prompt = modelRequests[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Add user lookup");
    expect(prompt).toContain("Adds an endpoint to look users up by name.");
  });

  test("starting a Review of an unknown Pull Request is a 404", async () => {
    const { app } = setup([pullRequest], []);

    const started = await startReview(app, { ...pullRequest, number: 999 });

    expect(started.status).toBe(404);
  });

  test("fetching an unknown Review is a 404", async () => {
    const { app } = setup([pullRequest], []);

    expect((await app.request("/api/reviews/nope")).status).toBe(404);
  });

  test("lists the Forge's Pull Requests", async () => {
    const { app } = setup([pullRequest], []);

    const listed = await (await app.request("/api/pull-requests")).json();

    expect(listed).toEqual([
      { owner: "acme", repo: "shop", number: 7, title: "Add user lookup", author: "octocat", headCommit: "abc1234" },
    ]);
  });

  test("a Security Reference on a Bad Practice is dropped", async () => {
    const { app } = setup([pullRequest], [{ findings: [{ ...sqlInjection, kind: "bad-practice" }] }]);

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(review.findings[0]).not.toHaveProperty("securityReference");
  });

  test("a Finding whose optional fields are null is kept without them", async () => {
    const { app } = setup([pullRequest], [{ findings: [{ ...sqlInjection, suggestedFix: null, securityReference: null }] }]);

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).not.toHaveProperty("suggestedFix");
    expect(review.findings[0]).not.toHaveProperty("securityReference");
  });

  test("an unreachable Model Provider fails the Review with a clear error", async () => {
    const { app } = setup([pullRequest], []);

    const started = await startReview(app, pullRequest);

    expect(started.status).toBe(502);
    expect(await started.json()).toEqual({
      error: expect.stringContaining("fake Model Provider ran out of responses"),
    });
  });

  test("a reply that isn't JSON yields no Findings for that file", async () => {
    const { app } = setup([pullRequest], ["Sure! Here are the problems I found: ..."]);

    const started = await startReview(app, pullRequest);

    expect(started.status).toBe(201);
    expect(((await started.json()) as Review).findings).toEqual([]);
  });
});
