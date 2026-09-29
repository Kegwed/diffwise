import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { PullRequestSummary, Review } from "@diffwise/shared";
import { App } from "../src/App.tsx";

const pullRequest: PullRequestSummary = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234def",
};

const review: Review = {
  id: "review-1",
  pullRequest: { owner: "acme", repo: "shop", number: 7 },
  headCommit: "abc1234def",
  model: "llama3.1:8b",
  createdAt: "2026-09-27T10:00:00.000Z",
  fileOutcomes: [
    { file: "src/users.ts", outcome: "reviewed" },
    { file: "src/config.ts", outcome: "reviewed" },
  ],
  findings: [
    {
      kind: "security-issue",
      severity: "critical",
      file: "src/users.ts",
      startLine: 3,
      endLine: 3,
      title: "SQL injection",
      explanation: "The name is interpolated straight into the SQL string.",
      suggestedFix: "db.query('SELECT * FROM users WHERE name = ?', [name])",
      securityReference: "CWE-89",
    },
    {
      kind: "bad-practice",
      severity: "low",
      file: "src/config.ts",
      startLine: 1,
      endLine: 2,
      title: "Magic number",
      explanation: "The timeout should be a named constant.",
    },
    {
      kind: "bad-practice",
      severity: "medium",
      file: "src/users.ts",
      startLine: 5,
      endLine: 6,
      title: "Swallowed error",
      explanation: "The catch block ignores the error.",
    },
  ],
};

/** Stubs fetch with the backend's API responses. */
function stubApi(startedReview: Review = review) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/pull-requests") return Response.json([pullRequest]);
    if (url === "/api/reviews" && init?.method === "POST") return Response.json(startedReview, { status: 201 });
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("reviewing a fixture Pull Request shows its Findings grouped by file", async () => {
  const fetch = stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: /review/i }));

  expect(fetch).toHaveBeenCalledWith(
    "/api/reviews",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 } }),
    }),
  );

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
    "SQL injection",
    "Swallowed error",
  ]);
  expect(within(users).getByText("CWE-89")).toBeInTheDocument();
  expect(within(users).getByText(/lines 5–6/i)).toBeInTheDocument();

  const config = screen.getByRole("region", { name: "src/config.ts" });
  expect(within(config).getByRole("heading", { level: 4 })).toHaveTextContent("Magic number");

  expect(screen.getByText(/llama3\.1:8b/)).toBeInTheDocument();
});

test("a Review with no Findings says so", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/pull-requests" ? Response.json([pullRequest]) : Response.json({ ...review, findings: [] }, { status: 201 }),
    ),
  );
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: /review/i }));

  expect(await screen.findByText(/no findings/i)).toBeInTheDocument();
});

test("each file shows its outcome, and skipped or failed files flag the Review's coverage as incomplete", async () => {
  stubApi({
    ...review,
    fileOutcomes: [
      { file: "package-lock.json", outcome: "skipped", reason: "Lockfile" },
      { file: "src/users.ts", outcome: "reviewed" },
      { file: "src/config.ts", outcome: "reviewed" },
      { file: "src/report.ts", outcome: "failed", reason: "Failed twice. First attempt: the Model's reply was not valid JSON. Retry: the Model's reply was not valid JSON." },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: /review/i }));

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).getByText("Reviewed")).toBeInTheDocument();

  const lockfile = screen.getByRole("region", { name: "package-lock.json" });
  expect(within(lockfile).getByText("Skipped")).toBeInTheDocument();
  expect(within(lockfile).getByText("Lockfile")).toBeInTheDocument();

  const report = screen.getByRole("region", { name: "src/report.ts" });
  expect(within(report).getByText("Failed")).toBeInTheDocument();
  expect(within(report).getByText(/not valid JSON/)).toBeInTheDocument();

  const notice = screen.getByRole("note");
  expect(notice).toHaveTextContent(/incomplete coverage/i);
  expect(notice).toHaveTextContent(/1 file skipped/i);
  expect(notice).toHaveTextContent(/1 file failed/i);
});

test("a Review whose every file was reviewed has no incomplete-coverage notice", async () => {
  stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: /review/i }));

  await screen.findByRole("region", { name: "src/users.ts" });
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});
