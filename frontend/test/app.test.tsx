import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { GitHubAppStatus, ModelProviderListing, PullRequestDetail, PullRequestSummary, Review } from "@diffwise/shared";
import { App } from "../src/App.tsx";

const pullRequest: PullRequestSummary = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234def",
};

const pullRequestDetail: PullRequestDetail = { ...pullRequest, changedFiles: ["src/users.ts", "src/config.ts"] };

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
    if (url === "/api/repositories") {
      return Response.json({ repositories: [{ owner: "acme", repo: "shop" }, { owner: "acme", repo: "docs" }] });
    }
    if (url === "/api/repositories/acme/shop/pull-requests") return Response.json([pullRequest]);
    if (url === "/api/repositories/acme/shop/pull-requests/7") return Response.json(pullRequestDetail);
    if (url === "/api/models") return Response.json(models);
    if (url === "/api/reviews" && init?.method === "POST") return Response.json(startedReview, { status: 201 });
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Opens the app on the Pull Request's detail view, as browsing or pasting its URL would. */
async function openPullRequest() {
  window.location.hash = "#/acme/shop/pull/7";
  render(<App />);
  await screen.findByRole("heading", { name: "Add user lookup" });
}

/** Opens the Pull Request's detail view and starts a Review of it, once a Model is there to run it. */
async function startReview() {
  await openPullRequest();
  const button = screen.getByRole("button", { name: "Review" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

describe("browsing to a Pull Request", () => {
  test("the page lists the repositories the GitHub App is installed on", async () => {
    stubApi();
    render(<App />);

    expect(await screen.findByRole("link", { name: "acme/shop" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "acme/docs" })).toBeInTheDocument();
  });

  test("when some repositories couldn't be listed, the page lists the rest and says why", async () => {
    const unlisted = "GitHub replied 401 when listing the GitHub App's installations: Bad credentials";
    stubApi(review, modelListing, {
      "/api/repositories": () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }], unlisted }),
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(unlisted);
  });

  test("selecting a repository lists its open Pull Requests", async () => {
    stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/shop" }));

    expect(await screen.findByRole("heading", { name: /open pull requests in acme\/shop/i })).toBeInTheDocument();
    const row = (await screen.findByRole("link", { name: "Add user lookup" })).closest("li")!;
    expect(row).toHaveTextContent("#7 by octocat at abc1234");
    expect(screen.queryByRole("link", { name: "acme/docs" })).not.toBeInTheDocument();
  });

  test("a repository with no open Pull Requests says so", async () => {
    stubApi(review, modelListing, { "/api/repositories/acme/docs/pull-requests": () => Response.json([]) });
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/docs" }));

    expect(await screen.findByText(/acme\/docs has no open pull requests/i)).toBeInTheDocument();
  });

  test("a repository whose Pull Requests can't be listed shows why", async () => {
    const error = "The GitHub App diffwise-a1b2c3 isn't installed on acme/docs. Install it on that repo, then try again.";
    stubApi(review, modelListing, {
      "/api/repositories/acme/docs/pull-requests": () => Response.json({ error }, { status: 403 }),
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/docs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });

  test("selecting a Pull Request shows its title, author, head commit and changed files, with a Review button", async () => {
    const fetch = stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/shop" }));
    await userEvent.click(await screen.findByRole("link", { name: "Add user lookup" }));

    const detail = await screen.findByRole("region", { name: "Add user lookup" });
    expect(detail).toHaveTextContent("acme/shop#7 by octocat at abc1234");
    const changedFiles = within(detail).getByRole("list", { name: "Changed files (2)" });
    expect(within(changedFiles).getAllByRole("listitem").map((file) => file.textContent)).toEqual(["src/users.ts", "src/config.ts"]);
    expect(screen.queryByRole("region", { name: /review of/i })).not.toBeInTheDocument();

    const button = within(detail).getByRole("button", { name: "Review" });
    expect(button).toHaveClass("dw-btn-primary");
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(fetch).toHaveBeenCalledWith(
      "/api/reviews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "Ollama", model: "llama3.1:8b" }),
      }),
    );
    expect(await screen.findByRole("region", { name: /review of acme\/shop#7/i })).toBeInTheDocument();
  });

  test("the detail view leads back to its repository's Pull Requests, and to the repositories", async () => {
    stubApi();
    await openPullRequest();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });

    await userEvent.click(within(breadcrumb).getByRole("link", { name: "acme/shop" }));
    expect(await screen.findByRole("heading", { name: /open pull requests in acme\/shop/i })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Repositories" }));
    expect(await screen.findByRole("link", { name: "acme/docs" })).toBeInTheDocument();
  });

  test("a Pull Request that can't be shown says why, and offers no Review", async () => {
    stubApi(review, modelListing, {
      "/api/repositories/acme/shop/pull-requests/7": () => Response.json({ error: "Pull Request acme/shop#7 not found" }, { status: 404 }),
    });
    window.location.hash = "#/acme/shop/pull/7";
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Pull Request acme/shop#7 not found");
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});

test("reviewing a fixture Pull Request shows each file's diff with every Finding beneath its lines", async () => {
  const fetch = stubApi();
  await startReview();

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
  await startReview();

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
  await startReview();

  const header = await screen.findByRole("region", { name: /review of acme\/shop#7/i });
  expect(header).toHaveTextContent(/llama3\.1:8b via Ollama at abc1234/);
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
  await startReview();

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
  await startReview();

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
  await startReview();

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
  await startReview();

  const users = await screen.findByRole("region", { name: "src/users.ts" });
  expect(within(users).queryByRole("table")).not.toBeInTheDocument();
  expect(within(users).getByText(/saved before diffs were kept/i)).toBeInTheDocument();
  expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
});

test("a Review with no Findings says so", async () => {
  stubApi({ ...review, findings: [] });
  await startReview();

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
  await startReview();

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
  await startReview();

  await screen.findByRole("region", { name: "src/users.ts" });
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
});

test("the Model dropdown groups Models by Model Provider, and the Review runs on the chosen one", async () => {
  const fetch = stubApi({ ...review, modelProvider: "OpenAI-compatible", model: "gpt-4o" });
  await openPullRequest();

  const select = await screen.findByRole("combobox", { name: /model/i });
  const groups = within(select).getAllByRole("group");
  expect(groups.map((g) => [g.getAttribute("label"), within(g).getAllByRole("option").map((o) => o.textContent)])).toEqual([
    ["Ollama", ["llama3.1:8b", "qwen2.5-coder:7b"]],
    ["OpenAI-compatible", ["gpt-4o"]],
  ]);

  await userEvent.selectOptions(select, "gpt-4o");
  await userEvent.click(screen.getByRole("button", { name: "Review" }));

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
  await openPullRequest();

  const select = await screen.findByRole("combobox", { name: /model/i });
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["gpt-4o"]);
  expect(screen.getByText(/ollama is unavailable/i)).toHaveTextContent(/ECONNREFUSED/);
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
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
  await openPullRequest();

  expect(await screen.findByText(explanation)).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: /model/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
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

describe("opening a Pull Request by URL", () => {
  const url = "https://github.com/acme/shop/pull/7";
  const byUrl = (pasted: string) => `/api/pull-requests/by-url?url=${encodeURIComponent(pasted)}`;

  test("pasting a GitHub Pull Request URL leads to the same detail view as browsing to it", async () => {
    const fetch = stubApi(review, modelListing, { [byUrl(url)]: () => Response.json(pullRequestDetail) });
    render(<App />);

    await userEvent.type(await screen.findByRole("textbox", { name: "Pull Request URL" }), url);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    const detail = await screen.findByRole("region", { name: "Add user lookup" });
    expect(detail).toHaveTextContent("acme/shop#7 by octocat at abc1234");
    expect(within(detail).getByRole("list", { name: "Changed files (2)" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/acme/shop/pull/7");
    expect(within(detail).getByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/reviews", expect.anything());
  });

  test.each([
    ["isn't a GitHub Pull Request URL", 400, `"nope" isn't a GitHub Pull Request URL. Paste one like https://github.com/owner/repo/pull/123`],
    ["is in a repo the GitHub App isn't installed on", 403, "The GitHub App diffwise-a1b2c3 isn't installed on acme/shop. Install it on that repo, then try again."],
  ])("pasting something that %s shows the error, and stays on the repositories", async (_, status, error) => {
    const pasted = status === 400 ? "nope" : url;
    stubApi(review, modelListing, { [byUrl(pasted)]: () => Response.json({ error }, { status }) });
    render(<App />);

    await userEvent.type(await screen.findByRole("textbox", { name: "Pull Request URL" }), pasted);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(screen.getByRole("link", { name: "acme/shop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});
