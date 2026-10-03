import { afterEach, describe, expect, test, vi } from "vitest";
import type { Review } from "@diffwise/shared";
import { openDatabase } from "../src/db.ts";
import { ForgeAccessError, type Forge, type PullRequestSnapshot } from "../src/forge.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import { createReviews, type Reviews } from "../src/reviews.ts";
import { fakeForge, fakeModelProvider, held } from "./fakes.ts";

const usersPatch = [
  "@@ -1,2 +1,4 @@",
  " import { db } from './db';",
  "+export function findUser(name: string) {",
  "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
  "+}",
].join("\n");

const pullRequest: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [{ path: "src/users.ts", patch: usersPatch }],
};

const sqlInjection = {
  kind: "security-issue",
  severity: "critical",
  startLine: 3,
  endLine: 3,
  title: "SQL injection",
  explanation: "The name is interpolated straight into the SQL string.",
};

const modelChoice = { modelProvider: "Ollama", model: "test-model" };

function setup(
  modelResponses: unknown[],
  { pullRequests = [pullRequest], db = openDatabase(":memory:"), forge = fixtureForge(pullRequests) as Forge } = {},
) {
  const reviews = createReviews({
    forge,
    modelProviders: [fakeModelProvider(modelResponses).provider],
    db,
  });
  return { reviews, db };
}

async function start(reviews: Reviews, of: PullRequestSnapshot = pullRequest): Promise<Review> {
  const outcome = await reviews.start(of, modelChoice);
  if (!outcome.started) throw new Error(`The Review didn't start: no ${outcome.missing}`);
  return outcome.review;
}

/** Follows the Review to its completion, giving up after a second so a Review that never completes fails its test. */
async function completion(reviews: Reviews, id: string): Promise<void> {
  for await (const _ of reviews.follow(id, AbortSignal.timeout(1000))!);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("The Reviews module", () => {
  test("a changed file Diffwise can't handle fails that file, and the Review still completes and is saved", async () => {
    // No Forge sends a file without a patch: this stands for whatever could go wrong before the Model is asked.
    const broken = { path: "src/broken.ts", patch: undefined as unknown as string };
    const { reviews, db } = setup([{ findings: [sqlInjection] }], {
      pullRequests: [{ ...pullRequest, files: [broken, ...pullRequest.files] }],
    });

    const { id } = await start(reviews);
    await completion(reviews, id);

    const review = reviews.get(id);
    expect(review).toMatchObject({
      status: "complete",
      fileOutcomes: [
        { file: "src/broken.ts", outcome: "failed", reason: expect.stringMatching(/couldn't review it/) },
        { file: "src/users.ts", outcome: "reviewed" },
      ],
      pendingFiles: [],
      findings: [{ title: "SQL injection", file: "src/users.ts" }],
    });
    // Diffwise restarted: the Review comes from the database.
    expect(setup([], { db }).reviews.get(id)).toEqual(review);
  });

  test("a complete Review that can't be saved can still be read and is listed, until Diffwise restarts", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reviews, db } = setup([{ findings: [sqlInjection] }]);
    db.exec("CREATE TRIGGER disk_full BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    const { id } = await start(reviews);
    await completion(reviews, id);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error)));

    expect(reviews.get(id)).toMatchObject({ status: "complete", findings: [{ title: "SQL injection" }] });
    expect(await reviews.list(pullRequest)).toMatchObject([{ id, status: "complete" }]);
    const events = [];
    for await (const event of reviews.follow(id)!) events.push(event.type);
    expect(events).toEqual(["review", "complete"]);
    // Diffwise restarted: it was never saved, so it's lost.
    expect(setup([], { db }).reviews.get(id)).toBeUndefined();
  });

  test("a running Review and a saved one are listed alike, newest first", async () => {
    const second = held({ findings: [] });
    const { reviews } = setup([{ findings: [sqlInjection] }, second]);
    const saved = await start(reviews);
    await completion(reviews, saved.id);
    await vi.waitFor(() => expect(reviews.follow(saved.id)).toBeInstanceOf(Array));

    const running = await start(reviews);

    const listed = (await reviews.list(pullRequest))!;
    expect(listed).toMatchObject([
      { id: running.id, status: "running", findingCounts: { "bad-practice": 0, "security-issue": 0 } },
      { id: saved.id, status: "complete", findingCounts: { "bad-practice": 0, "security-issue": 1 } },
    ]);
    expect(Object.keys(listed[0]!).sort()).toEqual(Object.keys(listed[1]!).sort());

    second.release();
    await completion(reviews, running.id);
  });

  test("listing a Pull Request's Reviews doesn't read its changed files", async () => {
    const { reviews, db } = setup([{ findings: [sqlInjection] }]);
    const saved = await start(reviews);
    await completion(reviews, saved.id);
    await vi.waitFor(() => expect(reviews.follow(saved.id)).toBeInstanceOf(Array));
    const forge: Forge = {
      ...fixtureForge([{ ...pullRequest, headCommit: "def5678" }]),
      getPullRequest: async () => {
        throw new Error("listing Reviews shouldn't read the Pull Request's changed files");
      },
    };

    const listed = await setup([], { db, forge }).reviews.list(pullRequest);

    expect(listed).toMatchObject([{ id: saved.id, headCommit: "abc1234", outdated: true }]);
  });

  test("the Reviews of a Pull Request that doesn't exist are undefined", async () => {
    const { reviews } = setup([]);

    expect(await reviews.list({ ...pullRequest, number: 8 })).toBeUndefined();
  });

  test("listing the Reviews of a Pull Request in a Repository the GitHub App isn't installed on throws a ForgeAccessError", async () => {
    const { reviews } = setup([], { forge: fakeForge([pullRequest], { notInstalledOn: ["acme/shop"] }) });

    await expect(reviews.list(pullRequest)).rejects.toThrow(ForgeAccessError);
  });
});
