import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { GitHubAppStatus, ModelProviderListing, PullRequestSummary, Review } from "@diffwise/shared";
import { App } from "../src/App.tsx";

const pullRequest: PullRequestSummary = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234def",
};

const usersPatch = [
  "@@ -1,3 +1,8 @@",
  " import { db } from './db';",
  "-export const findUser = (id) => db.get(id);",
  "+export function findUser(name: string) {",
  "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
  "+}",
  "+export function load() {",
  "+  try { return db.load(); } catch {}",
  "+}",
  " export default db;",
].join("\n");

const configPatch = ["@@ -0,0 +1,2 @@", "+export const timeout = 30000;", "+export const retries = 3;"].join("\n");

const review: Review = {
  id: "review-1",
  pullRequest: { owner: "acme", repo: "shop", number: 7 },
  headCommit: "abc1234def",
  modelProvider: "Ollama",
  model: "llama3.1:8b",
  createdAt: "2026-09-27T10:00:00.000Z",
  fileOutcomes: [
    { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
    { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
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
    .map((finding) => within(finding).getByRole("heading", { level: 4 }).textContent);
}

/** The diff's rows of code (not the rows holding Findings), each with its old and new line number cells. */
function codeRows(file: HTMLElement) {
  return within(file)
    .getAllByRole("row")
    .filter((row) => within(row).queryByRole("article") === null);
}

/** The code row showing a line of the new version of the file. */
function newLineRow(file: HTMLElement, newLine: number) {
  const row = codeRows(file).find((r) => (r as HTMLTableRowElement).cells[1]?.textContent === String(newLine));
  if (!row) throw new Error(`No row for new line ${newLine}`);
  return row as HTMLTableRowElement;
}

/** The titles of the Findings shown directly beneath a line of the new version of the file, in order. */
function findingsBeneath(file: HTMLElement, newLine: number) {
  const titles: (string | null)[] = [];
  for (let row = newLineRow(file, newLine).nextElementSibling; row; row = row.nextElementSibling) {
    const finding = within(row as HTMLElement).queryByRole("article");
    if (!finding) break;
    titles.push(within(finding).getByRole("heading", { level: 4 }).textContent);
  }
  return titles;
}

const createdGitHubApp: GitHubAppStatus = {
  status: "created",
  name: "diffwise-a1b2c3",
  htmlUrl: "https://github.com/apps/diffwise-a1b2c3",
  installUrl: "https://github.com/apps/diffwise-a1b2c3/installations/new",
};

/** Stubs fetch with the backend's API responses; `routes` answers any other URL. */
function stubApi(
  startedReview: Review = review,
  models: ModelProviderListing[] = modelListing,
  routes: Record<string, () => Response> = {},
) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (routes[url]) return routes[url]();
    if (url === "/api/github-app") return Response.json(createdGitHubApp);
    if (url === "/api/pull-requests") return Response.json([pullRequest]);
    if (url === "/api/models") return Response.json(models);
    if (url === "/api/reviews" && init?.method === "POST") return Response.json(startedReview, { status: 201 });
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("reviewing a fixture Pull Request shows each file's diff with every Finding beneath its lines", async () => {
  const fetch = stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  expect(fetch).toHaveBeenCalledWith(
    "/api/reviews",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "Ollama", model: "llama3.1:8b" }),
    }),
  );

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(findingsBeneath(users, 3)).toEqual(["SQL injection"]);
  expect(findingsBeneath(users, 6)).toEqual(["Swallowed error"]);
  expect(findingsBeneath(users, 5)).toEqual([]);
  expect(within(users).getByText("CWE-89")).toBeInTheDocument();
  expect(within(users).getByText("src/users.ts:3")).toBeInTheDocument();
  expect(within(users).getByText("src/users.ts:5–6")).toBeInTheDocument();
  expect(within(users).getByText("The name is interpolated straight into the SQL string.")).toBeInTheDocument();
  expect(within(users).getByText("Suggested Fix")).toBeInTheDocument();

  const config = screen.getByRole("region", { name: "src/config.ts" });
  expect(findingsBeneath(config, 1)).toEqual([]);
  expect(findingsBeneath(config, 2)).toEqual(["Magic number"]);
});

