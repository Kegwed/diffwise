import { describe, expect, test, vi } from "vitest";
import type { ReviewEvent } from "@diffwise/shared";
import type { PullRequestSnapshot } from "../src/forge.ts";
import { held } from "./fakes.ts";
import { completedReview, followReview, pullRequest as oneFile, setupReviews, sqlInjection, startReview, usersPatch } from "./reviewing.ts";

const configPatch = "@@ -0,0 +1 @@\n+export const retries = 3;";

/** Changes a file that will be reviewed, one on the skip list, and one more for the Model. */
const pullRequest: PullRequestSnapshot = {
  ...oneFile,
  files: [
    { path: "src/users.ts", patch: usersPatch },
    { path: "package-lock.json", patch: '@@ -1 +1 @@\n-"a"\n+"b"' },
    { path: "src/config.ts", patch: configPatch },
  ],
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

function setup(modelResponses: unknown[]) {
  return setupReviews(modelResponses, { pullRequests: [pullRequest] });
}

describe("Live progress while a Review runs", () => {
  test("starting a Review returns right away with its id, and the Review runs on the backend", async () => {
    const users = held({ findings: [sqlInjection] });
    const { reviews } = setup([users, { findings: [] }]);

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
    const { reviews } = setup([users, "not JSON", "still not JSON"]);
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
    const { reviews } = setup([users, config]);
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
    const { reviews } = setup([users, { findings: [magicNumber] }]);
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

});

describe("Saving a complete Review", () => {
  test("a complete Review is saved, and following it sends it, then completion", async () => {
    const { reviews, restart } = setup([{ findings: [sqlInjection] }, { findings: [] }]);
    const review = await completedReview(reviews, pullRequest);

    const restarted = restart();

    expect(restarted.get(review.id)).toEqual(review);
    expect(await followReview(restarted, review.id).rest()).toEqual([{ type: "review", review }, { type: "complete" }]);
  });

  test("a Review is saved by the time its followers see it complete", async () => {
    expect.assertions(2);
    const { reviews, restart } = setup([{ findings: [sqlInjection] }, { findings: [] }]);
    const { id } = await startReview(reviews, pullRequest);

    for await (const event of reviews.follow(id, AbortSignal.timeout(1000))!) {
      if (event.type !== "complete") continue;
      // Diffwise restarted the moment the Review completed: it comes from the database.
      const restarted = restart();
      expect(restarted.get(id)).toMatchObject({ status: "complete", findings: [{ title: "SQL injection" }] });
      expect(await restarted.list(pullRequest)).toMatchObject([{ id, status: "complete" }]);
    }
  });

  test("following a saved Review gives its progress as following a running one does: asynchronously", async () => {
    const { reviews, restart } = setup([{ findings: [sqlInjection] }, { findings: [] }]);
    const { id } = await completedReview(reviews, pullRequest);

    const followed = restart().follow(id)!;

    expect(Symbol.asyncIterator in followed).toBe(true);
  });

  test("a complete Review that can't be saved can still be read and is listed, until Diffwise restarts", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reviews, db, restart } = setup([{ findings: [sqlInjection] }, { findings: [] }]);
    db.exec("CREATE TRIGGER disk_full BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    const { id } = await completedReview(reviews, pullRequest);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error)));

    expect(reviews.get(id)).toMatchObject({ status: "complete", findings: [{ title: "SQL injection" }] });
    expect(await reviews.list(pullRequest)).toMatchObject([{ id, status: "complete" }]);
    expect((await followReview(reviews, id).rest()).map((event) => event.type)).toEqual(["review", "complete"]);
    expect(restart().get(id)).toBeUndefined();
    logged.mockRestore();
  });
});
