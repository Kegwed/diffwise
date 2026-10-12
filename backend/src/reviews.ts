import { isOutdated, type FindingKind, type ModelChoice, type PullRequestRef, type Review, type ReviewEvent, type ReviewSummary } from "@diffwise/shared";
import { getReview, listReviews, saveReview, type Database, type ListedReview } from "./db.ts";
import type { Forge } from "./forge.ts";
import { modelUnavailable, type ModelProvider, type ModelUnavailable } from "./model-provider.ts";
import { startReview, type ReviewRun } from "./review-engine.ts";

export interface ReviewsDependencies {
  forge: Forge;
  /** The configured Model Providers a Review can run on. */
  modelProviders: ModelProvider[];
  db: Database;
  /** How long to wait for one Model call before giving up on it; defaults to DEFAULT_MODEL_CALL_TIMEOUT_MS. */
  modelCallTimeoutMs?: number;
}

/** The Review that was started, or why it wasn't: what there isn't that it needed, or a Model Provider that can't be used. */
export type StartOutcome =
  | { started: true; review: Review }
  | { started: false; missing: "model-provider" | "pull-request" }
  | ({ started: false } & ModelUnavailable);

/**
 * Diffwise's Reviews: the complete ones, which are saved, and the running and Unsaved ones, which a restart loses.
 * Whatever reads the Pull Request throws a ForgeAccessError if Diffwise can't read its Repository.
 */
export interface Reviews {
  /** Starts a Review of the Pull Request as it is now. It runs on, whether or not anyone follows it, and is saved once it's complete. */
  start(pullRequest: PullRequestRef, modelChoice: ModelChoice): Promise<StartOutcome>;
  /** The Review as it stands now; undefined if there's no such Review. */
  get(id: string): Review | undefined;
  /**
   * The Pull Request's Reviews, newest first, each Outdated or not against the Pull Request's head commit as it is now;
   * undefined if there's no such Pull Request.
   */
  list(pullRequest: PullRequestRef): Promise<ReviewSummary[] | undefined>;
  /**
   * The Review's progress until it completes, turns out Unsaved, or `signal` aborts: first the Review as it stands, then
   * each change to it, ending with its completion or with it turning out Unsaved. Undefined if there's no such Review.
   */
  follow(id: string, signal?: AbortSignal): AsyncIterable<ReviewEvent> | undefined;
}

export function createReviews({ forge, modelProviders, db, modelCallTimeoutMs }: ReviewsDependencies): Reviews {
  /** The Reviews not saved yet, by id: running, or Unsaved. A restart loses them. */
  const running = new Map<string, ReviewRun>();

  return {
    async start(ref, { modelProvider: modelProviderName, model }) {
      const modelProvider = modelProviders.find((provider) => provider.name === modelProviderName);
      if (!modelProvider) return { started: false, missing: "model-provider" };
      const pullRequest = await forge.getPullRequest(ref);
      if (!pullRequest) return { started: false, missing: "pull-request" };
      const unavailable = await modelUnavailable(modelProvider, model);
      if (unavailable) return { started: false, ...unavailable };
      const run = startReview(pullRequest, model, modelProvider, { modelCallTimeoutMs, save: (review) => saveReview(db, review) });
      const { id } = run.current();
      running.set(id, run);
      // Not awaited: the Review runs on, whether or not anyone follows it.
      run.finished
        .then(() => running.delete(id))
        // An Unsaved Review stays here, so it can still be read until Diffwise restarts.
        .catch((error) => console.error(`Review ${id} wasn't saved:`, error));
      return { started: true, review: run.current() };
    },

    get(id) {
      return running.get(id)?.current() ?? getReview(db, id);
    },

    async list(ref) {
      const pullRequest = await forge.getPullRequestSummary(ref);
      if (!pullRequest) return undefined;
      const unsaved = [...running.values()]
        .map((run) => run.current())
        .filter((review) => isSamePullRequest(review.pullRequest, pullRequest))
        .map(summary);
      const reviews = [...unsaved, ...listReviews(db, pullRequest).map(summary)].sort(newestFirst);
      // Outdated is worked out against the head commit as it is now, so it's never saved.
      return reviews.map((review) => ({ ...review, outdated: isOutdated(review, pullRequest) }));
    },

    follow(id, signal) {
      const run = running.get(id);
      if (run) return run.events(signal);
      const saved = getReview(db, id);
      return saved && completed(saved);
    },
  };
}

/** A saved Review's progress, which has nothing left to wait for: the Review, then its completion. */
async function* completed(review: Review): AsyncGenerator<ReviewEvent> {
  yield { type: "review", review };
  yield { type: "complete" };
}

function isSamePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

/** A Review, running or saved, as a list of Reviews shows it. */
function summary({ id, modelProvider, model, headCommit, createdAt, status, findings }: ListedReview): Omit<ReviewSummary, "outdated"> {
  const count = (kind: FindingKind) => findings.filter((finding) => finding.kind === kind).length;
  return {
    id,
    modelProvider,
    model,
    headCommit,
    createdAt,
    status,
    findingCounts: { "bad-practice": count("bad-practice"), "security-issue": count("security-issue") },
  };
}

function newestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}