test("the diff is GitHub-style: hunk headers, then each line with its old and new line numbers and its marker", async () => {
  stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).getByText("@@ -1,3 +1,8 @@")).toBeInTheDocument();
  expect(codeRows(users).map((row) => [...(row as HTMLTableRowElement).cells].map((cell) => cell.textContent))).toEqual([
    ["@@ -1,3 +1,8 @@"],
    ["1", "1", " import { db } from './db';"],
    ["2", "", "-export const findUser = (id) => db.get(id);"],
    ["", "2", "+export function findUser(name: string) {"],
    ["", "3", "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);"],
    ["", "4", "+}"],
    ["", "5", "+export function load() {"],
    ["", "6", "+  try { return db.load(); } catch {}"],
    ["", "7", "+}"],
    ["3", "8", " export default db;"],
  ]);
});

test("the header shows the Model and the head commit the Review covered", async () => {
  stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const header = await screen.findByRole("region", { name: /review of acme\/shop#7/i });
  expect(header).toHaveTextContent(/llama3\.1:8b via Ollama at abc1234/);
});

test("each Pull Request has a secondary Run review button", async () => {
  stubApi();
  render(<App />);

  const button = await screen.findByRole("button", { name: "Run review" });
  expect(button).toHaveClass("dw-btn-secondary", "dw-btn-sm");
});

test("Findings beneath the same line are stacked by Severity, highest first, then by line", async () => {
  const finding = review.findings[1]!;
  stubApi({
    ...review,
    fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed", patch: configPatch }],
    findings: [
      { ...finding, severity: "low", startLine: 2, endLine: 2, title: "Low at 2" },
      { ...finding, severity: "medium", startLine: 2, endLine: 2, title: "Medium at 2" },
      { ...finding, severity: "medium", startLine: 1, endLine: 2, title: "Medium at 1–2" },
      { ...finding, severity: "critical", startLine: 2, endLine: 2, title: "Critical at 2" },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const config = await screen.findByRole("region", { name: "src/config.ts" });
  expect(findingsBeneath(config, 2)).toEqual(["Critical at 2", "Medium at 1–2", "Medium at 2", "Low at 2"]);
});

test("Findings on lines the diff doesn't show are listed after it, by Severity, highest first, then by line", async () => {
  const finding = review.findings[1]!;
  stubApi({
    ...review,
    fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed", patch: configPatch }],
    findings: [
      { ...finding, severity: "low", startLine: 1, endLine: 1, title: "Low at 1" },
      { ...finding, severity: "high", startLine: 9, endLine: 9, title: "High at 9" },
      { ...finding, severity: "critical", startLine: 20, endLine: 22, title: "Critical at 20" },
      { ...finding, severity: "high", startLine: 4, endLine: 7, title: "High at 4" },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const config = await screen.findByRole("region", { name: "src/config.ts" });
  expect(findingsBeneath(config, 1)).toEqual(["Low at 1"]);
  expect(within(config).getByText(/on lines this diff doesn't show/i)).toBeInTheDocument();
  expect(findingTitles(config)).toEqual(["Low at 1", "Critical at 20", "High at 4", "High at 9"]);
});

test.each([
  ["ends with a newline", `${configPatch}\n`],
  ["has Windows line endings", `${configPatch.replaceAll("\n", "\r\n")}\r\n`],
])("a patch that %s shows only the lines its hunks hold", async (_, patch) => {
  const finding = review.findings[1]!;
  stubApi({
    ...review,
    fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed", patch }],
    findings: [{ ...finding, startLine: 3, endLine: 3, title: "Past the end" }],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const config = await screen.findByRole("region", { name: "src/config.ts" });
  expect(codeRows(config).map((row) => row.textContent)).toEqual([
    "@@ -0,0 +1,2 @@",
    "1+export const timeout = 30000;",
    "2+export const retries = 3;",
  ]);
  expect(within(config).getByText(/on lines this diff doesn't show/i)).toBeInTheDocument();
});

test("a Review saved before diffs were kept lists each file's Findings without a diff", async () => {
  stubApi({
    ...review,
    fileOutcomes: [
      { file: "src/users.ts", outcome: "reviewed", patch: "" },
      { file: "src/config.ts", outcome: "reviewed", patch: "" },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).queryByRole("table")).not.toBeInTheDocument();
  expect(within(users).getByText(/saved before diffs were kept/i)).toBeInTheDocument();
  expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
});

test("a Review with no Findings says so", async () => {
  stubApi({ ...review, findings: [] });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  expect(await screen.findByText(/no findings/i)).toBeInTheDocument();
});

test("skipped and failed files show their outcome and reason instead of a diff, and flag coverage as incomplete", async () => {
  stubApi({
    ...review,
    fileOutcomes: [
      { file: "package-lock.json", outcome: "skipped", reason: "Lockfile" },
      { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
      { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
      { file: "src/report.ts", outcome: "failed", reason: "Failed twice. First attempt: the Model's reply was not valid JSON. Retry: the Model's reply was not valid JSON." },
    ],
  });
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).getByText("Reviewed")).toHaveClass("dw-badge-outline");
  expect(within(users).getByRole("table", { name: "Diff of src/users.ts" })).toBeInTheDocument();

  const lockfile = screen.getByRole("region", { name: "package-lock.json" });
  expect(within(lockfile).getByText("Skipped")).toHaveClass("dw-badge-neutral");
  expect(within(lockfile).getByText("Lockfile")).toBeInTheDocument();
  expect(within(lockfile).queryByRole("table")).not.toBeInTheDocument();

  const report = screen.getByRole("region", { name: "src/report.ts" });
  expect(within(report).getByText("Failed")).toHaveClass("dw-badge-neutral");
  expect(within(report).getByText(/not valid JSON/)).toBeInTheDocument();
  expect(within(report).queryByRole("table")).not.toBeInTheDocument();

  const notice = screen.getByRole("note");
  expect(notice).toHaveTextContent(/incomplete coverage/i);
  expect(notice).toHaveTextContent(/1 file skipped/i);
  expect(notice).toHaveTextContent(/1 file failed/i);
});

test("a Review whose every file was reviewed has no incomplete-coverage notice", async () => {
  stubApi();
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "Run review" }));

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
  await userEvent.click(screen.getByRole("button", { name: "Run review" }));

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
  expect(await screen.findByRole("button", { name: "Run review" })).toBeEnabled();
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
  expect(await screen.findByRole("button", { name: "Run review" })).toBeDisabled();
});

describe("connecting to GitHub", () => {
  test("with no GitHub App created, the page offers to create one", async () => {
    stubApi(review, modelListing, { "/api/github-app": () => Response.json({ status: "not-created" }) });
    render(<App />);

    const button = await screen.findByRole("button", { name: "Create GitHub App" });
    expect(button.closest("form")).toHaveAttribute("action", "/api/github-app/new");
    expect(screen.queryByRole("link", { name: /install/i })).not.toBeInTheDocument();
  });

  test("once the GitHub App is created, the page says how to install it on repos", async () => {
    stubApi();
    render(<App />);

    const link = await screen.findByRole("link", { name: /install diffwise-a1b2c3/i });
    expect(link).toHaveAttribute("href", "https://github.com/apps/diffwise-a1b2c3/installations/new");
    expect(screen.queryByRole("button", { name: "Create GitHub App" })).not.toBeInTheDocument();
  });
});

describe("reviewing a Pull Request by URL", () => {
  const url = "https://github.com/acme/shop/pull/7";
  const byUrl = (pasted: string) => `/api/pull-requests/by-url?url=${encodeURIComponent(pasted)}`;

  test("pasting a GitHub Pull Request URL starts a Review of that Pull Request on the chosen Model", async () => {
    const fetch = stubApi(review, modelListing, { [byUrl(url)]: () => Response.json(pullRequest) });
    render(<App />);
    await screen.findByRole("combobox", { name: /model/i });

    await userEvent.type(screen.getByRole("textbox", { name: "Pull Request URL" }), url);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/reviews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "Ollama", model: "llama3.1:8b" }),
      }),
    );
    expect(await screen.findByRole("region", { name: /review of acme\/shop#7/i })).toBeInTheDocument();
  });

  test.each([
    ["isn't a GitHub Pull Request URL", 400, `"nope" isn't a GitHub Pull Request URL. Paste one like https://github.com/owner/repo/pull/123`],
    ["is in a repo the GitHub App isn't installed on", 403, "The GitHub App diffwise-a1b2c3 isn't installed on acme/shop. Install it on that repo, then try again."],
  ])("pasting something that %s shows the error, and no Review starts", async (_, status, error) => {
    const pasted = status === 400 ? "nope" : url;
    const fetch = stubApi(review, modelListing, { [byUrl(pasted)]: () => Response.json({ error }, { status }) });
    render(<App />);
    await screen.findByRole("combobox", { name: /model/i });

    await userEvent.type(screen.getByRole("textbox", { name: "Pull Request URL" }), pasted);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(fetch).not.toHaveBeenCalledWith("/api/reviews", expect.anything());
  });
});
