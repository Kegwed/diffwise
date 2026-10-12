import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Finding,
  GitHubAppStatus,
  ModelProviderListing,
  PullRequestDetail,
  PullRequestSummary,
  Review,
  ReviewEvent,
  ReviewSummary,
} from "@diffwise/shared";
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
  status: "complete",
  pendingFiles: [],
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

/** Stands in for the browser's EventSource on a Review's progress stream, sending the events a test gives it. */
class FakeProgressStream {
  static readonly CLOSED = 2;
  readyState = 1;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  close() {
    this.readyState = FakeProgressStream.CLOSED;
  }

  deliver(events: ReviewEvent[]) {
    for (const event of events) this.onmessage?.({ data: JSON.stringify(event) });
  }

  send(...events: ReviewEvent[]) {
    act(() => this.deliver(events));
  }

  /** Fails for good, as the browser's does when the backend answers with an error. */
  fail() {
    this.readyState = FakeProgressStream.CLOSED;
    act(() => this.onerror?.());
  }
}

/**
 * Stubs the progress stream the page follows a Review on. With `script`, it sends those events (or the ones `script`
 * gives for the stream's URL) as soon as it's followed; without, the test sends them on the stream `followed()`
 * resolves with: the latest one, or the latest one of the Review with the given id.
 */
function stubProgressStream(script?: ReviewEvent[] | ((url: string) => ReviewEvent[])) {
  const streams: FakeProgressStream[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends FakeProgressStream {
      constructor(url: string) {
        super(url);
        streams.push(this);
        if (script) queueMicrotask(() => this.deliver(typeof script === "function" ? script(url) : script));
      }
    },
  );
  return {
    followed: (reviewId?: string) =>
      waitFor(() => {
        const stream = streams.findLast((s) => reviewId === undefined || s.url === `/api/reviews/${reviewId}/events`);
        expect(stream).toBeDefined();
        return stream!;
      }),
  };
}

/**
 * Stubs fetch with the backend's API responses; `routes` answers any other URL. A started Review is `startedReview`,
 * already complete when the page follows it.
 */
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
    if (url === "/api/repositories/acme/shop/pull-requests/7/reviews") return Response.json([]);
    if (url === "/api/models") return Response.json(models);
    if (url === "/api/reviews" && init?.method === "POST") return Response.json(startedReview, { status: 201 });
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  stubProgressStream([{ type: "review", review: startedReview }, { type: "complete" }]);
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

/** The page of the Review that's open. */
function openedReview() {
  return screen.findByRole("region", { name: /^Review of / });
}

/** What the Review's page says about it, by what each detail is ("Author", "Model" ...). */
function details(page: HTMLElement) {
  const terms = within(page).getAllByRole("term");
  const values = within(page).getAllByRole("definition");
  return Object.fromEntries(terms.map((term, i) => [term.textContent, values[i]!.textContent]));
}

