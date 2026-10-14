import type { ModelChoice, PullRequestRef, Review, ReviewEvent } from "@diffwise/shared";
import { openDatabase, type Database } from "../src/db.ts";
import { fixtureForge, type FixturePullRequest } from "../src/fixture-forge.ts";
import type { Forge } from "../src/forge.ts";
import type { ModelProvider } from "../src/model-provider.ts";
import { createReviews, type Reviews } from "../src/reviews.ts";
import { fakeModelProvider, type FakeModelProviderOptions } from "./fakes.ts";

export const usersPatch = [
  "@@ -1,2 +1,4 @@",
  " import { db } from './db';",
  "+export function findUser(name: string) {",
  "+  return db.query(`SELECT * FROM users WHERE name = '${name}'`);",
  "+}",
].join("\n");

/** A Pull Request that changes one file, adding a SQL injection on line 3. */
export const pullRequest: FixturePullRequest = {
  owner: "acme",
  repo: "shop",
  number: 7,
  title: "Add user lookup",
  author: "octocat",
  headCommit: "abc1234",
  description: "Adds an endpoint to look users up by name.",
  files: [{ path: "src/users.ts", patch: usersPatch }],
};

/** The Finding a Model should report in `pullRequest`, as the Model replies with it. */
export const sqlInjection = {
  kind: "security-issue",
  severity: "critical",
  startLine: 3,
  endLine: 3,
  title: "SQL injection",
  explanation: "The name is interpolated straight into the SQL string.",
  suggestedFix: "return db.query('SELECT * FROM users WHERE name = ?', [name]);",
  securityReference: "CWE-89",
};

export interface ReviewsSetup {
  /** The Pull Requests the fixture Forge serves; `pullRequest` unless given. */
  pullRequests?: FixturePullRequest[];
  /** The Forge, in place of a fixture Forge serving `pullRequests`. */
  forge?: Forge;
  /** The Model Providers, in place of one fake "Ollama" answering with `modelResponses`. */
  modelProviders?: ModelProvider[];
  /** The Models the fake Model Provider lists. */
  models?: FakeModelProviderOptions["models"];
  db?: Database;
  modelCallTimeoutMs?: number;
}

/**
 * Diffwise's Reviews over an in-memory database, with a fake Model Provider answering each Model call with the next of
 * `modelResponses` (see fakeModelProvider). `restart()` gives the Reviews of Diffwise restarted on the same database.
 */
export function setupReviews(
  modelResponses: unknown[] = [],
  { pullRequests = [pullRequest], forge = fixtureForge(pullRequests), modelProviders, models, db = openDatabase(":memory:"), modelCallTimeoutMs }: ReviewsSetup = {},
) {
  const modelProvider = fakeModelProvider(modelResponses, { models });
  const reviews = createReviews({ forge, modelProviders: modelProviders ?? [modelProvider.provider], db, modelCallTimeoutMs });
  const restart = () => createReviews({ forge, modelProviders: [], db });
  return { reviews, db, modelRequests: modelProvider.requests, restart };
}

/** Starts a Review, failing the test if it doesn't start; resolves with the Review as it stands once started. */
export async function startReview(
  reviews: Reviews,
  pr: PullRequestRef,
  { modelProvider = "Ollama", model = "test-model" }: Partial<ModelChoice> = {},
): Promise<Review> {
  const outcome = await reviews.start(pr, { modelProvider, model });
  if (!outcome.started) throw new Error(`The Review didn't start: ${JSON.stringify(outcome)}`);
  return outcome.review;
}

/** Starts a Review and follows its progress to the end, as the page does; resolves with the complete Review. */
export async function completedReview(reviews: Reviews, pr: PullRequestRef, choice?: Partial<ModelChoice>): Promise<Review> {
  const { id } = await startReview(reviews, pr, choice);
  await followReview(reviews, id).rest();
  return reviews.get(id)!;
}

/** Follows a Review's progress, to read its events one at a time. */
export function followReview(reviews: Reviews, id: string) {
  const follower = new AbortController();
  const events = reviews.follow(id, follower.signal);
  if (!events) throw new Error(`No Review ${id} to follow`);
  const iterator = (async function* () {
    yield* events;
  })();

  /** The next event, or undefined once the Review's progress has ended. */
  async function next(): Promise<ReviewEvent | undefined> {
    return (await iterator.next()).value ?? undefined;
  }

  /** Every event from here until the Review's progress ends. */
  async function rest(): Promise<ReviewEvent[]> {
    const remaining: ReviewEvent[] = [];
    for (let event = await next(); event; event = await next()) remaining.push(event);
    return remaining;
  }

  return { next, rest, disconnect: () => follower.abort() };
}
