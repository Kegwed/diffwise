import {
  isOutdated,
  SEVERITIES,
  type FindingKind,
  type ModelChoice,
  type PullRequestRef,
  type PullRequestSummary,
  type RecentReview,
  type Review,
  type ReviewEvent,
  type ReviewSummary,
} from "@diffwise/shared";
import { getReview, listRecentReviews, listReviews, saveReview, type Database, type ListedReview } from "./db.ts";
import { ForgeAccessError, type Forge } from "./forge.ts";
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
   * undefined if there's no such Pull Request. When the head commit can't be read, but Diffwise can read the Repository,
   * they're listed without saying whether they're Outdated.
   */
  list(pullRequest: PullRequestRef): Promise<ReviewSummary[] | undefined>;
  /**
   * The Pull Request's newest Review, Outdated or not against the head commit `pullRequest` already has, so the Pull
   * Request isn't read again; undefined if it has no Reviews.
   */
  latest(pullRequest: PullRequestSummary): ReviewSummary | undefined;
  /**
   * The RECENT_REVIEWS_LIMIT newest Reviews of any Pull Request, running, Unsaved and saved, newest first. Whether each is
   * Outdated isn't worked out, so no Pull Request is read.
   */
  recent(): RecentReview[];
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
      const pullRequest = await forge.getPullRequestSummary(ref).catch((error: unknown) => {
        // Diffwise can't read the Repository, so it mustn't list Reviews of it either.
        if (error instanceof ForgeAccessError) throw error;
        return "unreadable" as const;
      });
      if (!pullRequest) return undefined;
      // The Reviews are still worth seeing when GitHub can't be reached; only whether they're Outdated isn't known.
      if (pullRequest === "unreadable") return reviewsOf(ref);
      // Outdated is worked out against the head commit as it is now, so it's never saved.
      return reviewsOf(pullRequest).map((review) => ({ ...review, outdated: isOutdated(review, pullRequest) }));
    },

    latest(pullRequest) {
      const [newest] = reviewsOf(pullRequest);
      return newest && { ...newest, outdated: isOutdated(newest, pullRequest) };
    },

    recent() {
      const recent = [...inMemoryReviews(), ...listRecentReviews(db, RECENT_REVIEWS_LIMIT)]
        .sort(newestFirst)
        .slice(0, RECENT_REVIEWS_LIMIT);
      return recent.map((review) => ({
        pullRequest: review.pullRequest,
        // Reviews saved before titles were kept have none.
        ...(review.pullRequestTitle !== undefined && { pullRequestTitle: review.pullRequestTitle }),
        ...listedSummary(review),
      }));
    },

    follow(id, signal) {
      const run = running.get(id);
      if (run) return run.events(signal);
      const saved = getReview(db, id);
      return saved && completed(saved);
    },
  };

  /** The Reviews only in memory, which a restart loses: running ones, and Unsaved ones. */
  function inMemoryReviews(): Review[] {
    return [...running.values()].map((run) => run.current());
  }

  /** The Pull Request's Reviews, running, Unsaved and saved, newest first. */
  function reviewsOf(pullRequest: PullRequestRef): ReviewSummary[] {
    const inMemory = inMemoryReviews().filter((review) => isSamePullRequest(review.pullRequest, pullRequest));
    return [...inMemory, ...listReviews(db, pullRequest)].sort(newestFirst).map(listedSummary);
  }
}

/** A saved Review's progress, which has nothing left to wait for: the Review, then its completion. */
async function* completed(review: Review): AsyncGenerator<ReviewEvent> {
  yield { type: "review", review };
  yield { type: "complete" };
}

function isSamePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

/** How many Reviews the recent Reviews list at most. */
const RECENT_REVIEWS_LIMIT = 20;

/** A Review, running or saved, as a list of Reviews shows it, with its progress while it's running. */
function listedSummary(review: Review | ListedReview): ReviewSummary {
  return { ...summary(review), ...("pendingFiles" in review && review.status === "running" && { progress: progress(review) }) };
}

/** A Review, running or saved, as a list of Reviews shows it. */
function summary({ id, modelProvider, model, headCommit, createdAt, status, findings }: ListedReview): ReviewSummary {
  const count = (kind: FindingKind) => findings.filter((finding) => finding.kind === kind).length;
  return {
    id,
    modelProvider,
    model,
    headCommit,
    createdAt,
    status,
    findingCounts: { "bad-practice": count("bad-practice"), "security-issue": count("security-issue") },
    severityCounts: Object.fromEntries(
      SEVERITIES.map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length]),
    ) as ReviewSummary["severityCounts"],
  };
}

/** How far a running Review has got with the files it sends to the Model. */
function progress({ fileOutcomes, pendingFiles }: Review): NonNullable<ReviewSummary["progress"]> {
  // Skipped files are never sent to the Model, so they're neither done nor left to do.
  const settled = fileOutcomes.filter((outcome) => outcome.outcome !== "skipped").length;
  return { settled, total: settled + pendingFiles.length };
}

function newestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}