describe("a Review's page", () => {
  test("a Review has its own page, leading back to its Pull Request and saying what was reviewed with which Model", async () => {
    stubApi();
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    const page = await openedReview();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["acme/shop", "#/acme/shop"],
      ["#7 Add user lookup", "#/acme/shop/pull/7"],
    ]);
    expect(within(breadcrumb).getByText("Review of abc1234")).toHaveAttribute("aria-current", "page");
    expect(await within(page).findByRole("heading", { name: "Add user lookup" })).toBeInTheDocument();
    expect(within(page).getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.com/acme/shop/pull/7");
    await waitFor(() =>
      expect(details(page)).toEqual({
        Author: "octocat",
        "Reviewed commit": "abc1234",
        Model: "llama3.1:8b on Ollama",
        State: "Complete",
        Findings: "3",
      }),
    );
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Reviews" })).not.toBeInTheDocument();
  });

  test("while a Review runs, its page shows how many of the files to review are done, not counting skipped ones", async () => {
    stubApi();
    const progress = stubProgressStream();
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    (await progress.followed()).send({
      type: "review",
      review: {
        ...review,
        status: "running",
        fileOutcomes: [
          { file: "package-lock.json", outcome: "skipped", reason: "Lockfile" },
          { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
        ],
        pendingFiles: [{ file: "src/config.ts", state: "reviewing" }],
        findings: [review.findings[0]!],
      },
    });

    const running = screen.getByRole("status");
    expect(running).toHaveTextContent(
      "Reviewing: 1 of 2 files" + "Findings appear as each file finishes. If Diffwise restarts, this Review is lost.",
    );
    const bar = within(running).getByRole("progressbar", { name: "Review progress" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["1", "2"]);
  });

  test("an Unsaved Review's page says it isn't saved, and that a restart loses it", async () => {
    stubApi();
    stubProgressStream([{ type: "review", review: { ...review, status: "unsaved" } }]);
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    expect(await screen.findByRole("note")).toHaveTextContent(
      "Unsaved" + "This Review has finished but isn't saved. If Diffwise restarts, it is lost.",
    );
  });

  test("an Outdated Review's page names the latest commit, and the Model a Review of it would run on", async () => {
    stubApi();
    stubProgressStream([{ type: "review", review: { ...review, headCommit: "0ld5678fed" } }, { type: "complete" }]);
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    const page = await openedReview();
    const notice = await within(page).findByRole("note");
    expect(notice).toHaveTextContent(
      "Outdated" +
        "New commits were pushed after 0ld5678, so these Findings may not apply to the latest commit. " +
        "A Review of it runs with the same Model, llama3.1:8b on Ollama." +
        "Review the latest commit",
    );
    expect(within(notice).getByRole("button", { name: "Review the latest commit" })).toHaveClass("dw-btn-primary");
    expect(details(page)).toMatchObject({ "Reviewed commit": "0ld5678 Latest on GitHub: abc1234", State: "Outdated" });
  });

  test("a Review with skipped or failed files says how many of the changed files its Findings cover", async () => {
    stubApi({
      ...review,
      fileOutcomes: [
        { file: "package-lock.json", outcome: "skipped", reason: "Lockfile" },
        { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
        { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
        { file: "src/report.ts", outcome: "failed", reason: "Failed twice." },
      ],
    });
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    expect(await screen.findByRole("note")).toHaveTextContent(
      "Incomplete coverage" + "1 file failed and 1 file was skipped, so these Findings cover 2 of 4 changed files.",
    );
  });
});

describe("browsing to a Pull Request", () => {
  test("the page lists the Repositories the GitHub App is installed on", async () => {
    stubApi();
    render(<App />);

    expect(await screen.findByRole("link", { name: "acme/shop" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "acme/docs" })).toBeInTheDocument();
  });

  test("when some Repositories couldn't be listed, the page lists the rest and says why", async () => {
    const unlisted = "GitHub replied 401 when listing the GitHub App's installations: Bad credentials";
    stubApi(review, modelListing, {
      "/api/repositories": () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }], unlisted }),
    });
    render(<App />);

    expect(await screen.findByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(unlisted);
  });

  test("selecting a Repository lists its open Pull Requests", async () => {
    stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/shop" }));

    expect(await screen.findByRole("heading", { name: /open pull requests in acme\/shop/i })).toBeInTheDocument();
    const row = (await screen.findByRole("link", { name: "Add user lookup" })).closest("li")!;
    expect(row).toHaveTextContent("#7 by octocat at abc1234");
    expect(screen.queryByRole("link", { name: "acme/docs" })).not.toBeInTheDocument();
  });

  test("a Repository with no open Pull Requests says so", async () => {
    stubApi(review, modelListing, { "/api/repositories/acme/docs/pull-requests": () => Response.json([]) });
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/docs" }));

    expect(await screen.findByText(/acme\/docs has no open pull requests/i)).toBeInTheDocument();
  });

  test("a Repository whose Pull Requests can't be listed shows why", async () => {
    const error = "The GitHub App diffwise-a1b2c3 isn't installed on acme/docs. Install it there, then try again.";
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
    expect(await openedReview()).toBeInTheDocument();
  });

  test("the detail view leads back to its Repository's Pull Requests, and to the Repositories", async () => {
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

test("a started Review's page says which Model reviewed which commit", async () => {
  stubApi();
  await startReview();

  const page = await openedReview();
  await waitFor(() => expect(details(page)).toMatchObject({ "Reviewed commit": "abc1234", Model: "llama3.1:8b on Ollama" }));
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

describe("live progress while a Review runs", () => {
  const running: Review = {
    ...review,
    status: "running",
    fileOutcomes: [],
    pendingFiles: [
      { file: "src/users.ts", state: "reviewing" },
      { file: "src/config.ts", state: "queued" },
    ],
    findings: [],
  };
  const [sqlInjection, magicNumber, swallowedError] = review.findings as [Finding, Finding, Finding];

  test("starting a Review puts it in the URL and follows its progress stream", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();

    const stream = await progress.followed();

    expect(stream.url).toBe("/api/reviews/review-1/events");
    expect(window.location.hash).toBe("#/acme/shop/pull/7/reviews/review-1");
  });

  test("each file shows its state as it changes, and its Findings appear as it finishes", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();
    const stream = await progress.followed();

    stream.send({ type: "review", review: running });

    const users = screen.getByRole("region", { name: "src/users.ts" });
    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(users).getByText("Reviewing")).toHaveClass("dw-badge-neutral");
    expect(within(config).getByText("Queued")).toHaveClass("dw-badge-outline");
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing: 0 of 2 files");
    expect(screen.getByText("No Findings yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    stream.send({
      type: "file-settled",
      fileOutcome: { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
      findings: [sqlInjection, swallowedError],
    });

    expect(within(users).getByText("Reviewed")).toBeInTheDocument();
    expect(findingsBeneath(users, 3)).toEqual(["SQL injection"]);
    expect(findingsBeneath(users, 6)).toEqual(["Swallowed error"]);
    expect(within(config).getByText("Queued")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing: 1 of 2 files");
    expect(screen.queryByText(/no findings/i)).not.toBeInTheDocument();

    stream.send({ type: "file-reviewing", file: "src/config.ts" });

    expect(within(config).getByText("Reviewing")).toBeInTheDocument();
    expect(within(config).queryByText("Queued")).not.toBeInTheDocument();

    stream.send({
      type: "file-settled",
      fileOutcome: { file: "src/config.ts", outcome: "failed", reason: "Failed twice. The Model's reply was not valid JSON." },
      findings: [],
    });

    expect(within(config).getByText("Failed")).toBeInTheDocument();
    expect(within(config).getByText(/not valid JSON/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing: 2 of 2 files");

    stream.send({ type: "complete" });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/1 file failed/i);
    expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
  });

  test("a running Review's page says so until it completes, and then stops following it", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();
    const stream = await progress.followed();

    stream.send({ type: "review", review: running });

    const page = await openedReview();
    expect(details(page)).toMatchObject({ State: "Running", Findings: "0 so far" });

    stream.send(
      { type: "file-settled", fileOutcome: { file: "src/users.ts", outcome: "reviewed", patch: usersPatch }, findings: [] },
      { type: "file-settled", fileOutcome: { file: "src/config.ts", outcome: "reviewed", patch: configPatch }, findings: [magicNumber] },
      { type: "complete" },
    );

    expect(details(page)).toMatchObject({ State: "Complete", Findings: "1" });
    expect(stream.readyState).toBe(FakeProgressStream.CLOSED);
  });

  test("a Review that turns out Unsaved stops running, and says a restart of Diffwise will lose it", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();
    const stream = await progress.followed();

    stream.send({ type: "review", review: { ...review, status: "running" } }, { type: "unsaved" });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(details(await openedReview())).toMatchObject({ State: "Unsaved" });
    expect(stream.readyState).toBe(FakeProgressStream.CLOSED);
    const notice = screen.getByRole("note");
    expect(within(notice).getByText("Unsaved")).toBeInTheDocument();
    expect(notice).toHaveTextContent("This Review has finished but isn't saved. If Diffwise restarts, it is lost.");
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection", "Swallowed error"]);
  });

  test("reopening a running Review picks it up as it stands, then follows it live", async () => {
    stubApi();
    const progress = stubProgressStream();
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);
    const stream = await progress.followed();

    stream.send({
      type: "review",
      review: {
        ...running,
        fileOutcomes: [{ file: "src/users.ts", outcome: "reviewed", patch: usersPatch }],
        pendingFiles: [{ file: "src/config.ts", state: "reviewing" }],
        findings: [sqlInjection],
      },
    });

    expect(stream.url).toBe("/api/reviews/review-1/events");
    expect(findingsBeneath(screen.getByRole("region", { name: "src/users.ts" }), 3)).toEqual(["SQL injection"]);
    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(config).getByText("Reviewing")).toBeInTheDocument();

    stream.send({
      type: "file-settled",
      fileOutcome: { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
      findings: [magicNumber],
    });

    expect(findingsBeneath(config, 2)).toEqual(["Magic number"]);
  });

  test("when the stream reconnects, the Review as it then stands replaces what the page had", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();
    const stream = await progress.followed();
    stream.send(
      { type: "review", review: running },
      { type: "file-settled", fileOutcome: { file: "src/users.ts", outcome: "reviewed", patch: usersPatch }, findings: [sqlInjection] },
    );

    // The connection dropped, and the browser reconnected: the stream starts again from the Review.
    stream.send({
      type: "review",
      review: {
        ...running,
        fileOutcomes: [{ file: "src/users.ts", outcome: "reviewed", patch: usersPatch }],
        pendingFiles: [{ file: "src/config.ts", state: "reviewing" }],
        findings: [sqlInjection],
      },
    });

    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection"]);
    expect(within(screen.getByRole("region", { name: "src/config.ts" })).getByText("Reviewing")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reviewing: 1 of 2 files");
  });

  test("leaving the Review's page stops following the Review", async () => {
    stubApi();
    const progress = stubProgressStream();
    await startReview();
    const stream = await progress.followed();
    stream.send({ type: "review", review: running });

    await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "acme/shop" }));

    await screen.findByRole("heading", { name: /open pull requests in acme\/shop/i });
    expect(stream.readyState).toBe(FakeProgressStream.CLOSED);
  });

  test("a Review that can't be followed says why", async () => {
    const error = "Review review-1 not found. A Review that was still running when Diffwise restarted is lost: start it again.";
    stubApi(review, modelListing, { "/api/reviews/review-1": () => Response.json({ error }, { status: 404 }) });
    const progress = stubProgressStream();
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);
    const stream = await progress.followed();

    stream.fail();

    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });
});

