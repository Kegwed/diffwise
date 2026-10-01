import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import type { ModelChoice, ModelProviderListing, PullRequestRef, Review } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import type { ModelProvider } from "../src/model-provider.ts";
import { fakeModelProvider, hang } from "./fakes.ts";

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

/** A reviewed File Outcome, whatever its patch. */
function reviewed(file: string) {
  return { file, outcome: "reviewed", patch: expect.any(String) };
}

function setup(pullRequests: PullRequestSnapshot[], modelResponses: unknown[], modelCallTimeoutMs?: number) {
  const modelProvider = fakeModelProvider(modelResponses);
  const app = createApp({
    forge: fixtureForge(pullRequests),
    modelProviders: [modelProvider.provider],
    db: openDatabase(":memory:"),
    modelCallTimeoutMs,
  });
  return { app, modelRequests: modelProvider.requests };
}

async function startReview(
  app: ReturnType<typeof createApp>,
  pr: PullRequestRef,
  { modelProvider = "Ollama", model = "test-model" }: Partial<ModelChoice> = {},
) {
  return app.request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pullRequest: { owner: pr.owner, repo: pr.repo, number: pr.number }, modelProvider, model }),
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
      modelProvider: "Ollama",
      model: "test-model",
      fileOutcomes: [reviewed("src/users.ts")],
      findings: [{ ...sqlInjection, file: "src/users.ts" }],
    });
  });

  test("a fetched Review carries each reviewed file's patch, so it can be shown as a diff", async () => {
    const { app } = setup([pullRequest], [{ findings: [sqlInjection] }]);

    const { id } = (await (await startReview(app, pullRequest)).json()) as Review;
    const review = (await (await app.request(`/api/reviews/${id}`)).json()) as Review;

    expect(review.fileOutcomes).toEqual([{ file: "src/users.ts", outcome: "reviewed", patch: pullRequest.files[0]!.patch }]);
  });

  test.each([
    ["an unknown kind", { ...sqlInjection, kind: "typo" }],
    ["an unknown Severity", { ...sqlInjection, severity: "catastrophic" }],
    ["a missing field", { ...sqlInjection, title: undefined }],
    ["a mistyped field", { ...sqlInjection, startLine: "three" }],
  ])("a reply with a Finding with %s is invalid and retried", async (_, invalidFinding) => {
    const { app, modelRequests } = setup(
      [pullRequest],
      [{ findings: [invalidFinding, sqlInjection] }, { findings: [sqlInjection] }],
    );

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a Finding whose line range ends before it starts is dropped", async () => {
    const { app, modelRequests } = setup(
      [pullRequest],
      [{ findings: [{ ...sqlInjection, startLine: 4, endLine: 3 }, sqlInjection] }],
    );

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(modelRequests).toHaveLength(1);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  describe("Findings stay on the lines the Pull Request adds or modifies", () => {
    // New-version lines: 1 unchanged, 2 modified, 3 unchanged; then 10 unchanged, 11 and 12 added, 13 unchanged;
    // then old line 20 removed, and old line 21 unchanged as new line 22.
    const twoHunks: PullRequestSnapshot = {
      ...pullRequest,
      files: [
        {
          path: "src/users.ts",
          patch: [
            "@@ -1,3 +1,3 @@",
            " import { db } from './db';",
            "-const limit = 10;",
            "+const limit = 20;",
            " export { limit };",
            "@@ -10,2 +10,4 @@",
            " function lookup() {",
            "+  log();",
            "+  return db.all();",
            " }",
            "@@ -20,2 +22,1 @@",
            "-  legacy();",
            " }",
          ].join("\n"),
        },
      ],
    };

    test.each([
      ["a modified line", 2, 2],
      ["a run of added lines", 11, 12],
    ])("a Finding on %s is kept", async (_, startLine, endLine) => {
      const finding = { ...sqlInjection, startLine, endLine };
      const { app } = setup([twoHunks], [{ findings: [finding] }]);

      const review = (await (await startReview(app, twoHunks)).json()) as Review;

      expect(review.findings).toEqual([{ ...finding, file: "src/users.ts" }]);
    });

    test.each([
      ["an unchanged line", 1, 1],
      ["a range running onto an unchanged line", 2, 3],
      ["a range starting on an unchanged line", 10, 11],
      ["a range spanning the gap between hunks", 2, 11],
      ["a line outside the diff", 5, 5],
      ["a removed line, by its old line number", 20, 20],
      ["a made-up line past the end of the file", 99, 120],
    ])("a Finding on %s is dropped", async (_, startLine, endLine) => {
      const { app, modelRequests } = setup(
        [twoHunks],
        [{ findings: [{ ...sqlInjection, startLine, endLine }, { ...sqlInjection, startLine: 11, endLine: 11 }] }],
      );

      const review = (await (await startReview(app, twoHunks)).json()) as Review;

      expect(modelRequests).toHaveLength(1);
      expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
      expect(review.findings).toEqual([{ ...sqlInjection, startLine: 11, endLine: 11, file: "src/users.ts" }]);
    });
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

  test("files on the skip list are never sent to the Model and are skipped with a reason", async () => {
    const withSkippable: PullRequestSnapshot = {
      ...pullRequest,
      files: [
        { path: "package-lock.json", patch: '@@ -1 +1 @@\n-"a"\n+"b"' },
        pullRequest.files[0]!,
        { path: "web/vendor/app.min.js", patch: "@@ -0,0 +1 @@\n+var a=1;" },
        { path: "dist/index.js", patch: "@@ -0,0 +1 @@\n+export {};" },
        { path: "assets/logo.png", patch: "" },
        { path: "assets/icon.xyz", patch: "" },
        { path: "src/build/steps.ts", patch: "@@ -0,0 +1 @@\n+export const steps = [];" },
      ],
    };
    const { app, modelRequests } = setup([withSkippable], [{ findings: [sqlInjection] }, { findings: [] }]);

    const review = (await (await startReview(app, withSkippable)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[0]!.messages.map((m) => m.content).join("\n")).toContain("src/users.ts");
    expect(review.fileOutcomes).toEqual([
      { file: "package-lock.json", outcome: "skipped", reason: expect.stringMatching(/lockfile/i) },
      reviewed("src/users.ts"),
      { file: "web/vendor/app.min.js", outcome: "skipped", reason: expect.stringMatching(/minified/i) },
      { file: "dist/index.js", outcome: "skipped", reason: expect.stringMatching(/build output/i) },
      { file: "assets/logo.png", outcome: "skipped", reason: expect.stringMatching(/binary/i) },
      { file: "assets/icon.xyz", outcome: "skipped", reason: expect.stringMatching(/no diff/i) },
      reviewed("src/build/steps.ts"),
    ]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a file over the size limit is never sent to the Model and is skipped with a reason", async () => {
    const hugeLines = Array.from({ length: 20_000 }, (_, i) => `+export const value${i} = ${i};`);
    const withHugeFile: PullRequestSnapshot = {
      ...pullRequest,
      files: [{ path: "src/generated.ts", patch: [`@@ -0,0 +1,${hugeLines.length} @@`, ...hugeLines].join("\n") }, pullRequest.files[0]!],
    };
    const { app, modelRequests } = setup([withHugeFile], [{ findings: [] }]);

    const review = (await (await startReview(app, withHugeFile)).json()) as Review;

    expect(modelRequests).toHaveLength(1);
    expect(review.fileOutcomes).toEqual([
      { file: "src/generated.ts", outcome: "skipped", reason: expect.stringMatching(/too large/i) },
      reviewed("src/users.ts"),
    ]);
  });

  test("a file whose retry is also invalid fails with a reason, and the other files are still reviewed", async () => {
    const twoFiles: PullRequestSnapshot = {
      ...pullRequest,
      files: [{ path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }, pullRequest.files[0]!],
    };
    const { app, modelRequests } = setup(
      [twoFiles],
      ['{"findings": [', "I could not find any problems.", { findings: [sqlInjection] }],
    );

    const started = await startReview(app, twoFiles);

    expect(started.status).toBe(201);
    const review = (await started.json()) as Review;
    expect(modelRequests).toHaveLength(3);
    expect(review.fileOutcomes).toEqual([
      { file: "src/config.ts", outcome: "failed", reason: expect.stringMatching(/JSON/) },
      reviewed("src/users.ts"),
    ]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
    expect(await (await app.request(`/api/reviews/${review.id}`)).json()).toEqual(review);
  });

  test("each file's Model call sees the Pull Request's title and description, labelled as the author's claims", async () => {
    const twoFiles: PullRequestSnapshot = {
      ...pullRequest,
      files: [pullRequest.files[0]!, { path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }],
    };
    const { app, modelRequests } = setup([twoFiles], [{ findings: [] }, { findings: [] }]);

    await startReview(app, twoFiles);

    expect(modelRequests).toHaveLength(2);
    for (const request of modelRequests) {
      const prompt = request.messages.map((m) => m.content).join("\n");
      expect(prompt).toContain("Pull request title (author's claim): Add user lookup");
      expect(prompt).toContain("Pull request description (author's claim):\nAdds an endpoint to look users up by name.");
      expect(prompt).toMatch(/author's claims, not facts/);
    }
  });

  test("the Model sees the diff with each added or unchanged line numbered as in the new version of the file", async () => {
    const twoHunks: PullRequestSnapshot = {
      ...pullRequest,
      files: [
        {
          path: "src/users.ts",
          patch: ["@@ -1,2 +1,2 @@", " import { db } from './db';", "-const limit = 10;", "+const limit = 20;", "@@ -9 +9,2 @@", " }", "+export {};", "\\ No newline at end of file"].join("\n"),
        },
      ],
    };
    const { app, modelRequests } = setup([twoHunks], [{ findings: [] }]);

    await startReview(app, twoHunks);

    expect(modelRequests[0]!.messages.at(-1)!.content).toContain(
      ["@@ -1,2 +1,2 @@", "   1  import { db } from './db';", "     -const limit = 10;", "   2 +const limit = 20;", "@@ -9 +9,2 @@", "   9  }", "  10 +export {};"].join("\n"),
    );
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

  test("a Model call error is retried once, and a valid retry reviews the file", async () => {
    const { app, modelRequests } = setup([pullRequest], [new Error("socket hang up"), { findings: [sqlInjection] }]);

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a Model call that times out is retried once, then fails the file with a reason", async () => {
    const { app, modelRequests } = setup([pullRequest], [hang, hang], 20);

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([
      { file: "src/users.ts", outcome: "failed", reason: expect.stringMatching(/timed out/i) },
    ]);
  });

  test("a Model call that times out is retried once, and a valid retry reviews the file", async () => {
    const { app } = setup([pullRequest], [hang, { findings: [sqlInjection] }], 20);

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("an unreachable Model Provider fails each file with the error, and the Review still completes", async () => {
    const refused = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const { app, modelRequests } = setup([pullRequest], [refused, refused]);

    const started = await startReview(app, pullRequest);

    expect(started.status).toBe(201);
    expect(modelRequests).toHaveLength(2);
    expect(((await started.json()) as Review).fileOutcomes).toEqual([
      { file: "src/users.ts", outcome: "failed", reason: expect.stringContaining("ECONNREFUSED") },
    ]);
  });

  test("a reply that isn't JSON is retried once, and a valid retry reviews the file", async () => {
    const { app, modelRequests } = setup(
      [pullRequest],
      ["Sure! Here are the problems I found: ...", { findings: [sqlInjection] }],
    );

    const review = (await (await startReview(app, pullRequest)).json()) as Review;

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });
});

describe("Reviews saved by an earlier version", () => {
  test("a Review saved before patches were kept still loads, its reviewed files with an empty patch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffwise-"));
    try {
      const path = join(dir, "diffwise.db");
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE reviews (id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL,
          head_commit TEXT NOT NULL, model_provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE file_outcomes (review_id TEXT NOT NULL REFERENCES reviews(id), position INTEGER NOT NULL,
          file TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, PRIMARY KEY (review_id, position));
        INSERT INTO reviews VALUES ('old', 'acme', 'shop', 7, 'abc1234', 'Ollama', 'test-model', '2026-09-01T00:00:00.000Z');
        INSERT INTO file_outcomes VALUES ('old', 0, 'src/users.ts', 'reviewed', NULL);
      `);
      old.close();
      const db = openDatabase(path);
      const app = createApp({ forge: fixtureForge([pullRequest]), modelProviders: [], db });

      const review = (await (await app.request("/api/reviews/old")).json()) as Review;
      db.close();

      expect(review.fileOutcomes).toEqual([{ file: "src/users.ts", outcome: "reviewed", patch: "" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Models", () => {
  function setupProviders(...modelProviders: ModelProvider[]) {
    return createApp({ forge: fixtureForge([pullRequest]), modelProviders, db: openDatabase(":memory:") });
  }

  test("lists each Model Provider's Models, grouped by provider", async () => {
    const app = setupProviders(
      fakeModelProvider([], { name: "Ollama", models: ["llama3.1:8b", "qwen2.5-coder:7b"] }).provider,
      fakeModelProvider([], { name: "OpenAI-compatible", models: ["gpt-4o"] }).provider,
    );

    const listed = await (await app.request("/api/models")).json();

    expect(listed).toEqual<ModelProviderListing[]>([
      { modelProvider: "Ollama", status: "available", models: ["llama3.1:8b", "qwen2.5-coder:7b"] },
      { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
    ]);
  });

  test("a Model Provider that can't be reached is listed as unavailable, and the others still list their Models", async () => {
    const app = setupProviders(
      fakeModelProvider([], { name: "Ollama", models: new Error("connect ECONNREFUSED 127.0.0.1:11434") }).provider,
      fakeModelProvider([], { name: "OpenAI-compatible", models: ["gpt-4o"] }).provider,
    );

    const response = await app.request("/api/models");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<ModelProviderListing[]>([
      { modelProvider: "Ollama", status: "unavailable", reason: expect.stringContaining("ECONNREFUSED") },
      { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
    ]);
  });

  test("with no Model Provider configured, the listing is empty", async () => {
    const app = setupProviders();

    expect(await (await app.request("/api/models")).json()).toEqual([]);
  });

  test("a Review runs on the chosen Model Provider and Model, and records both", async () => {
    const ollama = fakeModelProvider([], { name: "Ollama" });
    const openAI = fakeModelProvider([{ findings: [sqlInjection] }], { name: "OpenAI-compatible", models: ["gpt-4o"] });
    const app = setupProviders(ollama.provider, openAI.provider);

    const started = await startReview(app, pullRequest, { modelProvider: "OpenAI-compatible", model: "gpt-4o" });

    expect(started.status).toBe(201);
    const { id } = (await started.json()) as Review;
    expect(ollama.requests).toHaveLength(0);
    expect(openAI.requests.map((r) => r.model)).toEqual(["gpt-4o"]);
    const review = (await (await app.request(`/api/reviews/${id}`)).json()) as Review;
    expect(review).toMatchObject({ modelProvider: "OpenAI-compatible", model: "gpt-4o" });
  });

  test.each([
    ["an unknown Model Provider", { modelProvider: "Nope", model: "test-model" }],
    ["no Model", { modelProvider: "Ollama", model: "" }],
  ])("starting a Review with %s is a 400", async (_, choice) => {
    const { provider, requests } = fakeModelProvider([]);
    const app = setupProviders(provider);

    const started = await startReview(app, pullRequest, choice);

    expect(started.status).toBe(400);
    expect(requests).toHaveLength(0);
  });
});
