import { describe, expect, test, vi } from "vitest";
import type { ReviewEvent } from "@diffwise/shared";
import { openDatabase } from "../src/db.ts";
import type { PullRequestSnapshot } from "../src/forge.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import { createReviews } from "../src/reviews.ts";
import { fakeModelProvider, held } from "./fakes.ts";
import { completedReview, followReview, startReview } from "./reviewing.ts";

const usersPatch = [
  "@@ -1,2 +1,4 @@",
  " import { db } from './db';",
  "+export function findUser(name: string) {",
  "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
  "+}",
].join("\n");

const configPatch = "@@ -0,0 +1 @@\n+export const retries = 3;";

/** Changes a file that will be reviewed, one on the skip list, and one more for the Model. */
const pullRequest: PullRequestSnapshot = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [
    { path: "src/users.ts", patch: usersPatch },
    { path: "package-lock.json", patch: '@@ -1 +1 @@\n-"a"\n+"b"' },
    { path: "src/config.ts", patch: configPatch },
  ],
};

const sqlInjection = {
  kind: "security-issue",
  severity: "critical",
  startLine: 3,
  endLine: 3,
  title: "SQL injection",
  explanation: "The name is interpolated straight into the SQL string.",
};

const magicNumber = {
  kind: "bad-practice",
  severity: "low",
  startLine: 1,
  endLine: 1,
  title: "Magic number",
  explanation: "The retry count should be configurable.",
};

const usersReviewed = { file: "src/users.ts", outcome: "reviewed", patch: usersPatch };
const lockfileSkipped = { file: "package-lock.json", outcome: "skipped", reason: expect.stringMatching(/lockfile/i) };
const configReviewed = { file: "src/config.ts", outcome: "reviewed", patch: configPatch };

function setup(modelResponses: unknown[], db = openDatabase(":memory:")) {
  const modelProvider = fakeModelProvider(modelResponses);
  return createReviews({ forge: fixtureForge([pullRequest]), modelProviders: [modelProvider.provider], db });
}

describe("Live progress while a Review runs", () => {
  test("starting a Review returns right away with its id, and the Review runs on the backend", async () => {
    const users = held({ findings: [sqlInjection] });
    const reviews = setup([users, { findings: [] }]);

    const running = await startReview(reviews, pullRequest);

    expect(running).toMatchObject({
      id: expect.any(String),
      status: "running",
      fileOutcomes: [],
      pendingFiles: [
        { file: "src/users.ts", state: "reviewing" },
        { file: "package-lock.json", state: "queued" },
        { file: "src/config.ts", state: "queued" },
      ],
      findings: [],
    });
    expect(reviews.get(running.id)).toEqual(running);

    users.release();
    await followReview(reviews, running.id).rest();

    expect(reviews.get(running.id)).toEqual({
      ...running,
      status: "complete",
      fileOutcomes: [usersReviewed, lockfileSkipped, configReviewed],
      pendingFiles: [],
      findings: [{ ...sqlInjection, file: "src/users.ts" }],
    });
  });

  test("following a Review sends each file's changes of state, and its Findings as it finishes, ending with completion", async () => {
    const users = held({ findings: [sqlInjection] });
    const reviews = setup([users, "not JSON", "still not JSON"]);
    const running = await startReview(reviews, pullRequest);

    const stream = followReview(reviews, running.id);

    expect(await stream.next()).toEqual<ReviewEvent>({ type: "review", review: running });

    users.release();

    expect(await stream.rest()).toEqual([
      { type: "file-settled", fileOutcome: usersReviewed, findings: [{ ...sqlInjection, file: "src/users.ts" }] },
      { type: "file-settled", fileOutcome: lockfileSkipped, findings: [] },
      { type: "file-reviewing", file: "src/config.ts" },
      {
        type: "file-settled",
        fileOutcome: { file: "src/config.ts", outcome: "failed", reason: expect.stringMatching(/JSON/) },
        findings: [],
      },
      { type: "complete" },
    ]);
  });

  test("following a Review mid-run first sends the Review as it stands, then continues live", async () => {
    const users = held({ findings: [sqlInjection] });
    const config = held({ findings: [magicNumber] });
    const reviews = setup([users, config]);
    const { id } = await startReview(reviews, pullRequest);
    const first = followReview(reviews, id);
    users.release();
    // The first follower has seen the Review reach its last file.
    for (let event = await first.next(); event?.type !== "file-reviewing"; event = await first.next());

    const second = followReview(reviews, id);

    expect(await second.next()).toEqual({
      type: "review",
      review: expect.objectContaining({
        id,
        status: "running",
        fileOutcomes: [usersReviewed, lockfileSkipped],
        pendingFiles: [{ file: "src/config.ts", state: "reviewing" }],
        findings: [{ ...sqlInjection, file: "src/users.ts" }],
      }),
    });

    config.release();

    const live = [
      { type: "file-settled", fileOutcome: configReviewed, findings: [{ ...magicNumber, file: "src/config.ts" }] },
      { type: "complete" },
    ];
    expect(await second.rest()).toEqual(live);
    expect(await first.rest()).toEqual(live);
  });

  test("a Review keeps running after its follower stops following it", async () => {
    const users = held({ findings: [sqlInjection] });
    const reviews = setup([users, { findings: [magicNumber] }]);
    const { id } = await startReview(reviews, pullRequest);
    const stream = followReview(reviews, id);
    await stream.next();

    stream.disconnect();
    expect(await stream.next()).toBeUndefined();
    users.release();

    const reconnected = followReview(reviews, id);
    const events = [await reconnected.next(), ...(await reconnected.rest())];
    expect(events[0]).toEqual({ type: "review", review: expect.objectContaining({ id }) });
    expect(events.at(-1)).toEqual({ type: "complete" });
    expect(reviews.get(id)).toMatchObject({
      status: "complete",
      fileOutcomes: [usersReviewed, lockfileSkipped, configReviewed],
      findings: [
        { ...sqlInjection, file: "src/users.ts" },
        { ...magicNumber, file: "src/config.ts" },
      ],
    });
  });

  test("a complete Review is saved, and following it sends it, then completion", async () => {
    const db = openDatabase(":memory:");
    const review = await completedReview(setup([{ findings: [sqlInjection] }, { findings: [] }], db), pullRequest);
    // Diffwise restarted: nothing is running, and the Review comes from the database.
    const restarted = setup([], db);

    await vi.waitFor(() => expect(restarted.get(review.id)).toEqual(review));
    expect(await followReview(restarted, review.id).rest()).toEqual([{ type: "review", review }, { type: "complete" }]);
  });
});