describe("a Pull Request's Reviews", () => {
  const REVIEWS = "/api/repositories/acme/shop/pull-requests/7/reviews";
  const llama: ReviewSummary = {
    id: "review-1",
    modelProvider: "Ollama",
    model: "llama3.1:8b",
    headCommit: "abc1234def",
    createdAt: "2026-09-27T10:00:00.000Z",
    status: "complete",
    findingCounts: { "bad-practice": 2, "security-issue": 1 },
    outdated: false,
  };
  const gpt: ReviewSummary = {
    ...llama,
    id: "review-2",
    modelProvider: "OpenAI-compatible",
    model: "gpt-4o",
    createdAt: "2026-09-27T11:30:00.000Z",
    findingCounts: { "bad-practice": 0, "security-issue": 0 },
  };

  /** The row of the Pull Request's list of Reviews that leads to the Review by `model`. */
  function reviewRow(model: RegExp) {
    const reviews = screen.getByRole("list", { name: "Reviews" });
    return within(reviews).getByRole("link", { name: model }).closest("li")!;
  }

  test("the detail view lists the Pull Request's Reviews with their Model, head commit, date and Finding counts", async () => {
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json([gpt, llama]) });
    await openPullRequest();

    const reviews = await screen.findByRole("list", { name: "Reviews" });
    expect(within(reviews).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "gpt-4o via OpenAI-compatible",
      "llama3.1:8b via Ollama",
    ]);
    const row = reviewRow(/llama3\.1:8b/);
    expect(row).toHaveTextContent("at abc1234");
    expect(within(row).getByRole("time")).toHaveAttribute("datetime", "2026-09-27T10:00:00.000Z");
    expect(row).toHaveTextContent("1 Security Issue, 2 Bad Practices");
    expect(reviewRow(/gpt-4o/)).toHaveTextContent("No Findings");
  });

  test("a Pull Request with no Reviews says so", async () => {
    stubApi();
    await openPullRequest();

    expect(await screen.findByText("This Pull Request has no Reviews yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Reviews" })).not.toBeInTheDocument();
  });

  test("two Reviews of the same commit by different Models can be opened one after another from the list", async () => {
    const byGpt: Review = { ...review, id: "review-2", modelProvider: "OpenAI-compatible", model: "gpt-4o", findings: [review.findings[0]!] };
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json([gpt, llama]) });
    stubProgressStream((url) => [
      { type: "review", review: url === "/api/reviews/review-2/events" ? byGpt : review },
      { type: "complete" },
    ]);
    await openPullRequest();

    await userEvent.click(await screen.findByRole("link", { name: "llama3.1:8b via Ollama" }));

    await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "llama3.1:8b on Ollama" }));
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection", "Swallowed error"]);

    await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: /^#7/ }));
    await userEvent.click(await screen.findByRole("link", { name: "gpt-4o via OpenAI-compatible" }));

    await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "gpt-4o on OpenAI-compatible" }));
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection"]);
    expect(window.location.hash).toBe("#/acme/shop/pull/7/reviews/review-2");
  });

  test("a Review that's started joins the list as running, and shows its Finding counts once it completes", async () => {
    const running: ReviewSummary = { ...llama, status: "running", findingCounts: { "bad-practice": 0, "security-issue": 0 } };
    let listed: ReviewSummary[] = [];
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json(listed) });
    const progress = stubProgressStream();
    await openPullRequest();
    await screen.findByText("This Pull Request has no Reviews yet.");

    listed = [running];
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    (await progress.followed()).send({ type: "review", review: { ...review, status: "running" } });
    await openedReview();

    // Back on the Pull Request's page, the Review is listed as running, and followed until it completes.
    await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: /^#7/ }));
    await waitFor(() => expect(within(reviewRow(/llama3\.1:8b/)).getByText("Running")).toHaveClass("dw-badge-outline"));
    const stream = await progress.followed();
    stream.send({ type: "review", review: { ...review, status: "running" } });

    listed = [llama];
    stream.send({ type: "complete" });

    await waitFor(() => expect(reviewRow(/llama3\.1:8b/)).toHaveTextContent("1 Security Issue, 2 Bad Practices"));
    expect(within(reviewRow(/llama3\.1:8b/)).queryByText("Running")).not.toBeInTheDocument();
  });

  test("a listed Review that completes stops being listed as running", async () => {
    const byGpt: Review = { ...review, id: "review-2", modelProvider: "OpenAI-compatible", model: "gpt-4o", findings: [review.findings[0]!] };
    let listed: ReviewSummary[] = [{ ...gpt, status: "running" }, llama];
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json(listed) });
    const progress = stubProgressStream();
    await openPullRequest();
    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Running")).toBeInTheDocument());

    listed = [{ ...gpt, findingCounts: { "bad-practice": 0, "security-issue": 1 } }, llama];
    (await progress.followed("review-2")).send({ type: "review", review: { ...byGpt, status: "running" } }, { type: "complete" });

    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).queryByText("Running")).not.toBeInTheDocument());
    expect(reviewRow(/gpt-4o/)).toHaveTextContent("1 Security Issue");
  });

  test("a listed Review that turns out Unsaved is listed as Unsaved, not running", async () => {
    const byGpt: Review = { ...review, id: "review-2", modelProvider: "OpenAI-compatible", model: "gpt-4o", findings: [review.findings[0]!] };
    let listed: ReviewSummary[] = [{ ...gpt, status: "running" }, llama];
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json(listed) });
    const progress = stubProgressStream();
    await openPullRequest();
    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Running")).toBeInTheDocument());

    listed = [{ ...gpt, status: "unsaved", findingCounts: { "bad-practice": 0, "security-issue": 1 } }, llama];
    (await progress.followed("review-2")).send({ type: "review", review: { ...byGpt, status: "running" } }, { type: "unsaved" });

    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).queryByText("Running")).not.toBeInTheDocument());
    expect(within(reviewRow(/gpt-4o/)).getByText("Unsaved")).toBeInTheDocument();
    expect(within(reviewRow(/llama3\.1:8b/)).queryByText("Unsaved")).not.toBeInTheDocument();
  });

  test("why a Review couldn't be started is shown even when the Reviews couldn't be listed", async () => {
    stubApi(review, modelListing, {
      [REVIEWS]: () => Response.json({ error: "GitHub replied 503 when fetching acme/shop#7: unavailable" }, { status: 502 }),
      "/api/reviews": () => Response.json({ error: "Ollama can't be reached" }, { status: 502 }),
    });
    await openPullRequest();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/GitHub replied 503/));

    await userEvent.click(await screen.findByRole("button", { name: "Review" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ollama can't be reached"));
  });

  describe("when new commits were pushed since a Review ran", () => {
    const oldCommit = "0ld5678fed";
    const outdatedGpt: ReviewSummary = { ...gpt, headCommit: oldCommit, outdated: true };
    const byGpt: Review = { ...review, id: "review-2", headCommit: oldCommit, modelProvider: "OpenAI-compatible", model: "gpt-4o" };
    /** A Review of a commit before `oldCommit`, Outdated even to a page opened before the new commits were pushed. */
    const earlier: Review = { ...byGpt, headCommit: "f1r5t90abc" };
    /** The Review of the latest commit that an Outdated one starts. */
    const fresh: Review = { ...byGpt, id: "review-3", headCommit: pullRequest.headCommit };

    /** Opens the Review of the earlier head commit directly by its URL. */
    async function openEarlierReview() {
      stubProgressStream([{ type: "review", review: byGpt }, { type: "complete" }]);
      window.location.hash = "#/acme/shop/pull/7/reviews/review-2";
      render(<App />);
      return openedReview();
    }

    test("the Review's page says it's Outdated, and the Pull Request's list badges it and not the others", async () => {
      stubApi(review, modelListing, { [REVIEWS]: () => Response.json([llama, outdatedGpt]) });
      const opened = await openEarlierReview();

      await waitFor(() => expect(details(opened)).toMatchObject({ State: "Outdated" }));
      expect(within(opened).getByRole("note")).toHaveTextContent(/new commits were pushed/i);

      await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: /^#7/ }));

      await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Outdated")).toHaveClass("dw-badge-neutral"));
      expect(within(reviewRow(/llama3\.1:8b/)).queryByText("Outdated")).not.toBeInTheDocument();
    });

    test("a Review of the Pull Request's head commit isn't Outdated, and has no button to review the latest commit", async () => {
      stubApi();
      window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
      render(<App />);

      const opened = await openedReview();
      await within(opened).findByRole("heading", { name: "Add user lookup" });
      expect(details(opened)).toMatchObject({ State: "Complete" });
      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Review the latest commit" })).not.toBeInTheDocument();
    });

    test("one click on the Outdated Review starts a Review of the latest commit with the same Model", async () => {
      const fetch = stubApi(fresh);
      stubProgressStream((url) => [
        { type: "review", review: url === "/api/reviews/review-3/events" ? fresh : byGpt },
        { type: "complete" },
      ]);
      window.location.hash = "#/acme/shop/pull/7/reviews/review-2";
      render(<App />);

      await userEvent.click(await screen.findByRole("button", { name: "Review the latest commit" }));

      expect(fetch).toHaveBeenCalledWith(
        "/api/reviews",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "OpenAI-compatible", model: "gpt-4o" }),
        }),
      );
      await waitFor(() => expect(window.location.hash).toBe("#/acme/shop/pull/7/reviews/review-3"));
      await waitFor(async () =>
        expect(details(await openedReview())).toMatchObject({ "Reviewed commit": "abc1234", Model: "gpt-4o on OpenAI-compatible", State: "Complete" }),
      );
    });

    test("the Review says it couldn't be checked, and may be Outdated, when the Pull Request couldn't be loaded", async () => {
      stubApi(byGpt, modelListing, {
        "/api/repositories/acme/shop/pull-requests/7": () =>
          Response.json({ error: "GitHub can't be reached: getaddrinfo ENOTFOUND api.github.com" }, { status: 502 }),
      });
      const opened = await openEarlierReview();

      expect(await within(opened).findByRole("note")).toHaveTextContent(
        "Diffwise couldn't check whether new commits were pushed to this Pull Request since this Review ran, so it may be Outdated.",
      );
      expect(details(opened)).toMatchObject({ State: "Complete" });
      expect(screen.queryByRole("button", { name: "Review the latest commit" })).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(/GitHub can't be reached/);
    });

    test("the Review says nothing about Outdated while the Pull Request is still loading", async () => {
      let load = (_: Response) => {};
      const loading = new Promise<Response>((resolve) => (load = resolve));
      stubApi(byGpt, modelListing, { "/api/repositories/acme/shop/pull-requests/7": () => loading as never });
      const opened = await openEarlierReview();
      await waitFor(() => expect(details(opened)).toMatchObject({ State: "Complete" }));

      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Review the latest commit" })).not.toBeInTheDocument();

      load(Response.json(pullRequestDetail));

      await waitFor(() => expect(details(opened)).toMatchObject({ State: "Outdated" }));
    });

    test("a Review opened after the Pull Request couldn't be loaded says nothing about Outdated while it's loaded again", async () => {
      let reload = (_: Response) => {};
      let detail = (): Response | Promise<Response> => Response.json({ error: "GitHub can't be reached" }, { status: 502 });
      stubApi(review, modelListing, { "/api/repositories/acme/shop/pull-requests/7": () => detail() as never });
      stubProgressStream((url) => [
        { type: "review", review: url === "/api/reviews/review-1/events" ? review : byGpt },
        { type: "complete" },
      ]);
      window.location.hash = "#/acme/shop/pull/7/reviews/review-2";
      render(<App />);
      await within(await openedReview()).findByRole("note");

      detail = () => new Promise<Response>((resolve) => (reload = resolve));
      act(() => {
        window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
      });

      const opened = await screen.findByRole("region", { name: "Review of abc1234" });
      await waitFor(() => expect(details(opened)).toMatchObject({ Model: "llama3.1:8b on Ollama" }));
      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();

      reload(Response.json(pullRequestDetail));

      await within(opened).findByRole("heading", { name: "Add user lookup" });
      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();
      expect(details(opened)).toMatchObject({ State: "Complete" });
    });

    test("a Review just started of the latest commit says nothing about Outdated while the Pull Request is loaded again", async () => {
      // The page was opened before the new commits were pushed, on a Review of a commit earlier still.
      let reload = (_: Response) => {};
      let detail = (): Response | Promise<Response> => Response.json({ ...pullRequestDetail, headCommit: oldCommit });
      stubApi(fresh, modelListing, { "/api/repositories/acme/shop/pull-requests/7": () => detail() as never });
      stubProgressStream((url) => [
        { type: "review", review: url === "/api/reviews/review-3/events" ? fresh : earlier },
        { type: "complete" },
      ]);
      window.location.hash = "#/acme/shop/pull/7/reviews/review-2";
      render(<App />);

      detail = () => new Promise<Response>((resolve) => (reload = resolve));
      await userEvent.click(await screen.findByRole("button", { name: "Review the latest commit" }));

      const opened = await screen.findByRole("region", { name: "Review of abc1234" });
      await waitFor(() => expect(details(opened)).toMatchObject({ Model: "gpt-4o on OpenAI-compatible", State: "Complete" }));
      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();

      reload(Response.json(pullRequestDetail));

      await within(opened).findByRole("heading", { name: "Add user lookup" });
      expect(details(opened)).toMatchObject({ State: "Complete" });
      expect(within(opened).queryByRole("note")).not.toBeInTheDocument();
    });
  });
});

