import { describe, expect, test } from "vitest";
import { parsePatch } from "@diffwise/shared";
import { EVAL_SET, type EvalFixture } from "../src/eval/eval-set.ts";
import { formatEvalReport, runEvalSet } from "../src/eval/runner.ts";
import { fakeModelProvider } from "./fakes.ts";

const users: EvalFixture = {
  pullRequest: {
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
          "@@ -1,2 +1,5 @@",
          " import { db } from './db';",
          "+export function findUser(name: string) {",
          "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
          "+}",
          "+export const ADMIN_TOKEN = 'hunter2';",
        ].join("\n"),
      },
    ],
  },
  plantedProblems: [
    { kind: "security-issue", file: "src/users.ts", startLine: 3, endLine: 3, description: "SQL injection" },
    { kind: "security-issue", file: "src/users.ts", startLine: 5, endLine: 5, description: "Hard-coded secret" },
  ],
};

const orders: EvalFixture = {
  pullRequest: {
    owner: "acme",
    repo: "orders",
    number: 2,
    title: "Export orders",
    author: "octocat",
    headCommit: "def5678",
    description: "",
    files: [
      {
        path: "src/export.ts",
        patch: ["@@ -0,0 +1,3 @@", "+try {", "+  exportOrders();", "+} catch (e) {}"].join("\n"),
      },
    ],
  },
  plantedProblems: [
    { kind: "bad-practice", file: "src/export.ts", startLine: 3, endLine: 3, description: "Swallowed error" },
  ],
};

const sqlInjection = {
  kind: "security-issue",
  severity: "critical",
  startLine: 2,
  endLine: 4,
  title: "SQL injection",
  explanation: "The name is interpolated straight into the SQL string.",
};

const vagueName = {
  kind: "bad-practice",
  severity: "low",
  startLine: 2,
  endLine: 2,
  title: "Vague function name",
  explanation: "findUser doesn't say what it finds the user by.",
};

describe("Running the Eval Set", () => {
  test("reviews every fixture with the chosen Model and scores its Findings against the Planted Problems", async () => {
    const { provider, requests } = fakeModelProvider([{ findings: [sqlInjection, vagueName] }, { findings: [] }]);

    const report = await runEvalSet([users, orders], provider, "test-model");

    expect(requests.map((request) => request.model)).toEqual(["test-model", "test-model"]);
    expect(report).toEqual({
      modelProvider: "Ollama",
      model: "test-model",
      fixtures: [
        {
          pullRequest: users.pullRequest,
          caught: [users.plantedProblems[0]],
          missed: [users.plantedProblems[1]],
          unmatched: [{ ...vagueName, file: "src/users.ts" }],
          notReviewed: [],
        },
        {
          pullRequest: orders.pullRequest,
          caught: [],
          missed: orders.plantedProblems,
          unmatched: [],
          notReviewed: [],
        },
      ],
    });
  });

  test("a file the Model fails on is reported as not reviewed, and its Planted Problems are missed", async () => {
    const { provider } = fakeModelProvider(["not json", "still not json"]);

    const report = await runEvalSet([orders], provider, "test-model");

    expect(report.fixtures).toEqual([
      {
        pullRequest: orders.pullRequest,
        caught: [],
        missed: orders.plantedProblems,
        unmatched: [],
        notReviewed: [{ file: "src/export.ts", outcome: "failed", reason: expect.stringContaining("not valid JSON") }],
      },
    ]);
  });

  test("says which fixture it is reviewing as it goes", async () => {
    const { provider } = fakeModelProvider([{ findings: [] }, { findings: [] }]);
    const started: string[] = [];

    await runEvalSet([users, orders], provider, "test-model", {
      onFixtureStart: (fixture) => started.push(fixture.pullRequest.repo),
    });

    expect(started).toEqual(["shop", "orders"]);
  });
});

describe("The Eval Set report", () => {
  test("lists each fixture's caught and missed Planted Problems and unmatched Findings, then the overall score", async () => {
    const { provider } = fakeModelProvider([{ findings: [sqlInjection, vagueName] }, "not json", "still not json"]);

    const report = formatEvalReport(await runEvalSet([users, orders], provider, "test-model"));

    expect(report).toBe(
      [
        "Eval Set report for test-model (Ollama)",
        "",
        "acme/shop#7 Add user lookup: caught 1 of 2",
        "  caught     security-issue  src/users.ts:3  SQL injection",
        "  missed     security-issue  src/users.ts:5  Hard-coded secret",
        "  unmatched  bad-practice    src/users.ts:2  Vague function name (low)",
        "",
        "acme/orders#2 Export orders: caught 0 of 1",
        "  missed     bad-practice    src/export.ts:3  Swallowed error",
        "  failed     src/export.ts: Failed twice. First attempt: the Model's reply was not valid JSON. Retry: the Model's reply was not valid JSON.",
        "",
        "Caught 1 of 3 Planted Problems (33%): 1 of 2 Security Issues, 0 of 1 Bad Practices.",
        "1 Finding matched no Planted Problem.",
        "1 file wasn't reviewed, so the Planted Problems in it count as missed.",
        "",
      ].join("\n"),
    );
  });

  test("shows a multi-line range as first-last", async () => {
    const wide: EvalFixture = {
      ...orders,
      plantedProblems: [{ kind: "bad-practice", file: "src/export.ts", startLine: 1, endLine: 3, description: "Swallowed error" }],
    };
    const { provider } = fakeModelProvider([{ findings: [] }]);

    const report = formatEvalReport(await runEvalSet([wide], provider, "test-model"));

    expect(report).toContain("  missed     bad-practice    src/export.ts:1-3  Swallowed error\n");
    expect(report).toContain("Caught 0 of 1 Planted Problems (0%): 0 of 0 Security Issues, 0 of 1 Bad Practices.\nNo Finding went unmatched.\n");
  });
});

describe("The Eval Set", () => {
  test("has at least five fixtures and ten Planted Problems, of both kinds", () => {
    const plantedProblems = EVAL_SET.flatMap((fixture) => fixture.plantedProblems);

    expect(EVAL_SET.length).toBeGreaterThanOrEqual(5);
    expect(plantedProblems.length).toBeGreaterThanOrEqual(10);
    expect(new Set(plantedProblems.map((plantedProblem) => plantedProblem.kind))).toEqual(
      new Set(["bad-practice", "security-issue"]),
    );
  });

  // A Finding is only kept on added lines, so a Planted Problem anywhere else could never be caught.
  test.each(
    EVAL_SET.flatMap(({ pullRequest, plantedProblems }) =>
      plantedProblems.map((plantedProblem) => ({ pullRequest, plantedProblem, name: `${pullRequest.repo}: ${plantedProblem.description}` })),
    ),
  )("$name lies on lines its fixture adds", ({ pullRequest, plantedProblem }) => {
    const file = pullRequest.files.find((changed) => changed.path === plantedProblem.file);
    const addedLines = parsePatch(file?.patch ?? "").flatMap((hunk) =>
      hunk.lines.flatMap((line) => (line.type === "added" ? [line.newLine] : [])),
    );

    expect(plantedProblem.startLine).toBeLessThanOrEqual(plantedProblem.endLine);
    for (let line = plantedProblem.startLine; line <= plantedProblem.endLine; line++) {
      expect(addedLines).toContain(line);
    }
  });
});
