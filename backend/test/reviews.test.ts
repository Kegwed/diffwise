import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import type { ModelChoice } from "@diffwise/shared";
import { openDatabase } from "../src/db.ts";
import type { FixturePullRequest } from "../src/fixture-forge.ts";
import { ForgeAccessError } from "../src/forge.ts";
import { fakeForge, fakeModelProvider, hang } from "./fakes.ts";
import { completedReview, pullRequest, setupReviews, sqlInjection } from "./reviewing.ts";

/** A reviewed File Outcome, whatever its patch. */
function reviewed(file: string) {
  return { file, outcome: "reviewed", patch: expect.any(String) };
}

describe("Reviews", () => {
  test("a started Review can be fetched by id with its Findings", async () => {
    const { reviews } = setupReviews([{ findings: [sqlInjection] }]);

    const { id } = await completedReview(reviews, pullRequest);

    const review = reviews.get(id);
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

  test("a Review keeps its Pull Request's title, running and once saved", async () => {
    const { reviews, restart } = setupReviews([{ findings: [] }]);

    const { id, pullRequestTitle } = await completedReview(reviews, pullRequest);

    expect(pullRequestTitle).toBe("Add user lookup");
    expect(restart().get(id)?.pullRequestTitle).toBe("Add user lookup");
  });

  test("a fetched Review carries each reviewed file's patch, so it can be shown as a diff", async () => {
    const { reviews } = setupReviews([{ findings: [sqlInjection] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(review.fileOutcomes).toEqual([{ file: "src/users.ts", outcome: "reviewed", patch: pullRequest.files[0]!.patch }]);
  });

  test.each([
    ["an unknown kind", { ...sqlInjection, kind: "typo" }],
    ["an unknown Severity", { ...sqlInjection, severity: "catastrophic" }],
    ["a missing field", { ...sqlInjection, title: undefined }],
    ["a mistyped field", { ...sqlInjection, startLine: "three" }],
  ])("a reply with a Finding with %s is invalid and retried", async (_, invalidFinding) => {
    const { reviews, modelRequests } = setupReviews([{ findings: [invalidFinding, sqlInjection] }, { findings: [sqlInjection] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a Finding whose line range ends before it starts is dropped", async () => {
    const { reviews, modelRequests } = setupReviews([{ findings: [{ ...sqlInjection, startLine: 4, endLine: 3 }, sqlInjection] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(modelRequests).toHaveLength(1);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  describe("Findings stay on the lines the Pull Request adds or modifies", () => {
    // New-version lines: 1 unchanged, 2 modified, 3 unchanged; then 10 unchanged, 11 and 12 added, 13 unchanged;
    // then old line 20 removed, and old line 21 unchanged as new line 22.
    const twoHunks: FixturePullRequest = {
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
      const { reviews } = setupReviews([{ findings: [finding] }], { pullRequests: [twoHunks] });

      const review = await completedReview(reviews, twoHunks);

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
      const { reviews, modelRequests } = setupReviews([{ findings: [{ ...sqlInjection, startLine, endLine }, { ...sqlInjection, startLine: 11, endLine: 11 }] }], { pullRequests: [twoHunks] });

      const review = await completedReview(reviews, twoHunks);

      expect(modelRequests).toHaveLength(1);
      expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
      expect(review.findings).toEqual([{ ...sqlInjection, startLine: 11, endLine: 11, file: "src/users.ts" }]);
    });
  });

  test("each changed file is reviewed by its own Model call", async () => {
    const twoFiles: FixturePullRequest = {
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
    const { reviews, modelRequests } = setupReviews([{ findings: [sqlInjection] }, { findings: [hardCodedSecret] }], { pullRequests: [twoFiles] });

    const review = await completedReview(reviews, twoFiles);

    expect(modelRequests).toHaveLength(2);
    expect(review.findings).toEqual([
      { ...sqlInjection, file: "src/users.ts" },
      { ...hardCodedSecret, file: "src/config.ts" },
    ]);
  });

  test("files on the skip list are never sent to the Model and are skipped with a reason", async () => {
    const withSkippable: FixturePullRequest = {
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
    const { reviews, modelRequests } = setupReviews([{ findings: [sqlInjection] }, { findings: [] }], { pullRequests: [withSkippable] });

    const review = await completedReview(reviews, withSkippable);

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
    const withHugeFile: FixturePullRequest = {
      ...pullRequest,
      files: [{ path: "src/generated.ts", patch: [`@@ -0,0 +1,${hugeLines.length} @@`, ...hugeLines].join("\n") }, pullRequest.files[0]!],
    };
    const { reviews, modelRequests } = setupReviews([{ findings: [] }], { pullRequests: [withHugeFile] });

    const review = await completedReview(reviews, withHugeFile);

    expect(modelRequests).toHaveLength(1);
    expect(review.fileOutcomes).toEqual([
      { file: "src/generated.ts", outcome: "skipped", reason: expect.stringMatching(/too large/i) },
      reviewed("src/users.ts"),
    ]);
  });

  test("a file whose retry is also invalid fails with a reason, and the other files are still reviewed", async () => {
    const twoFiles: FixturePullRequest = {
      ...pullRequest,
      files: [{ path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }, pullRequest.files[0]!],
    };
    const { reviews, modelRequests } = setupReviews(['{"findings": [', "I could not find any problems.", { findings: [sqlInjection] }], { pullRequests: [twoFiles] });

    const review = await completedReview(reviews, twoFiles);

    expect(review.status).toBe("complete");
    expect(modelRequests).toHaveLength(3);
    expect(review.fileOutcomes).toEqual([
      { file: "src/config.ts", outcome: "failed", reason: expect.stringMatching(/JSON/) },
      reviewed("src/users.ts"),
    ]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("each file's Model call sees the Pull Request's title and description, labelled as the author's claims", async () => {
    const twoFiles: FixturePullRequest = {
      ...pullRequest,
      files: [pullRequest.files[0]!, { path: "src/config.ts", patch: "@@ -0,0 +1 @@\n+export const retries = 3;" }],
    };
    const { reviews, modelRequests } = setupReviews([{ findings: [] }, { findings: [] }], { pullRequests: [twoFiles] });

    await completedReview(reviews, twoFiles);

    expect(modelRequests).toHaveLength(2);
    for (const request of modelRequests) {
      const prompt = request.messages.map((m) => m.content).join("\n");
      expect(prompt).toContain("Pull request title (author's claim): Add user lookup");
      expect(prompt).toContain("Pull request description (author's claim):\nAdds an endpoint to look users up by name.");
      expect(prompt).toMatch(/author's claims, not facts/);
    }
  });

  test("the Model sees the diff with each added or unchanged line numbered as in the new version of the file", async () => {
    const twoHunks: FixturePullRequest = {
      ...pullRequest,
      files: [
        {
          path: "src/users.ts",
          patch: ["@@ -1,2 +1,2 @@", " import { db } from './db';", "-const limit = 10;", "+const limit = 20;", "@@ -9 +9,2 @@", " }", "+export {};", "\\ No newline at end of file"].join("\n"),
        },
      ],
    };
    const { reviews, modelRequests } = setupReviews([{ findings: [] }], { pullRequests: [twoHunks] });

    await completedReview(reviews, twoHunks);

    expect(modelRequests[0]!.messages.at(-1)!.content).toContain(
      ["@@ -1,2 +1,2 @@", "   1  import { db } from './db';", "     -const limit = 10;", "   2 +const limit = 20;", "@@ -9 +9,2 @@", "   9  }", "  10 +export {};"].join("\n"),
    );
  });

  test("a Review of an unknown Pull Request doesn't start", async () => {
    const { reviews, modelRequests } = setupReviews();

    const outcome = await reviews.start({ ...pullRequest, number: 999 }, { modelProvider: "Ollama", model: "test-model" });

    expect(outcome).toEqual({ started: false, missing: "pull-request" });
    expect(modelRequests).toHaveLength(0);
  });

  test("an unknown Review is undefined", async () => {
    const { reviews } = setupReviews();

    expect(reviews.get("nope")).toBeUndefined();
    expect(reviews.follow("nope")).toBeUndefined();
  });

  test("a Security Reference on a Bad Practice is dropped", async () => {
    const { reviews } = setupReviews([{ findings: [{ ...sqlInjection, kind: "bad-practice" }] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(review.findings[0]).not.toHaveProperty("securityReference");
  });

  test("a Finding whose optional fields are null is kept without them", async () => {
    const { reviews } = setupReviews([{ findings: [{ ...sqlInjection, suggestedFix: null, securityReference: null }] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).not.toHaveProperty("suggestedFix");
    expect(review.findings[0]).not.toHaveProperty("securityReference");
  });

  test("a Model call error is retried once, and a valid retry reviews the file", async () => {
    const { reviews, modelRequests } = setupReviews([new Error("socket hang up"), { findings: [sqlInjection] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a Model call that times out is retried once, then fails the file with a reason", async () => {
    const { reviews, modelRequests } = setupReviews([hang, hang], { modelCallTimeoutMs: 20 });

    const review = await completedReview(reviews, pullRequest);

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([
      { file: "src/users.ts", outcome: "failed", reason: expect.stringMatching(/timed out/i) },
    ]);
  });

  test("a Model call that times out is retried once, and a valid retry reviews the file", async () => {
    const { reviews } = setupReviews([hang, { findings: [sqlInjection] }], { modelCallTimeoutMs: 20 });

    const review = await completedReview(reviews, pullRequest);

    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("an unreachable Model Provider fails each file with the error, and the Review still completes", async () => {
    const refused = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const { reviews, modelRequests } = setupReviews([refused, refused]);

    const review = await completedReview(reviews, pullRequest);

    expect(review.status).toBe("complete");
    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([
      { file: "src/users.ts", outcome: "failed", reason: expect.stringContaining("ECONNREFUSED") },
    ]);
  });

  test("a reply that isn't JSON is retried once, and a valid retry reviews the file", async () => {
    const { reviews, modelRequests } = setupReviews(["Sure! Here are the problems I found: ...", { findings: [sqlInjection] }]);

    const review = await completedReview(reviews, pullRequest);

    expect(modelRequests).toHaveLength(2);
    expect(review.fileOutcomes).toEqual([reviewed("src/users.ts")]);
    expect(review.findings).toEqual([{ ...sqlInjection, file: "src/users.ts" }]);
  });

  test("a changed file Diffwise can't handle fails that file, and the Review still completes and is saved", async () => {
    // No Forge sends a file without a patch: this stands for whatever could go wrong before the Model is asked.
    const broken = { path: "src/broken.ts", patch: undefined as unknown as string };
    const withBroken = { ...pullRequest, files: [broken, ...pullRequest.files] };
    const { reviews, restart } = setupReviews([{ findings: [sqlInjection] }], { pullRequests: [withBroken] });

    const review = await completedReview(reviews, withBroken);

    expect(review).toMatchObject({
      status: "complete",
      fileOutcomes: [
        { file: "src/broken.ts", outcome: "failed", reason: expect.stringMatching(/couldn't review it/) },
        reviewed("src/users.ts"),
      ],
      pendingFiles: [],
      findings: [{ title: "SQL injection", file: "src/users.ts" }],
    });
    expect(restart().get(review.id)).toEqual(review);
  });

  test("starting a Review of a Pull Request in a Repository the GitHub App isn't installed on throws a ForgeAccessError", async () => {
    const { reviews } = setupReviews([], { forge: fakeForge([pullRequest], { notInstalledOn: ["acme/shop"] }) });

    await expect(reviews.start(pullRequest, { modelProvider: "Ollama", model: "test-model" })).rejects.toThrow(ForgeAccessError);
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
      const { reviews } = setupReviews([], { db });

      const review = reviews.get("old");
      db.close();

      expect(review?.fileOutcomes).toEqual([{ file: "src/users.ts", outcome: "reviewed", patch: "" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a Review saved before Pull Request titles were kept still loads and is listed, without a title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffwise-"));
    try {
      const path = join(dir, "diffwise.db");
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE reviews (id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL,
          head_commit TEXT NOT NULL, model_provider TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO reviews VALUES ('old', 'acme', 'shop', 7, 'abc1234', 'Ollama', 'test-model', '2026-09-01T00:00:00.000Z');
      `);
      old.close();
      const db = openDatabase(path);
      const { reviews } = setupReviews([], { db });

      const review = reviews.get("old");
      const recent = reviews.recent();
      db.close();

      expect(review).toMatchObject({ id: "old", pullRequest: { owner: "acme", repo: "shop", number: 7 } });
      expect(review).not.toHaveProperty("pullRequestTitle");
      expect(recent).toMatchObject([{ id: "old", pullRequest: { owner: "acme", repo: "shop", number: 7 } }]);
      expect(recent[0]).not.toHaveProperty("pullRequestTitle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Model Providers", () => {
  test("a Review runs on the chosen Model Provider and Model, and records both", async () => {
    const ollama = fakeModelProvider([], { name: "Ollama" });
    const openAI = fakeModelProvider([{ findings: [sqlInjection] }], { name: "OpenAI-compatible", models: ["gpt-4o"] });
    const { reviews } = setupReviews([], { modelProviders: [ollama.provider, openAI.provider] });

    const review = await completedReview(reviews, pullRequest, { modelProvider: "OpenAI-compatible", model: "gpt-4o" });

    expect(ollama.requests).toHaveLength(0);
    expect(openAI.requests.map((r) => r.model)).toEqual(["gpt-4o"]);
    expect(review).toMatchObject({ modelProvider: "OpenAI-compatible", model: "gpt-4o" });
  });

  test("a Review on an unknown Model Provider doesn't start", async () => {
    const { provider, requests } = fakeModelProvider([]);
    const { reviews } = setupReviews([], { modelProviders: [provider] });
    const choice: ModelChoice = { modelProvider: "Nope", model: "test-model" };

    expect(await reviews.start(pullRequest, choice)).toEqual({ started: false, missing: "model-provider" });
    expect(requests).toHaveLength(0);
  });

  test("a Model its Model Provider lists only as `<model>:latest` starts a Review, which records the Model as named", async () => {
    const { reviews, modelRequests } = setupReviews([{ findings: [] }], { models: ["llama3.1:latest", "qwen2.5-coder:7b"] });

    const review = await completedReview(reviews, pullRequest, { modelProvider: "Ollama", model: "llama3.1" });

    expect(review).toMatchObject({ modelProvider: "Ollama", model: "llama3.1" });
    expect(modelRequests.map((request) => request.model)).toEqual(["llama3.1"]);
  });

  test("a Model its Model Provider doesn't list starts no Review, and the outcome names the Models it does list", async () => {
    const { reviews, modelRequests } = setupReviews([{ findings: [] }], { models: ["llama3.1:8b", "qwen2.5-coder:7b"] });

    const outcome = await reviews.start(pullRequest, { modelProvider: "Ollama", model: "llama3.1:7b" });

    expect(outcome).toEqual({ started: false, missing: "model", offeredModels: ["llama3.1:8b", "qwen2.5-coder:7b"] });
    expect(modelRequests).toHaveLength(0);
    expect(await reviews.list(pullRequest)).toEqual([]);
  });

  test("a Model Provider that can't list its Models starts no Review, and the outcome carries its reason", async () => {
    const { reviews, modelRequests } = setupReviews([{ findings: [] }], {
      models: new Error("connect ECONNREFUSED 127.0.0.1:11434"),
    });

    const outcome = await reviews.start(pullRequest, { modelProvider: "Ollama", model: "test-model" });

    expect(outcome).toEqual({ started: false, unusable: "model-provider", reason: "connect ECONNREFUSED 127.0.0.1:11434" });
    expect(modelRequests).toHaveLength(0);
    expect(await reviews.list(pullRequest)).toEqual([]);
  });
});