describe("the Findings panel", () => {
  /** Starts the Review and gives its Findings panel, next to the diff. */
  async function openPanel(startedReview: Review = review) {
    stubApi(startedReview);
    await startReview();
    return screen.findByRole("complementary", { name: "Findings" });
  }

  /** What each button of one of the panel's filters says, in order: what it filters by, then its count of Findings. */
  function filterButtons(panel: HTMLElement, filter: string) {
    return within(within(panel).getByRole("group", { name: filter }))
      .getAllByRole("button")
      .map((button) => button.textContent);
  }

  /** What each Finding in the panel's list says, in order. */
  function listedFindings(panel: HTMLElement) {
    return within(within(panel).getByRole("list"))
      .getAllByRole("listitem")
      .map((finding) => finding.textContent);
  }

  test("the panel shows how many Findings the Review reports of each kind and of each Severity", async () => {
    const panel = await openPanel();

    expect(filterButtons(panel, "Kind")).toEqual(["Security Issue 1", "Bad Practices 2"]);
    expect(filterButtons(panel, "Severity")).toEqual(["Critical 1", "High 0", "Medium 1", "Low 1"]);
  });

  test("the panel lists the Findings in the order the diff shows them, each with its Severity, title and lines", async () => {
    const panel = await openPanel();

    expect(listedFindings(panel)).toEqual([
      "Critical SQL injection src/users.ts:3",
      "Medium Swallowed error src/users.ts:5–6",
      "Low Magic number src/config.ts:1–2",
    ]);
  });

  test("filtering by kind hides the Findings of the other kind, in the panel and in the diff", async () => {
    const panel = await openPanel();
    const securityIssues = within(panel).getByRole("button", { name: /security issue/i });
    expect(securityIssues).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(securityIssues);

    expect(securityIssues).toHaveAttribute("aria-pressed", "true");
    expect(listedFindings(panel)).toEqual(["Critical SQL injection src/users.ts:3"]);
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection"]);
    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(config).queryByRole("article")).not.toBeInTheDocument();
    expect(within(config).getByRole("table", { name: "Diff of src/config.ts" })).toBeInTheDocument();
    // The counts stay the Review's, whatever is hidden.
    expect(filterButtons(panel, "Kind")).toEqual(["Security Issue 1", "Bad Practices 2"]);

    await userEvent.click(securityIssues);

    expect(securityIssues).toHaveAttribute("aria-pressed", "false");
    expect(listedFindings(panel)).toHaveLength(3);
    expect(findingsBeneath(config, 2)).toEqual(["Magic number"]);
  });

  test("filtering by Severity hides the Findings of the other Severities, and narrows the kind filter further", async () => {
    const panel = await openPanel();
    const severities = within(panel).getByRole("group", { name: "Severity" });
    const users = screen.getByRole("region", { name: "src/users.ts" });
    const config = screen.getByRole("region", { name: "src/config.ts" });

    await userEvent.click(within(severities).getByRole("button", { name: /critical/i }));
    await userEvent.click(within(severities).getByRole("button", { name: /low/i }));

    expect(within(severities).getByRole("button", { name: /critical/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(severities).getByRole("button", { name: /medium/i })).toHaveAttribute("aria-pressed", "false");
    expect(listedFindings(panel)).toEqual(["Critical SQL injection src/users.ts:3", "Low Magic number src/config.ts:1–2"]);
    expect(findingTitles(users)).toEqual(["SQL injection"]);
    expect(findingsBeneath(config, 2)).toEqual(["Magic number"]);
    expect(filterButtons(panel, "Severity")).toEqual(["Critical 1", "High 0", "Medium 1", "Low 1"]);

    await userEvent.click(within(panel).getByRole("button", { name: /bad practice/i }));

    expect(listedFindings(panel)).toEqual(["Low Magic number src/config.ts:1–2"]);
    expect(within(users).queryByRole("article")).not.toBeInTheDocument();
    expect(findingsBeneath(config, 2)).toEqual(["Magic number"]);
  });

  test("when the filters hide every Finding, the panel says so", async () => {
    const panel = await openPanel();

    await userEvent.click(within(panel).getByRole("button", { name: /security issue/i }));
    await userEvent.click(within(panel).getByRole("button", { name: /low/i }));

    expect(within(panel).getByText("No Findings match the filters.")).toBeInTheDocument();
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  describe("jumping to a Finding", () => {
    const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

    afterEach(() => {
      if (scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoView);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    /** jsdom lays nothing out, so it scrolls nowhere: this gives the elements the page scrolls into view, in order. */
    function stubScrolling() {
      const scrolledTo: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolledTo.push(this);
      };
      return scrolledTo;
    }

    /** The new line numbers of the diff's highlighted rows of code. */
    function highlightedLines(file: HTMLElement) {
      return codeRows(file)
        .filter((row) => row.classList.contains("diff-highlighted"))
        .map((row) => (row as HTMLTableRowElement).cells[1]?.textContent);
    }

    test("clicking a Finding in the panel scrolls the diff to its lines and highlights them", async () => {
      const scrolledTo = stubScrolling();
      const panel = await openPanel();
      const users = screen.getByRole("region", { name: "src/users.ts" });
      const config = screen.getByRole("region", { name: "src/config.ts" });
      const swallowedError = within(panel).getByRole("button", { name: /swallowed error/i });
      expect(highlightedLines(users)).toEqual([]);

      await userEvent.click(swallowedError);

      expect(scrolledTo).toEqual([newLineRow(users, 5)]);
      expect(highlightedLines(users)).toEqual(["5", "6"]);
      expect(swallowedError).toHaveAttribute("aria-current", "true");

      await userEvent.click(within(panel).getByRole("button", { name: /magic number/i }));

      expect(scrolledTo).toEqual([newLineRow(users, 5), newLineRow(config, 1)]);
      expect(highlightedLines(config)).toEqual(["1", "2"]);
      expect(highlightedLines(users)).toEqual([]);
      expect(swallowedError).not.toHaveAttribute("aria-current");
    });

    test("clicking the same Finding again scrolls back to its lines", async () => {
      const scrolledTo = stubScrolling();
      const panel = await openPanel();
      const users = screen.getByRole("region", { name: "src/users.ts" });

      await userEvent.click(within(panel).getByRole("button", { name: /sql injection/i }));
      await userEvent.click(within(panel).getByRole("button", { name: /sql injection/i }));

      expect(scrolledTo).toEqual([newLineRow(users, 3), newLineRow(users, 3)]);
      expect(highlightedLines(users)).toEqual(["3"]);
    });

    test("a Finding on lines the diff doesn't show is scrolled to itself", async () => {
      const scrolledTo = stubScrolling();
      const panel = await openPanel({
        ...review,
        fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed", patch: configPatch }],
        findings: [{ ...review.findings[1]!, startLine: 9, endLine: 9, title: "Past the end" }],
      });
      const config = screen.getByRole("region", { name: "src/config.ts" });

      await userEvent.click(within(panel).getByRole("button", { name: /past the end/i }));

      expect(scrolledTo).toHaveLength(1);
      expect(scrolledTo[0]).toContainElement(within(config).getByRole("article"));
      expect(scrolledTo[0]).not.toContainElement(within(config).getByRole("table"));
      expect(highlightedLines(config)).toEqual([]);
    });

    test("the lines of a Finding the filters then hide are no longer highlighted", async () => {
      stubScrolling();
      const panel = await openPanel();
      const users = screen.getByRole("region", { name: "src/users.ts" });
      await userEvent.click(within(panel).getByRole("button", { name: /swallowed error/i }));
      expect(highlightedLines(users)).toEqual(["5", "6"]);

      await userEvent.click(within(panel).getByRole("button", { name: /security issue/i }));

      expect(highlightedLines(users)).toEqual([]);
    });
  });
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
  expect(screen.queryByRole("complementary", { name: "Findings" })).not.toBeInTheDocument();
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
  expect(notice).toHaveTextContent(/1 file was skipped/i);
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
  await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "gpt-4o on OpenAI-compatible" }));
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

/** The header's connection statuses, as their text reads. */
async function connections() {
  const list = await screen.findByRole("list", { name: "Connections" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("the page header", () => {
  test("every view has the Diffwise name linking to the first page, and says GitHub is connected once the App is created", async () => {
    stubApi();
    await openPullRequest();

    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Diffwise" })).toHaveAttribute("href", "#/");
    await waitFor(async () => expect(await connections()).toContain("GitHub connected"));
  });

  test("with no GitHub App created, the header says GitHub isn't connected", async () => {
    stubApi(review, modelListing, { "/api/github-app": () => Response.json({ status: "not-created" }) });
    await openPullRequest();

    await waitFor(async () => expect(await connections()).toContain("GitHub not connected"));
  });

  test("the header says, for each Model Provider, whether it's connected or unavailable", async () => {
    stubApi(review, [
      { modelProvider: "Ollama", status: "available", models: ["llama3.1:8b"] },
      { modelProvider: "OpenAI-compatible", status: "unavailable", reason: "Couldn't reach https://llm.example/v1." },
    ]);
    await openPullRequest();

    await waitFor(async () =>
      expect(await connections()).toEqual(["GitHub connected", "Ollama connected", "OpenAI-compatible unavailable"]),
    );
  });

  test("until it hears back, the header says it's checking GitHub and the Model Providers", async () => {
    const fetch = stubApi();
    fetch.mockImplementation(() => new Promise<Response>(() => {}));
    render(<App />);

    expect(await connections()).toEqual(["Checking GitHub", "Checking Model Providers"]);
  });

  test("on the first view, when GitHub couldn't list the Repositories, the header says GitHub is unreachable", async () => {
    stubApi(review, modelListing, {
      "/api/repositories": () => Response.json({ repositories: [], unlisted: "GitHub didn't answer." }),
    });
    render(<App />);

    await waitFor(async () => expect(await connections()).toContain("GitHub unreachable"));
    expect(await connections()).not.toContain("GitHub connected");
  });
});

describe("connecting to GitHub", () => {
  test("with no GitHub App created, the page offers to create one", async () => {
    stubApi(review, modelListing, { "/api/github-app": () => Response.json({ status: "not-created" }) });
    render(<App />);

    const button = await screen.findByRole("button", { name: "Create GitHub App" });
    expect(button.closest("form")).toHaveAttribute("action", "/api/github-app/new");
    expect(screen.queryByRole("link", { name: /install/i })).not.toBeInTheDocument();
  });

  test("once the GitHub App is created, the page says how to install it on Repositories", async () => {
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
    ["is in a Repository the GitHub App isn't installed on", 403, "The GitHub App diffwise-a1b2c3 isn't installed on acme/shop. Install it there, then try again."],
  ])("pasting something that %s shows the error, and stays on the Repositories", async (_, status, error) => {
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
