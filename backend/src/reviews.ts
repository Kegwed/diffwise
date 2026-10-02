import type { FindingKind, ModelChoice, PullRequestRef, Review, ReviewEvent, ReviewSummary } from "@diffwise/shared";
import { getReview, listReviewSummaries, saveReview, type Database } from "./db.ts";
import type { Forge } from "./forge.ts";
import type { ModelProvider } from "./model-provider.ts";
import { startReview, type ReviewRun } from "./review-engine.ts";

export interface ReviewsDependencies {
  forge: Forge;
  /** The configured Model Providers a Review can run on. */
  modelProviders: ModelProvider[];
  db: Database;
  /** How long to wait for one Model call before giving up on it; defaults to DEFAULT_MODEL_CALL_TIMEOUT_MS. */
  modelCallTimeoutMs?: number;
}

/** The Review that was started, or what there isn't that it needed. */
export type StartOutcome = { started: true; review: Review } | { started: false; missing: "model-provider" | "pull-request" };

/**
 * Diffwise's Reviews: the ones still running, which a restart loses, and the complete ones, which are saved.
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
   * The Review's progress until it completes or `signal` aborts: first the Review as it stands, then each change to
   * it, ending with its completion. Undefined if there's no such Review.
   */
  follow(id: string, signal?: AbortSignal): AsyncIterable<ReviewEvent> | Iterable<ReviewEvent> | undefined;
}

export function createReviews({ forge, modelProviders, db, modelCallTimeoutMs }: ReviewsDependencies): Reviews {
  /** The Reviews still running, by id. They live here until they're complete and saved, so a restart loses them. */
  const running = new Map<string, ReviewRun>();

  return {
    async start(ref, { modelProvider: modelProviderName, model }) {
      const modelProvider = modelProviders.find((provider) => provider.name === modelProviderName);
      if (!modelProvider) return { started: false, missing: "model-provider" };
      const pullRequest = await forge.getPullRequest(ref);
      if (!pullRequest) return { started: false, missing: "pull-request" };
      const run = startReview(pullRequest, model, modelProvider, { modelCallTimeoutMs });
      const { id } = run.current();
      running.set(id, run);
      // Not awaited: the Review runs on, whether or not anyone follows it.
      run.finished
        .then((review) => {
          saveReview(db, review);
          running.delete(id);
        })
        // A Review that couldn't be saved stays here, so it can still be read until Diffwise restarts.
        .catch((error) => console.error(`Review ${id} didn't complete, or wasn't saved:`, error));
      return { started: true, review: run.current() };
    },

    get(id) {
      return running.get(id)?.current() ?? getReview(db, id);
    },

    async list(ref) {
      const pullRequest = await forge.getPullRequest(ref);
      if (!pullRequest) return undefined;
      const unsaved = [...running.values()]
        .map((run) => run.current())
        .filter((review) => isSamePullRequest(review.pullRequest, pullRequest))
        .map(summary);
      const reviews = [...unsaved, ...listReviewSummaries(db, pullRequest)].sort(newestFirst);
      // Outdated is worked out against the head commit as it is now, so it's never saved.
      return reviews.map((review) => ({ ...review, outdated: review.headCommit !== pullRequest.headCommit }));
    },

    follow(id, signal) {
      const run = running.get(id);
      if (run) return run.events(signal);
      const saved = getReview(db, id);
      return saved && [{ type: "review", review: saved }, { type: "complete" }];
    },
  };
}

function isSamePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

/** A Review that isn't saved (it's still running, mostly), as a list of Reviews shows it. */
function summary({ id, modelProvider, model, headCommit, createdAt, status, findings }: Review): Omit<ReviewSummary, "outdated"> {
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
