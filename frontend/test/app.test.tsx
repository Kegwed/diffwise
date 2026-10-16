import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Finding,
  GitHubAppStatus,
  ModelProviderListing,
  OpenPullRequest,
  PullRequestDetail,
  PullRequestSummary,
  RecentReview,
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
  baseBranch: "main",
  headBranch: "user-lookup",
  // Two hours before the tests run, so it's always "2 hours ago".
  updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
};

const pullRequestDetail: PullRequestDetail = {
  ...pullRequest,
  state: "open",
  changedFiles: [
    { path: "src/users.ts", additions: 3, deletions: 0, binary: false },
    { path: "src/config.ts", additions: 2, deletions: 1, binary: false },
  ],
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

/** The diff's rows: hunk headers, then each line with its old and new line number cells. */
function codeRows(file: HTMLElement) {
  return within(file).getAllByRole("row");
}

/** The code row showing a line of the new version of the file. */
function newLineRow(file: HTMLElement, newLine: number) {
  const row = codeRows(file).find((r) => (r as HTMLTableRowElement).cells[1]?.textContent === String(newLine));
  if (!row) throw new Error(`No row for new line ${newLine}`);
  return row as HTMLTableRowElement;
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
    if (url === "/api/reviews") return Response.json([]);
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

/** The Severity chips in a row of Reviews, as their text reads ("2 Critical"). */
function severityChips(row: HTMLElement) {
  return [...row.querySelectorAll(".dw-sev")].map((chip) => chip.textContent);
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

/** The Pull Request's changed files, each as its path and what it changes ("+3 −0", "Binary"). */
function changedFiles(page: HTMLElement) {
  const list = within(page).getByRole("list", { name: "Changed files" });
  return within(list)
    .getAllByRole("listitem")
    .map((file) => [file.querySelector("code")!.textContent, file.querySelector(".caption")!.textContent]);
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
    expect(within(page).getByText("acme/shop #7 · user-lookup into main")).toBeInTheDocument();
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

  test("each file the Model was given has its own part of the page: its outcome, its Finding count, and its diff once reviewed", async () => {
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
          { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
          { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
          { file: "src/report.ts", outcome: "failed", reason: "Failed twice. First attempt: the Model call timed out after 120s." },
        ],
        pendingFiles: [
          { file: "src/orders.ts", state: "reviewing" },
          { file: "src/cart.ts", state: "queued" },
        ],
        findings: [review.findings[0]!, review.findings[2]!],
      },
    });

    const users = screen.getByRole("region", { name: "src/users.ts" });
    expect(within(users).getByRole("heading", { level: 3 })).toHaveTextContent("src/users.ts");
    expect(within(users).getByText("Reviewed")).toBeInTheDocument();
    expect(within(users).getByText("2 Findings")).toBeInTheDocument();

    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(config).getByText("No Findings")).toBeInTheDocument();
    expect(within(config).getByRole("table", { name: "Diff of src/config.ts" })).toBeInTheDocument();
    expect(within(config).getByText("No Findings in the lines this file changes.")).toBeInTheDocument();

    const report = screen.getByRole("region", { name: "src/report.ts" });
    expect(within(report).getByText("Failed")).toBeInTheDocument();
    expect(report).toHaveTextContent("Failed twice. First attempt: the Model call timed out after 120s.");

    expect(screen.getByRole("region", { name: "src/orders.ts" })).toHaveTextContent(
      "Reviewing now. Findings for this file appear when the Model finishes it.",
    );
    expect(screen.getByRole("region", { name: "src/cart.ts" })).toHaveTextContent("Queued.");
  });

  test("skipped files are listed once, at the end, each with why it was skipped", async () => {
    stubApi({
      ...review,
      fileOutcomes: [
        { file: "package-lock.json", outcome: "skipped", reason: "Lockfile" },
        { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
        { file: "dist/app.min.js", outcome: "skipped", reason: "Minified asset" },
        { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
      ],
    });
    window.location.hash = "#/acme/shop/pull/7/reviews/review-1";
    render(<App />);

    const skipped = await screen.findByRole("region", { name: "Skipped files" });
    expect(
      within(within(skipped).getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["package-lock.jsonSkippedLockfile", "dist/app.min.jsSkippedMinified asset"]);
    expect(screen.queryByRole("region", { name: "package-lock.json" })).not.toBeInTheDocument();
    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label") ?? region.textContent);
    expect(regions.indexOf("src/config.ts")).toBeLessThan(regions.findIndex((name) => /skipped files/i.test(name ?? "")));
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

  test("selecting a Repository lists its open Pull Requests, each with its branches, head commit and when it was updated", async () => {
    stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/shop" }));

    expect(await screen.findByRole("heading", { name: "acme/shop" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Open Pull Requests" });
    expect(await within(list).findByText("1 open")).toBeInTheDocument();
    const row = within(list).getByRole("link", { name: "Add user lookup" }).closest("li")!;
    expect(within(row).getByRole("link", { name: "Add user lookup" })).toHaveAttribute("href", "#/acme/shop/pull/7");
    expect(row).toHaveTextContent("#7 · opened by octocat · user-lookup into main");
    expect(within(row).getByTitle("abc1234def")).toHaveTextContent("abc1234");
    expect(within(row).getByRole("time")).toHaveTextContent("2 hours ago");
    expect(within(row).getByRole("time")).toHaveAttribute("datetime", pullRequest.updatedAt);
    expect(row).toHaveTextContent("No Reviews yet");
    expect(list).toHaveTextContent(
      "Closed Pull Requests aren't listed here. Paste a closed Pull Request's URL on the home page to open it.",
    );
    expect(screen.queryByRole("link", { name: "acme/docs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Built-in fixture")).not.toBeInTheDocument();
  });

  test("the built-in fixture Repository says what it's for", async () => {
    stubApi(review, modelListing, { "/api/repositories/diffwise-fixtures/bookshop/pull-requests": () => Response.json([]) });
    window.location.hash = "#/diffwise-fixtures/bookshop";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
    expect(screen.getByText("Built-in fixture")).toHaveClass("dw-badge");
    expect(screen.getByText("Ships with Diffwise so you can try a Review without connecting GitHub.")).toBeInTheDocument();
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

  test("selecting a Pull Request shows its title, branches, author, head commit, state and changed files, with a Review button", async () => {
    const fetch = stubApi();
    render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "acme/shop" }));
    await userEvent.click(await screen.findByRole("link", { name: "Add user lookup" }));

    const detail = await screen.findByRole("region", { name: "Add user lookup" });
    expect(within(detail).getByText("acme/shop #7 · user-lookup into main")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.com/acme/shop/pull/7");
    expect(details(detail)).toEqual({ Author: "octocat", "Head commit": "abc1234", "Changed files": "2 files", "Pull Request": "Open" });
    expect(changedFiles(detail)).toEqual([
      ["src/users.ts", "+3 −0"],
      ["src/config.ts", "+2 −1"],
    ]);
    expect(screen.queryByRole("region", { name: /review of/i })).not.toBeInTheDocument();

    const start = within(detail).getByRole("region", { name: "Start a Review" });
    expect(start).toHaveTextContent("Reviews head commit abc1234. You choose the Model for each Review.");
    expect(start).toHaveTextContent("A restart while a Review is running loses it.");
    const button = within(start).getByRole("button", { name: "Review" });
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

  test("a binary changed file says so in place of its line counts", async () => {
    stubApi(review, modelListing, {
      "/api/repositories/acme/shop/pull-requests/7": () =>
        Response.json({
          ...pullRequestDetail,
          changedFiles: [...pullRequestDetail.changedFiles, { path: "assets/logo.png", additions: 0, deletions: 0, binary: true }],
        }),
    });
    await openPullRequest();

    const detail = screen.getByRole("region", { name: "Add user lookup" });
    expect(changedFiles(detail).at(-1)).toEqual(["assets/logo.png", "Binary"]);
    expect(details(detail)).toMatchObject({ "Changed files": "3 files" });
  });

  test.each<[PullRequestDetail["state"], string]>([
    ["closed", "Closed"],
    ["merged", "Merged"],
  ])("a %s Pull Request says so", async (state, label) => {
    stubApi(review, modelListing, { "/api/repositories/acme/shop/pull-requests/7": () => Response.json({ ...pullRequestDetail, state }) });
    await openPullRequest();

    expect(details(screen.getByRole("region", { name: "Add user lookup" }))).toMatchObject({ "Pull Request": label });
  });

  test("the detail view leads back to its Repository's Pull Requests, and to the Repositories", async () => {
    stubApi();
    await openPullRequest();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getAllByRole("link").map((link) => link.textContent)).toEqual(["acme/shop"]);
    expect(within(breadcrumb).getByText("#7")).toHaveAttribute("aria-current", "page");

    await userEvent.click(within(breadcrumb).getByRole("link", { name: "acme/shop" }));
    expect(await screen.findByRole("heading", { name: "acme/shop" })).toBeInTheDocument();

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

test("reviewing a fixture Pull Request shows each file's diff with its Findings beside it", async () => {
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
  expect(within(users).getByRole("table", { name: "Diff of src/users.ts" })).toBeInTheDocument();
  expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
  expect(within(users).getByText("CWE-89")).toBeInTheDocument();
  expect(within(users).getByRole("button", { name: "src/users.ts:3" })).toBeInTheDocument();
  expect(within(users).getByRole("button", { name: "src/users.ts:5–6" })).toBeInTheDocument();
  expect(within(users).getByText("The name is interpolated straight into the SQL string.")).toBeInTheDocument();
  expect(within(users).getByText("Suggested Fix")).toBeInTheDocument();

  expect(findingTitles(screen.getByRole("region", { name: "src/config.ts" }))).toEqual(["Magic number"]);
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

test("a file's Findings are ordered by Severity, highest first, then by line", async () => {
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
  expect(findingTitles(config)).toEqual(["Critical at 2", "Medium at 1–2", "Medium at 2", "Low at 2"]);
});

test("Findings on lines the diff doesn't show are listed with the file's others, by Severity, then by line", async () => {
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
  expect(findingTitles(config)).toEqual(["Critical at 20", "High at 4", "High at 9", "Low at 1"]);
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
    expect(details(await openedReview())).toMatchObject({ Findings: "0 so far" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    stream.send({
      type: "file-settled",
      fileOutcome: { file: "src/users.ts", outcome: "reviewed", patch: usersPatch },
      findings: [sqlInjection, swallowedError],
    });

    expect(within(users).getByText("Reviewed")).toBeInTheDocument();
    expect(findingTitles(users)).toEqual(["SQL injection", "Swallowed error"]);
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
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection"]);
    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(config).getByText("Reviewing")).toBeInTheDocument();

    stream.send({
      type: "file-settled",
      fileOutcome: { file: "src/config.ts", outcome: "reviewed", patch: configPatch },
      findings: [magicNumber],
    });

    expect(findingTitles(config)).toEqual(["Magic number"]);
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

    await screen.findByRole("heading", { name: "acme/shop" });
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

describe("an open Pull Request's latest Review", () => {
  const latest: ReviewSummary = {
    id: "review-1",
    modelProvider: "Ollama",
    model: "llama3.1:8b",
    headCommit: "abc1234def",
    createdAt: "2026-09-27T10:00:00.000Z",
    status: "complete",
    findingCounts: { "bad-practice": 1, "security-issue": 2 },
    severityCounts: { low: 1, medium: 0, high: 2, critical: 0 },
    outdated: false,
  };

  /** Opens acme/shop's page, listing its one open Pull Request with `latestReview`; resolves with its row. */
  async function openRow(latestReview?: ReviewSummary) {
    const listed: OpenPullRequest = latestReview ? { ...pullRequest, latestReview } : pullRequest;
    stubApi(review, modelListing, { "/api/repositories/acme/shop/pull-requests": () => Response.json([listed]) });
    window.location.hash = "#/acme/shop";
    render(<App />);
    return (await screen.findByRole("link", { name: "Add user lookup" })).closest("li")!;
  }

  /** The row's latest Review: its state's badge, and what the note beside it says. */
  function latestReviewOf(row: HTMLElement) {
    const state = row.querySelector(".dw-state")!;
    return { state: state.textContent, className: state.className, note: state.parentElement!.textContent!.slice(state.textContent!.length) };
  }

  test("isn't there when the Pull Request has no Reviews", async () => {
    const row = await openRow();

    expect(row).toHaveTextContent("No Reviews yet");
    expect(row.querySelector(".dw-state")).toBeNull();
  });

  test("when complete, says how many Findings of each Severity it reports, highest first", async () => {
    const row = await openRow(latest);

    expect(latestReviewOf(row)).toMatchObject({ state: "Complete", className: expect.stringContaining("dw-state-complete") });
    expect([...row.querySelectorAll(".dw-sev")].map((chip) => chip.textContent)).toEqual(["2 High", "1 Low"]);
  });

  test("when complete without Findings, says so", async () => {
    const row = await openRow({ ...latest, severityCounts: { low: 0, medium: 0, high: 0, critical: 0 } });

    expect(latestReviewOf(row)).toMatchObject({ state: "Complete", note: "No Findings" });
  });

  test("while running, says how many of its files have settled", async () => {
    const row = await openRow({ ...latest, status: "running", progress: { settled: 1, total: 3 } });

    expect(latestReviewOf(row)).toMatchObject({ state: "Running", className: expect.stringContaining("dw-state-running"), note: "1 of 3 files" });
  });

  test("when Unsaved, says a restart loses it", async () => {
    const row = await openRow({ ...latest, status: "unsaved" });

    expect(latestReviewOf(row)).toMatchObject({ state: "Unsaved", note: "Lost if Diffwise restarts." });
  });

  test("when Outdated, names the Pull Request's head commit now", async () => {
    const row = await openRow({ ...latest, headCommit: "0ld0ld0ld", outdated: true });

    expect(latestReviewOf(row)).toMatchObject({ state: "Outdated", className: expect.stringContaining("dw-state-outdated"), note: "Head is now abc1234" });
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
    severityCounts: { low: 1, medium: 1, high: 0, critical: 1 },
    outdated: false,
  };
  const gpt: ReviewSummary = {
    ...llama,
    id: "review-2",
    modelProvider: "OpenAI-compatible",
    model: "gpt-4o",
    createdAt: "2026-09-27T11:30:00.000Z",
    findingCounts: { "bad-practice": 0, "security-issue": 0 },
    severityCounts: { low: 0, medium: 0, high: 0, critical: 0 },
  };

  /** The row of the Pull Request's list of Reviews of the Review by `model`. */
  function reviewRow(model: RegExp) {
    const reviews = screen.getByRole("list", { name: "Reviews" });
    const row = within(reviews)
      .getAllByRole("listitem")
      .find((item) => model.test(item.textContent ?? ""));
    expect(row).toBeDefined();
    return row!;
  }

  /** Opens the Review by `model` from the Pull Request's list of Reviews. */
  async function openFromList(model: RegExp) {
    const row = await waitFor(() => reviewRow(model));
    await userEvent.click(within(row).getByRole("link"));
  }

  /** The Severity chips of a row, as they read. */
  test("the detail view lists the Pull Request's Reviews with their date, Model, commit, Findings by Severity and state", async () => {
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json([gpt, llama]) });
    await openPullRequest();

    const reviews = await screen.findByRole("list", { name: "Reviews" });
    expect(within(reviews).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "#/acme/shop/pull/7/reviews/review-2",
      "#/acme/shop/pull/7/reviews/review-1",
    ]);
    const row = reviewRow(/llama3\.1:8b/);
    expect(within(row).getByRole("link")).toContainElement(within(row).getByRole("time"));
    expect(within(row).getByRole("time")).toHaveAttribute("datetime", "2026-09-27T10:00:00.000Z");
    expect(row).toHaveTextContent("Ollama");
    expect(row).toHaveTextContent("abc1234");
    expect(severityChips(row)).toEqual(["1 Critical", "1 Medium", "1 Low"]);
    expect(within(row).getByText("Complete")).toHaveClass("dw-state-complete");
    expect(severityChips(reviewRow(/gpt-4o/))).toEqual([]);
    expect(reviewRow(/gpt-4o/)).toHaveTextContent("No Findings");
  });

  test("a running Review's row says how many of its files are done, and that a restart loses it", async () => {
    stubApi(review, modelListing, {
      [REVIEWS]: () => Response.json([{ ...gpt, status: "running", progress: { settled: 1, total: 3 } }, llama]),
    });
    await openPullRequest();

    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Running")).toHaveClass("dw-state-running"));
    expect(reviewRow(/gpt-4o/)).toHaveTextContent("1 of 3 files. Lost if Diffwise restarts.");
    expect(reviewRow(/llama3\.1:8b/)).not.toHaveTextContent("Lost if Diffwise restarts.");
  });

  test("when whether the Reviews are Outdated couldn't be worked out, the list says so above them", async () => {
    const { outdated: _, ...unchecked } = llama;
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json([unchecked]) });
    await openPullRequest();

    const list = await screen.findByRole("region", { name: "Reviews" });
    await waitFor(() => expect(within(list).getByRole("note")).toHaveTextContent("Couldn't check for new commits"));
    expect(within(list).getByRole("note")).toHaveTextContent("These Reviews may be Outdated.");
    expect(within(reviewRow(/llama3\.1:8b/)).getByText("Complete")).toBeInTheDocument();
  });

  test("when the Reviews were checked for new commits, the list says nothing about it", async () => {
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json([llama]) });
    await openPullRequest();

    const list = await screen.findByRole("region", { name: "Reviews" });
    await waitFor(() => reviewRow(/llama3\.1:8b/));
    expect(within(list).queryByRole("note")).not.toBeInTheDocument();
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

    await openFromList(/llama3\.1:8b/);

    await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "llama3.1:8b on Ollama" }));
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection", "Swallowed error"]);

    await userEvent.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: /^#7/ }));
    await openFromList(/gpt-4o/);

    await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "gpt-4o on OpenAI-compatible" }));
    expect(findingTitles(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["SQL injection"]);
    expect(window.location.hash).toBe("#/acme/shop/pull/7/reviews/review-2");
  });

  test("a Review that's started joins the list as running, and shows its Finding counts once it completes", async () => {
    const running: ReviewSummary = { ...gpt, id: llama.id, modelProvider: llama.modelProvider, model: llama.model, status: "running" };
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
    await waitFor(() => expect(within(reviewRow(/llama3\.1:8b/)).getByText("Running")).toHaveClass("dw-state-running"));
    const stream = await progress.followed();
    stream.send({ type: "review", review: { ...review, status: "running" } });

    listed = [llama];
    stream.send({ type: "complete" });

    await waitFor(() => expect(severityChips(reviewRow(/llama3\.1:8b/))).toEqual(["1 Critical", "1 Medium", "1 Low"]));
    expect(within(reviewRow(/llama3\.1:8b/)).queryByText("Running")).not.toBeInTheDocument();
  });

  test("a listed Review that completes stops being listed as running", async () => {
    const byGpt: Review = { ...review, id: "review-2", modelProvider: "OpenAI-compatible", model: "gpt-4o", findings: [review.findings[0]!] };
    let listed: ReviewSummary[] = [{ ...gpt, status: "running" }, llama];
    stubApi(review, modelListing, { [REVIEWS]: () => Response.json(listed) });
    const progress = stubProgressStream();
    await openPullRequest();
    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Running")).toBeInTheDocument());

    listed = [{ ...gpt, findingCounts: { "bad-practice": 0, "security-issue": 1 }, severityCounts: { ...gpt.severityCounts, high: 1 } }, llama];
    (await progress.followed("review-2")).send({ type: "review", review: { ...byGpt, status: "running" } }, { type: "complete" });

    await waitFor(() => expect(within(reviewRow(/gpt-4o/)).queryByText("Running")).not.toBeInTheDocument());
    expect(severityChips(reviewRow(/gpt-4o/))).toEqual(["1 High"]);
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

      await waitFor(() => expect(within(reviewRow(/gpt-4o/)).getByText("Outdated")).toHaveClass("dw-state-outdated"));
      expect(reviewRow(/gpt-4o/)).toHaveTextContent("Head is now abc1234");
      expect(within(reviewRow(/llama3\.1:8b/)).queryByText("Outdated")).not.toBeInTheDocument();
      expect(reviewRow(/llama3\.1:8b/)).not.toHaveTextContent("Head is now");
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

describe("filtering Findings and jumping to their lines", () => {
  /** Starts the Review and gives the filters above its files. */
  async function openFilters(startedReview: Review = review) {
    stubApi(startedReview);
    await startReview();
    return screen.findByRole("region", { name: "Filter Findings" });
  }

  /** What each button of one of the filters says, in order: what it filters by, then its count of Findings. */
  function filterButtons(filters: HTMLElement, filter: string) {
    return within(within(filters).getByRole("group", { name: filter }))
      .getAllByRole("button")
      .map((button) => button.textContent);
  }

  /** The new line numbers of the diff's rows that a shown Finding covers. */
  function markedLines(file: HTMLElement) {
    return codeRows(file)
      .filter((row) => row.classList.contains("diff-marked"))
      .map((row) => (row as HTMLTableRowElement).cells[1]?.textContent);
  }

  test("the filters count the Findings the Review reports of each kind and of each Severity", async () => {
    const filters = await openFilters();

    expect(filterButtons(filters, "Kind")).toEqual(["Security Issue 1", "Bad Practices 2"]);
    expect(filterButtons(filters, "Severity")).toEqual(["Critical 1", "High 0", "Medium 1", "Low 1"]);
  });

  test("the lines each shown Finding covers are marked in its file's diff", async () => {
    await openFilters();

    expect(markedLines(screen.getByRole("region", { name: "src/users.ts" }))).toEqual(["3", "5", "6"]);
    expect(markedLines(screen.getByRole("region", { name: "src/config.ts" }))).toEqual(["1", "2"]);
  });

  test("filtering by kind hides the other kind's Findings and their marks, and says what a file has hidden", async () => {
    const filters = await openFilters();
    const securityIssues = within(filters).getByRole("button", { name: /security issue/i });
    expect(securityIssues).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(securityIssues);

    expect(securityIssues).toHaveAttribute("aria-pressed", "true");
    const users = screen.getByRole("region", { name: "src/users.ts" });
    expect(findingTitles(users)).toEqual(["SQL injection"]);
    expect(markedLines(users)).toEqual(["3"]);
    const config = screen.getByRole("region", { name: "src/config.ts" });
    expect(within(config).queryByRole("article")).not.toBeInTheDocument();
    expect(markedLines(config)).toEqual([]);
    expect(config).toHaveTextContent("1 Finding hidden by the filters above.");
    expect(within(config).getByRole("table", { name: "Diff of src/config.ts" })).toBeInTheDocument();
    // The counts stay the Review's, whatever is hidden.
    expect(filterButtons(filters, "Kind")).toEqual(["Security Issue 1", "Bad Practices 2"]);

    await userEvent.click(securityIssues);

    expect(securityIssues).toHaveAttribute("aria-pressed", "false");
    expect(findingTitles(config)).toEqual(["Magic number"]);
  });

  test("filtering by Severity hides the Findings of the other Severities, and narrows the kind filter further", async () => {
    const filters = await openFilters();
    const severities = within(filters).getByRole("group", { name: "Severity" });
    const users = screen.getByRole("region", { name: "src/users.ts" });
    const config = screen.getByRole("region", { name: "src/config.ts" });

    await userEvent.click(within(severities).getByRole("button", { name: /critical/i }));
    await userEvent.click(within(severities).getByRole("button", { name: /low/i }));

    expect(within(severities).getByRole("button", { name: /critical/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(severities).getByRole("button", { name: /medium/i })).toHaveAttribute("aria-pressed", "false");
    expect(findingTitles(users)).toEqual(["SQL injection"]);
    expect(findingTitles(config)).toEqual(["Magic number"]);
    expect(filterButtons(filters, "Severity")).toEqual(["Critical 1", "High 0", "Medium 1", "Low 1"]);

    await userEvent.click(within(filters).getByRole("button", { name: /bad practice/i }));

    expect(within(users).queryByRole("article")).not.toBeInTheDocument();
    expect(users).toHaveTextContent("2 Findings hidden by the filters above.");
    expect(findingTitles(config)).toEqual(["Magic number"]);
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

    /** The new line numbers of the diff's rows highlighted as the lines jumped to. */
    function highlightedLines(file: HTMLElement) {
      return codeRows(file)
        .filter((row) => row.classList.contains("diff-highlighted"))
        .map((row) => (row as HTMLTableRowElement).cells[1]?.textContent);
    }

    test("clicking a Finding's location scrolls its diff to its lines, highlights them and focuses the first", async () => {
      const scrolledTo = stubScrolling();
      await openFilters();
      const users = screen.getByRole("region", { name: "src/users.ts" });
      const config = screen.getByRole("region", { name: "src/config.ts" });
      const swallowedError = within(users).getByRole("button", { name: "src/users.ts:5–6" });
      expect(highlightedLines(users)).toEqual([]);

      await userEvent.click(swallowedError);

      expect(scrolledTo).toEqual([newLineRow(users, 5)]);
      expect(newLineRow(users, 5)).toHaveFocus();
      expect(highlightedLines(users)).toEqual(["5", "6"]);
      expect(swallowedError).toHaveAttribute("aria-current", "true");
      expect(swallowedError.closest("article")).toHaveClass("is-shown");

      await userEvent.click(within(config).getByRole("button", { name: "src/config.ts:1–2" }));

      expect(scrolledTo).toEqual([newLineRow(users, 5), newLineRow(config, 1)]);
      expect(highlightedLines(config)).toEqual(["1", "2"]);
      expect(highlightedLines(users)).toEqual([]);
      expect(swallowedError).not.toHaveAttribute("aria-current");
    });

    test("clicking the same Finding again scrolls back to its lines", async () => {
      const scrolledTo = stubScrolling();
      await openFilters();
      const users = screen.getByRole("region", { name: "src/users.ts" });

      await userEvent.click(within(users).getByRole("button", { name: "src/users.ts:3" }));
      await userEvent.click(within(users).getByRole("button", { name: "src/users.ts:3" }));

      expect(scrolledTo).toEqual([newLineRow(users, 3), newLineRow(users, 3)]);
      expect(highlightedLines(users)).toEqual(["3"]);
    });

    test("a Finding on lines the diff doesn't show is scrolled to itself", async () => {
      const scrolledTo = stubScrolling();
      await openFilters({
        ...review,
        fileOutcomes: [{ file: "src/config.ts", outcome: "reviewed", patch: configPatch }],
        findings: [{ ...review.findings[1]!, startLine: 9, endLine: 9, title: "Past the end" }],
      });
      const config = screen.getByRole("region", { name: "src/config.ts" });

      await userEvent.click(within(config).getByRole("button", { name: "src/config.ts:9" }));

      expect(scrolledTo).toHaveLength(1);
      expect(scrolledTo[0]).toContainElement(within(config).getByRole("article"));
      expect(scrolledTo[0]).not.toContainElement(within(config).getByRole("table"));
      expect(highlightedLines(config)).toEqual([]);
    });

    test("the lines of a Finding the filters then hide are no longer highlighted", async () => {
      stubScrolling();
      const filters = await openFilters();
      const users = screen.getByRole("region", { name: "src/users.ts" });
      await userEvent.click(within(users).getByRole("button", { name: "src/users.ts:5–6" }));
      expect(highlightedLines(users)).toEqual(["5", "6"]);

      await userEvent.click(within(filters).getByRole("button", { name: /security issue/i }));

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
  expect(findingTitles(config)).toEqual(["Past the end"]);
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

test("a Review with no Findings says so, for itself and for each file", async () => {
  stubApi({ ...review, findings: [] });
  await startReview();

  await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Findings: "0" }));
  for (const file of ["src/users.ts", "src/config.ts"]) {
    expect(screen.getByRole("region", { name: file })).toHaveTextContent("No Findings in the lines this file changes.");
  }
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

  const skipped = screen.getByRole("region", { name: "Skipped files" });
  expect(within(skipped).getByText("Skipped")).toHaveClass("dw-badge-neutral");
  expect(within(skipped).getByText("Lockfile")).toBeInTheDocument();
  expect(within(skipped).queryByRole("table")).not.toBeInTheDocument();

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

/** Opens the Model menu from its button, which is named for the Model chosen now. */
async function openModelMenu(chosen: string) {
  const picker = await screen.findByRole("button", { name: `Model ${chosen}` });
  expect(picker).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(picker);
  expect(picker).toHaveAttribute("aria-expanded", "true");
  return { picker, menu: screen.getByRole("group", { name: "Choose a Model for this Review" }) };
}

/** Each Model Provider's group in the Model menu: its name, all it says, and the Models it offers. */
function menuGroups(menu: HTMLElement) {
  return within(menu)
    .getAllByRole("group")
    .map((group) => ({
      name: document.getElementById(group.getAttribute("aria-labelledby")!)!.textContent,
      text: group.textContent,
      models: within(group).queryAllByRole("button").map((model) => model.textContent),
    }));
}

test("the Model menu groups Models by Model Provider, and the Review runs on the chosen one", async () => {
  const fetch = stubApi({ ...review, modelProvider: "OpenAI-compatible", model: "gpt-4o" });
  await openPullRequest();

  const { picker, menu } = await openModelMenu("llama3.1:8b");
  expect(menuGroups(menu).map(({ name, models }) => [name, models])).toEqual([
    ["Ollama", ["llama3.1:8b", "qwen2.5-coder:7b"]],
    ["OpenAI-compatible", ["gpt-4o"]],
  ]);
  expect(within(menu).getByRole("button", { name: "llama3.1:8b" })).toHaveAttribute("aria-pressed", "true");
  expect(within(menu).getByRole("button", { name: "gpt-4o" })).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(within(menu).getByRole("button", { name: "gpt-4o" }));

  expect(menu).not.toBeInTheDocument();
  expect(picker).toHaveAccessibleName("Model gpt-4o");
  expect(picker).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Review" }));

  expect(fetch).toHaveBeenCalledWith(
    "/api/reviews",
    expect.objectContaining({
      body: JSON.stringify({ pullRequest: { owner: "acme", repo: "shop", number: 7 }, modelProvider: "OpenAI-compatible", model: "gpt-4o" }),
    }),
  );
  await waitFor(async () => expect(details(await openedReview())).toMatchObject({ Model: "gpt-4o on OpenAI-compatible" }));
});

test("Escape closes the Model menu, keeping the Model chosen", async () => {
  stubApi();
  await openPullRequest();

  const { picker, menu } = await openModelMenu("llama3.1:8b");
  await userEvent.keyboard("{Escape}");

  expect(menu).not.toBeInTheDocument();
  expect(picker).toHaveAccessibleName("Model llama3.1:8b");
  expect(picker).toHaveFocus();
});

test("an unavailable Model Provider is shown in the Model menu with its reason, and the others' Models can still be chosen", async () => {
  stubApi(review, [
    { modelProvider: "Ollama", status: "unavailable", reason: "Could not reach http://localhost:11434/v1: ECONNREFUSED" },
    { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
  ]);
  await openPullRequest();

  const { menu } = await openModelMenu("gpt-4o");
  const [ollama, openAI] = menuGroups(menu);
  expect(ollama).toMatchObject({ name: "Ollama", models: [] });
  expect(ollama!.text).toMatch(/Unavailable.*ECONNREFUSED/);
  expect(openAI).toMatchObject({ name: "OpenAI-compatible", models: ["gpt-4o"] });
  expect(openAI!.text).toMatch(/Connected/);
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
  expect(screen.queryByRole("button", { name: /^Model/ })).not.toBeInTheDocument();
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

  test("once the GitHub App is created, the Repositories offer to install it on more", async () => {
    stubApi();
    render(<App />);

    const repositories = await screen.findByRole("region", { name: "Repositories" });
    const link = await within(repositories).findByRole("link", { name: "Install on more Repositories" });
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

    await userEvent.type(await screen.findByRole("textbox", { name: "Paste a Pull Request URL" }), url);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    const detail = await screen.findByRole("region", { name: "Add user lookup" });
    expect(details(detail)).toMatchObject({ Author: "octocat", "Head commit": "abc1234" });
    expect(changedFiles(detail)).toHaveLength(2);
    expect(window.location.hash).toBe("#/acme/shop/pull/7");
    expect(within(detail).getByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/reviews", expect.anything());
  });

  /** Pastes `pasted` and opens it, then waits for the error it's shown under the field. */
  async function pasteAndFail(pasted: string) {
    const field = await screen.findByRole("textbox", { name: "Paste a Pull Request URL" });
    await userEvent.type(field, pasted);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const error = await screen.findByRole("alert");
    return { field, error };
  }

  test("pasting something that isn't a GitHub Pull Request URL shows why under the field, and stays on Home", async () => {
    const error = `"nope" isn't a GitHub Pull Request URL. Paste one like https://github.com/owner/repo/pull/123`;
    stubApi(review, modelListing, { [byUrl("nope")]: () => Response.json({ error }, { status: 400 }) });
    render(<App />);

    const { field, error: shown } = await pasteAndFail("nope");

    expect(shown).toHaveTextContent(error);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(error);
    expect(within(shown).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "acme/shop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });

  test("pasting a URL in a Repository the GitHub App isn't installed on says so under the field, with where to install it", async () => {
    const error = "The GitHub App diffwise-a1b2c3 isn't installed on acme/shop. Install it there, then try again.";
    stubApi(review, modelListing, { [byUrl(url)]: () => Response.json({ error }, { status: 403 }) });
    render(<App />);

    const { field, error: shown } = await pasteAndFail(url);

    expect(shown).toHaveTextContent(error);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(within(shown).getByRole("link", { name: "Install on more Repositories" })).toHaveAttribute(
      "href",
      createdGitHubApp.installUrl,
    );
  });

  test("editing the URL after an error stops marking the field invalid", async () => {
    stubApi(review, modelListing, { [byUrl("nope")]: () => Response.json({ error: "Not a URL" }, { status: 400 }) });
    render(<App />);
    const { field } = await pasteAndFail("nope");

    await userEvent.type(field, "!");

    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Home's Repositories", () => {
  test("each links to its page, the built-in fixture says it works without GitHub, and none has counts", async () => {
    stubApi(review, modelListing, {
      "/api/repositories": () =>
        Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }, { owner: "acme", repo: "shop" }] }),
    });
    render(<App />);

    const repositories = await screen.findByRole("region", { name: "Repositories" });
    const rows = await within(repositories).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "diffwise-fixtures/bookshopBuilt-in fixture. Works without GitHub.",
      "acme/shop",
    ]);
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute("href", "#/acme/shop");
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "#/diffwise-fixtures/bookshop");
    expect(within(repositories).getByText("2 listed")).toBeInTheDocument();
  });

});

describe("Home's recent Reviews", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const noSeverities = { low: 0, medium: 0, high: 0, critical: 0 };
  const recentReview: RecentReview = {
    id: "complete-1",
    pullRequest: { owner: "acme", repo: "shop", number: 7 },
    pullRequestTitle: "Add user lookup",
    modelProvider: "Ollama",
    model: "llama3.1:8b",
    headCommit: "abc1234def",
    createdAt: minutesAgo(120),
    status: "complete",
    findingCounts: { "bad-practice": 1, "security-issue": 2 },
    severityCounts: { ...noSeverities, critical: 2, low: 1 },
  };

  async function recentReviewRows(recent: RecentReview[]) {
    stubApi(review, modelListing, { "/api/reviews": () => Response.json(recent) });
    render(<App />);
    const list = await screen.findByRole("region", { name: "Recent Reviews" });
    return within(list).findAllByRole("listitem");
  }

  test("each leads to its Review, naming its Pull Request, when it started, its Model, commit and Findings by Severity", async () => {
    const [row] = await recentReviewRows([recentReview]);

    expect(within(row!).getByRole("link", { name: "Add user lookup" })).toHaveAttribute("href", "#/acme/shop/pull/7/reviews/complete-1");
    expect(row).toHaveTextContent("acme/shop #7 · Started 2 hours ago");
    expect(within(row!).getByRole("time")).toHaveAttribute("datetime", recentReview.createdAt);
    expect(row).toHaveTextContent("llama3.1:8bOllama");
    expect(within(row!).getByTitle("abc1234def")).toHaveTextContent("abc1234");
    expect(severityChips(row!)).toEqual(["2 Critical", "1 Low"]);
    expect(within(row!).getByText("Complete")).toHaveClass("dw-state-complete");
  });

  test("a Review saved before Pull Request titles were kept is named by its number", async () => {
    const { pullRequestTitle, ...untitled } = recentReview;
    const [row] = await recentReviewRows([untitled]);

    expect(within(row!).getByRole("link", { name: "#7" })).toHaveAttribute("href", "#/acme/shop/pull/7/reviews/complete-1");
  });

  test("a complete Review without Findings says so", async () => {
    const [row] = await recentReviewRows([{ ...recentReview, findingCounts: { "bad-practice": 0, "security-issue": 0 }, severityCounts: noSeverities }]);

    expect(row).toHaveTextContent("No Findings");
  });

  test("a running Review shows how many of its files are done, as a bar too, and that a restart loses it", async () => {
    const [row] = await recentReviewRows([
      {
        ...recentReview,
        status: "running",
        createdAt: minutesAgo(2),
        findingCounts: { "bad-practice": 0, "security-issue": 0 },
        severityCounts: noSeverities,
        progress: { settled: 1, total: 3 },
      },
    ]);

    expect(within(row!).getByText("Running")).toHaveClass("dw-state-running");
    const bar = within(row!).getByRole("progressbar", { name: "Review progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(row).toHaveTextContent("1 of 3 files. Lost if Diffwise restarts.");
    expect(row).toHaveTextContent("Started 2 minutes ago");
    expect(row).not.toHaveTextContent("No Findings");
  });

  test("an Unsaved Review says a restart loses it", async () => {
    const [row] = await recentReviewRows([{ ...recentReview, status: "unsaved" }]);

    expect(within(row!).getByText("Unsaved")).toHaveClass("dw-state-unsaved");
    expect(row).toHaveTextContent("Lost if Diffwise restarts");
    expect(within(row!).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  test("are listed in the order given, newest first", async () => {
    const rows = await recentReviewRows([
      { ...recentReview, id: "newer", pullRequestTitle: "Newer" },
      { ...recentReview, id: "older", pullRequestTitle: "Older" },
    ]);

    expect(rows.map((row) => within(row).getAllByRole("link")[0]!.textContent)).toEqual(["Newer", "Older"]);
  });

  test("with no Reviews yet, says so", async () => {
    stubApi();
    render(<App />);

    const list = await screen.findByRole("region", { name: "Recent Reviews" });
    expect(await within(list).findByText(/No Reviews yet/)).toBeInTheDocument();
  });
});

describe("Home before there's anything to show", () => {
  const notCreated = { "/api/github-app": () => Response.json({ status: "not-created" }) };
  const fixtureOnly = { "/api/repositories": () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }] }) };

  describe("on first run, with no GitHub App created", () => {
    test("says why to connect GitHub, offers to create the App, and lists what happens next", async () => {
      stubApi(review, modelListing, notCreated);
      render(<App />);

      expect(await screen.findByRole("heading", { name: "Connect GitHub to review Pull Requests" })).toBeInTheDocument();
      const create = screen.getByRole("button", { name: "Create GitHub App" });
      expect(create).toHaveClass("dw-btn-primary");
      expect(create.closest("form")).toHaveAttribute("action", "/api/github-app/new");
      const steps = within(screen.getByRole("region", { name: "What happens next" })).getAllByRole("listitem");
      expect(steps.map((step) => within(step).getByRole("heading").textContent)).toEqual([
        "Create GitHub App",
        "Install on Repositories",
        "Review a Pull Request",
      ]);
      expect(screen.queryByRole("textbox", { name: "Paste a Pull Request URL" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Recent Reviews" })).not.toBeInTheDocument();
    });

    test("lists each Model Provider's status, with an unavailable one's reason", async () => {
      const reason = "Couldn't reach https://llm.example/v1: connection refused.";
      stubApi(
        review,
        [
          { modelProvider: "Ollama", status: "available", models: ["llama3.1:8b", "qwen2.5-coder:7b"] },
          { modelProvider: "OpenAI-compatible", status: "unavailable", reason },
        ],
        notCreated,
      );
      render(<App />);

      const card = await screen.findByRole("region", { name: "Model Providers" });
      const [ollama, openai] = await within(card).findAllByRole("listitem");
      expect(ollama).toHaveTextContent("OllamaConnected2 Models available");
      expect(openai).toHaveTextContent(`OpenAI-compatibleUnavailable${reason}`);
    });

    test("skipping opens the fixture Pull Request, with no GitHub App", async () => {
      const fixturePullRequest = { ...pullRequestDetail, owner: "diffwise-fixtures", repo: "bookshop", number: 1, title: "Add search" };
      stubApi(review, modelListing, {
        ...notCreated,
        "/api/repositories/diffwise-fixtures/bookshop/pull-requests/1": () => Response.json(fixturePullRequest),
        "/api/repositories/diffwise-fixtures/bookshop/pull-requests/1/reviews": () => Response.json([]),
      });
      render(<App />);

      const skip = await screen.findByRole("link", { name: "Skip and try the fixture Pull Request" });
      expect(skip).toHaveClass("dw-btn-secondary");
      await userEvent.click(skip);

      expect(window.location.hash).toBe("#/diffwise-fixtures/bookshop/pull/1");
      expect(await screen.findByRole("heading", { name: "Add search" })).toBeInTheDocument();
    });
  });

  describe("with the GitHub App installed nowhere", () => {
    test("lists the fixture, then offers to install the App on Repositories", async () => {
      stubApi(review, modelListing, fixtureOnly);
      render(<App />);

      const repositories = await screen.findByRole("region", { name: "Repositories" });
      expect(await within(repositories).findByText("No installed Repositories yet")).toBeInTheDocument();
      expect(within(repositories).getByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
      const install = within(repositories).getByRole("link", { name: "Install on Repositories" });
      expect(install).toHaveAttribute("href", createdGitHubApp.installUrl);
      expect(install).toHaveClass("dw-btn-primary");
      expect(within(repositories).queryByRole("link", { name: "Install on more Repositories" })).not.toBeInTheDocument();
    });

    test("Recent Reviews says what will appear there", async () => {
      stubApi(review, modelListing, fixtureOnly);
      render(<App />);

      const recent = await screen.findByRole("region", { name: "Recent Reviews" });
      expect(await within(recent).findByText("No Reviews yet")).toBeInTheDocument();
      expect(recent).toHaveTextContent("Each Review you run appears here");
    });

    test("the URL field can still be used, and says only installed Repositories' Pull Requests open", async () => {
      stubApi(review, modelListing, fixtureOnly);
      render(<App />);
      await screen.findByText("No installed Repositories yet");

      const field = screen.getByRole("textbox", { name: "Paste a Pull Request URL" });
      await waitFor(() => expect(field).toBeEnabled());
      expect(field).toHaveAccessibleDescription(
        "Only Pull Requests from installed Repositories open. Until you install one, try diffwise-fixtures/bookshop.",
      );
    });

    test("with Repositories installed, there's no such hint", async () => {
      stubApi();
      render(<App />);
      await screen.findByRole("link", { name: "acme/shop" });

      expect(screen.getByRole("textbox", { name: "Paste a Pull Request URL" })).not.toHaveAccessibleDescription();
      expect(screen.queryByText("No installed Repositories yet")).not.toBeInTheDocument();
    });
  });

  describe("while loading", () => {
    function renderLoading() {
      const fetch = stubApi();
      fetch.mockImplementation(() => new Promise<Response>(() => {}));
      render(<App />);
    }

    test("the page is busy and says what it's loading, and the URL field can't be used yet", async () => {
      renderLoading();

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent("Loading Repositories and Reviews…");
      expect(status.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("textbox", { name: "Paste a Pull Request URL" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
      expect(await connections()).toEqual(["Checking GitHub", "Checking Model Providers"]);
    });

    test("both cards show skeleton rows, the Repositories after the fixture", async () => {
      renderLoading();

      const repositories = await screen.findByRole("region", { name: "Repositories" });
      expect(within(repositories).getByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
      expect(repositories.querySelectorAll(".dw-skel").length).toBeGreaterThan(0);
      const recent = screen.getByRole("region", { name: "Recent Reviews" });
      expect(recent.querySelectorAll(".dw-skel").length).toBeGreaterThan(0);
      expect(screen.queryByText("No installed Repositories yet")).not.toBeInTheDocument();
      expect(screen.queryByText("No Reviews yet")).not.toBeInTheDocument();
    });

    test("once loaded, the page isn't busy and the skeletons are gone", async () => {
      stubApi();
      render(<App />);
      await screen.findByRole("link", { name: "acme/shop" });
      await screen.findByText("No Reviews yet");

      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      expect(document.querySelector("[aria-busy='true']")).not.toBeInTheDocument();
      expect(document.querySelectorAll(".dw-skel")).toHaveLength(0);
      expect(screen.getByRole("textbox", { name: "Paste a Pull Request URL" })).toBeEnabled();
    });
  });

  describe("when something couldn't be loaded", () => {
    const unlisted = "GitHub replied 401 when listing the GitHub App's installations: Bad credentials";

    test("the Repositories still list the fixture, then say why the installed ones couldn't be loaded", async () => {
      stubApi(review, modelListing, {
        "/api/repositories": () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }], unlisted }),
      });
      render(<App />);

      const repositories = await screen.findByRole("region", { name: "Repositories" });
      const alert = await within(repositories).findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load installed Repositories");
      expect(alert).toHaveTextContent(unlisted);
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(within(repositories).getByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
      expect(within(repositories).queryByText("No installed Repositories yet")).not.toBeInTheDocument();
      expect(within(repositories).queryByText(/listed$/)).not.toBeInTheDocument();
    });

    test("when only some installed Repositories couldn't be loaded, the rest are listed and the card says some are missing", async () => {
      stubApi(review, modelListing, {
        "/api/repositories": () =>
          Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }, { owner: "acme", repo: "shop" }], unlisted }),
      });
      render(<App />);

      const repositories = await screen.findByRole("region", { name: "Repositories" });
      expect(await within(repositories).findByRole("alert")).toHaveTextContent("Couldn't load some installed Repositories");
      expect(within(repositories).getByRole("link", { name: "acme/shop" })).toBeInTheDocument();
    });

    test("when the GitHub App's status couldn't be loaded, Home says why and doesn't claim the App is installed nowhere", async () => {
      stubApi(review, modelListing, {
        ...fixtureOnly,
        "/api/github-app": () => Response.json({ error: "Couldn't read the GitHub App's credentials" }, { status: 500 }),
      });
      render(<App />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read the GitHub App's credentials");
      await screen.findByText("No Reviews yet");
      expect(screen.queryByText("No installed Repositories yet")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Paste a Pull Request URL" })).not.toHaveAccessibleDescription();
    });

    test("the fixture is listed even when the Repositories couldn't be asked for at all", async () => {
      stubApi(review, modelListing, { "/api/repositories": () => Response.json({ error: "Diffwise isn't running" }, { status: 502 }) });
      render(<App />);

      const repositories = await screen.findByRole("region", { name: "Repositories" });
      const alert = await within(repositories).findByRole("alert");
      expect(alert).toHaveTextContent("Diffwise isn't running");
      expect(within(repositories).getByRole("link", { name: "diffwise-fixtures/bookshop" })).toBeInTheDocument();
    });

    test("the Reviews say they couldn't be loaded, and where to look", async () => {
      stubApi(review, modelListing, { "/api/reviews": () => Response.json({ error: "database is locked" }, { status: 500 }) });
      render(<App />);

      const recent = await screen.findByRole("region", { name: "Recent Reviews" });
      const alert = await within(recent).findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load Reviews");
      expect(alert).toHaveTextContent("Check that the SQLite database file exists and that Diffwise has permission to read it");
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });

    test("trying the Repositories again asks for only them again", async () => {
      let answer = () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }], unlisted });
      const fetch = stubApi(review, modelListing, { "/api/repositories": () => answer() });
      render(<App />);
      const repositories = await screen.findByRole("region", { name: "Repositories" });
      const tryAgain = await within(repositories).findByRole("button", { name: "Try again" });
      await screen.findByText("No Reviews yet");
      const before = fetch.mock.calls.length;

      answer = () => Response.json({ repositories: [{ owner: "diffwise-fixtures", repo: "bookshop" }, { owner: "acme", repo: "shop" }] });
      await userEvent.click(tryAgain);

      expect(await within(repositories).findByRole("link", { name: "acme/shop" })).toBeInTheDocument();
      expect(within(repositories).queryByRole("alert")).not.toBeInTheDocument();
      expect(fetch.mock.calls.slice(before).map(([url]) => url)).toEqual(["/api/repositories"]);
    });

    test("trying the Reviews again asks for only them again", async () => {
      let answer = () => Response.json({ error: "database is locked" }, { status: 500 });
      const fetch = stubApi(review, modelListing, { "/api/reviews": () => answer() });
      render(<App />);
      const recent = await screen.findByRole("region", { name: "Recent Reviews" });
      const tryAgain = await within(recent).findByRole("button", { name: "Try again" });
      await screen.findByRole("link", { name: "acme/shop" });
      const before = fetch.mock.calls.length;

      answer = () => Response.json([]);
      await userEvent.click(tryAgain);

      expect(await within(recent).findByText("No Reviews yet")).toBeInTheDocument();
      expect(within(recent).queryByRole("alert")).not.toBeInTheDocument();
      expect(fetch.mock.calls.slice(before).map(([url]) => url)).toEqual(["/api/reviews"]);
    });
  });
});
