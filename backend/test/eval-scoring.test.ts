import { describe, expect, test } from "vitest";
import type { Finding } from "@diffwise/shared";
import { scoreFindings, type PlantedProblem } from "../src/eval/scoring.ts";

const sqlInjection: PlantedProblem = {
  kind: "security-issue",
  file: "src/users.ts",
  startLine: 10,
  endLine: 12,
  description: "SQL injection",
};

function finding(overrides: Partial<Finding>): Finding {
  return {
    kind: "security-issue",
    severity: "high",
    file: "src/users.ts",
    startLine: 10,
    endLine: 12,
    title: "A problem",
    explanation: "Why it's a problem.",
    ...overrides,
  };
}

describe("Scoring a Review against Planted Problems", () => {
  test("a Planted Problem is caught by a Finding of the same kind on the same lines", () => {
    const score = scoreFindings([sqlInjection], [finding({})]);

    expect(score).toEqual({ caught: [sqlInjection], missed: [], unmatched: [] });
  });

  test("a Planted Problem no Finding reports is missed", () => {
    const score = scoreFindings([sqlInjection], []);

    expect(score).toEqual({ caught: [], missed: [sqlInjection], unmatched: [] });
  });

  test.each([
    ["only its first line", { startLine: 8, endLine: 10 }],
    ["only its last line", { startLine: 12, endLine: 15 }],
    ["a line inside it", { startLine: 11, endLine: 11 }],
    ["lines all around it", { startLine: 1, endLine: 40 }],
  ])("a Finding overlapping %s catches the Planted Problem", (_, lines) => {
    const score = scoreFindings([sqlInjection], [finding(lines)]);

    expect(score.caught).toEqual([sqlInjection]);
    expect(score.unmatched).toEqual([]);
  });

  test.each([
    ["ending on the line before it", { startLine: 7, endLine: 9 }],
    ["starting on the line after it", { startLine: 13, endLine: 14 }],
    ["of the other kind", { kind: "bad-practice" as const }],
    ["on the same lines of another file", { file: "src/orders.ts" }],
  ])("a Finding %s doesn't catch the Planted Problem, and is unmatched", (_, overrides) => {
    const stray = finding(overrides);

    const score = scoreFindings([sqlInjection], [stray]);

    expect(score).toEqual({ caught: [], missed: [sqlInjection], unmatched: [stray] });
  });

  test("one Finding catches every Planted Problem it overlaps", () => {
    const hardCodedSecret: PlantedProblem = { ...sqlInjection, startLine: 14, endLine: 14, description: "Hard-coded secret" };

    const score = scoreFindings([sqlInjection, hardCodedSecret], [finding({ startLine: 12, endLine: 14 })]);

    expect(score).toEqual({ caught: [sqlInjection, hardCodedSecret], missed: [], unmatched: [] });
  });

  test("several Findings on one Planted Problem catch it once, and none of them is unmatched", () => {
    const score = scoreFindings([sqlInjection], [finding({ title: "Injection" }), finding({ title: "Unsanitised input" })]);

    expect(score).toEqual({ caught: [sqlInjection], missed: [], unmatched: [] });
  });

  test("each Planted Problem is scored on its own, among Findings that match nothing", () => {
    const swallowedError: PlantedProblem = {
      kind: "bad-practice",
      file: "src/export.ts",
      startLine: 7,
      endLine: 7,
      description: "Swallowed error",
    };
    const catching = finding({ startLine: 11, endLine: 11 });
    const noise = finding({ kind: "bad-practice", file: "src/export.ts", startLine: 3, endLine: 3 });

    const score = scoreFindings([sqlInjection, swallowedError], [noise, catching]);

    expect(score).toEqual({ caught: [sqlInjection], missed: [swallowedError], unmatched: [noise] });
  });
});
