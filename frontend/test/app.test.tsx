import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ModelProviderListing, PullRequestSummary, Review } from "@diffwise/shared";
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
  modelProvider: "Ollama",
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

const modelListing: ModelProviderListing[] = [
  { modelProvider: "Ollama", status: "available", models: ["llama3.1:8b", "qwen2.5-coder:7b"] },
  { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
];

/** The titles of the Findings in a file's region, in the order they're shown. */
function findingTitles(file: HTMLElement) {
  return within(file)
    .getAllByRole("article")
    .map((finding) => within(finding).getByRole("heading").textContent);
}

/** Stubs fetch with the backend's API responses. */
function stubApi(startedReview: Review = review, models: ModelProviderListing[] = modelListing) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/pull-requests") return Response.json([pullRequest]);
    if (url === "/api/models") return Response.json(models);
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
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "Ollama", model: "llama3.1:8b" }),
    }),
  );

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
  expect(within(users).getByText("CWE-89")).toBeInTheDocument();
  expect(within(users).getByText("src/users.ts:3")).toBeInTheDocument();
  expect(within(users).getByText("src/users.ts:5–6")).toBeInTheDocument();

  const config = screen.getByRole("region", { name: "src/config.ts" });
  expect(findingTitles(config)).toEqual(["Magic number"]);

  expect(screen.getByRole("region", { name: /review of/i })).toHaveTextContent(/llama3\.1:8b via Ollama/);
});

test("each Pull Request has a secondary Run review button", async () => {
  stubApi();
  render(<App />);

  const button = await screen.findByRole("button", { name: "Run review" });
  expect(button).toHaveClass("dw-btn-secondary", "dw-btn-sm");
});

test("within each file, Findings are sorted by Severity, highest first, then by line", async () => {
  const finding = review.findings[1]!;
  stubApi({
    ...review,
    fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed" }],
    findings: [
      { ...finding, severity: "low", startLine: 1, endLine: 1, title: "Low at 1" },
      { ...finding, severity: "high", startLine: 9, endLine: 9, title: "High at 9" },
      { ...finding, severity: "critical", startLine: 20, endLine: 22, title: "Critical at 20" },
      { ...finding, severity: "high", startLine: 4, endLine: 7, title: "High at 4" },
      { ...finding, severity: "medium", startLine: 2, endLine: 2, title: "Medium at 2" },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: /review/i }));

  const config = await screen.findByRole("region", { name: "src/config.ts" });
  expect(findingTitles(config)).toEqual(["Critical at 20", "High at 4", "High at 9", "Medium at 2", "Low at 1"]);
});

test("a Review with no Findings says so", async () => {
  stubApi({ ...review, findings: [] });
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
  expect(within(users).getByText("Reviewed")).toHaveClass("dw-badge-outline");

  const lockfile = screen.getByRole("region", { name: "package-lock.json" });
  expect(within(lockfile).getByText("Skipped")).toHaveClass("dw-badge-neutral");
  expect(within(lockfile).getByText("Lockfile")).toBeInTheDocument();

  const report = screen.getByRole("region", { name: "src/report.ts" });
  expect(within(report).getByText("Failed")).toHaveClass("dw-badge-neutral");
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

test("the Model dropdown groups Models by Model Provider, and the Review runs on the chosen one", async () => {
  const fetch = stubApi({ ...review, modelProvider: "OpenAI-compatible", model: "gpt-4o" });
  render(<App />);

  const select = await screen.findByRole("combobox", { name: /model/i });
  const groups = within(select).getAllByRole("group");
  expect(groups.map((g) => [g.getAttribute("label"), within(g).getAllByRole("option").map((o) => o.textContent)])).toEqual([
    ["Ollama", ["llama3.1:8b", "qwen2.5-coder:7b"]],
    ["OpenAI-compatible", ["gpt-4o"]],
  ]);

  await userEvent.selectOptions(select, "gpt-4o");
  await userEvent.click(screen.getByRole("button", { name: /review/i }));

  expect(fetch).toHaveBeenCalledWith(
    "/api/reviews",
    expect.objectContaining({
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "OpenAI-compatible", model: "gpt-4o" }),
    }),
  );
  expect(await screen.findByRole("region", { name: /review of/i })).toHaveTextContent(/gpt-4o via OpenAI-compatible/);
});

test("an unavailable Model Provider is shown with its reason, and the others' Models can still be chosen", async () => {
  stubApi(review, [
    { modelProvider: "Ollama", status: "unavailable", reason: "Could not reach http://localhost:11434/v1: ECONNREFUSED" },
    { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
  ]);
  render(<App />);

  const select = await screen.findByRole("combobox", { name: /model/i });
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["gpt-4o"]);
  expect(screen.getByText(/ollama is unavailable/i)).toHaveTextContent(/ECONNREFUSED/);
  expect(await screen.findByRole("button", { name: /review/i })).toBeEnabled();
});

test.each<[string, ModelProviderListing[], RegExp]>([
  ["none is configured", [], /no model provider is configured/i],
  [
    "none can be reached",
    [{ modelProvider: "Ollama", status: "unavailable", reason: "Could not reach http://localhost:11434/v1: ECONNREFUSED" }],
    /no model provider is available/i,
  ],
  ["none offers a Model", [{ modelProvider: "Ollama", status: "available", models: [] }], /no model provider is available/i],
])("when %s, the page explains why a Review can't be started", async (_, models, explanation) => {
  stubApi(review, models);
  render(<App />);

  expect(await screen.findByText(explanation)).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: /model/i })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /review/i })).toBeDisabled();
});
