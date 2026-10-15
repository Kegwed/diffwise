// The API contract between the Diffwise backend and frontend.

export interface RepositoryRef {
  owner: string;
  repo: string;
}

/** The Repository of Pull Requests that ships with Diffwise, so a Review can be tried without connecting GitHub. */
export const FIXTURE_REPOSITORY: RepositoryRef = { owner: "diffwise-fixtures", repo: "bookshop" };

export function isFixtureRepository({ owner, repo }: RepositoryRef): boolean {
  return owner === FIXTURE_REPOSITORY.owner && repo === FIXTURE_REPOSITORY.repo;
}

/** The Repositories Diffwise can read Pull Requests from. */
export interface RepositoryListing {
  repositories: RepositoryRef[];
  /** Why some Repositories are missing from the listing, when they couldn't be listed (e.g. GitHub can't be reached). */
  unlisted?: string;
}

export interface PullRequestRef extends RepositoryRef {
  number: number;
}

export interface PullRequestSummary extends PullRequestRef {
  title: string;
  author: string;
  headCommit: string;
  /** The branch it would merge into. */
  baseBranch: string;
  /** The branch its changes are on. */
  headBranch: string;
  /** When it last changed, as GitHub records it. */
  updatedAt: string;
}

/** An open Pull Request as its Repository's listing shows it: with its latest Review, if it has any. */
export interface OpenPullRequest extends PullRequestSummary {
  latestReview?: ReviewSummary;
}

/** One file a Pull Request changes, with how many lines it adds and deletes, as GitHub counts them. */
export interface ChangedFileStat {
  path: string;
  additions: number;
  deletions: number;
  /** Whether it's a binary file, which has no lines to count. */
  binary: boolean;
}

/** What the user sees of a Pull Request before starting a Review of it. */
export interface PullRequestDetail extends PullRequestSummary {
  state: "open" | "closed" | "merged";
  /** The files it changes, in the Pull Request's file order. */
  changedFiles: ChangedFileStat[];
}

export const FINDING_KINDS = ["bad-practice", "security-issue"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  file: string;
  /** First line of the range, in the new version of the file. */
  startLine: number;
  /** Last line of the range (inclusive), in the new version of the file. */
  endLine: number;
  title: string;
  explanation: string;
  suggestedFix?: string;
  /** CWE or OWASP identifier, Security Issues only. */
  securityReference?: string;
}

/** What happened to one changed file within a Review. A reviewed file keeps the patch it was reviewed from. */
export type FileOutcome =
  | {
      file: string;
      outcome: "reviewed";
      /** Unified diff hunks, as GitHub reports them. Empty for a Review saved before patches were kept. */
      patch: string;
    }
  | { file: string; outcome: "skipped" | "failed"; reason: string };

/** A Model, on the Model Provider that offers it. */
export interface ModelChoice {
  /** Name of a configured Model Provider, as the Model listing shows it. */
  modelProvider: string;
  model: string;
}

/** A changed file a running Review hasn't settled into a File Outcome yet: waiting its turn, or with the Model now. */
export interface PendingFile {
  file: string;
  state: "queued" | "reviewing";
}

/** Records the Model Provider and Model that ran it. */
export interface Review extends ModelChoice {
  id: string;
  pullRequest: PullRequestRef;
  headCommit: string;
  /** When the Review was started. */
  createdAt: string;
  /** Running until every changed file has its File Outcome and it has been saved; Unsaved if saving it failed. */
  status: "running" | "complete" | "unsaved";
  /** One per changed file settled so far, in the Pull Request's file order. */
  fileOutcomes: FileOutcome[];
  /** The changed files still to settle, in the Pull Request's file order; none once the Review is complete. */
  pendingFiles: PendingFile[];
  /** The Findings in the files settled so far. */
  findings: Finding[];
}

/** A Review as its Pull Request's list of Reviews shows it. */
export interface ReviewSummary extends ModelChoice {
  id: string;
  headCommit: string;
  /** When the Review was started. */
  createdAt: string;
  status: Review["status"];
  /** How many Findings of each kind it reports; so far, while it's running. */
  findingCounts: Record<FindingKind, number>;
  /** How many Findings of each Severity it reports; so far, while it's running. */
  severityCounts: Record<Severity, number>;
  /**
   * While it's running: how many of the files it sends to the Model have their File Outcome, of how many. Skipped files
   * are never sent, so they count in neither.
   */
  progress?: { settled: number; total: number };
  /**
   * Whether the Pull Request's head commit is no longer the Review's. Worked out when the Reviews are listed, never
   * saved; left out when the Pull Request's head commit couldn't be read.
   */
  outdated?: boolean;
}

export interface StartReviewRequest extends ModelChoice {
  pullRequest: PullRequestRef;
}

/** One configured Model Provider in the Model listing: the Models it offers, or why it can't be used. */
export type ModelProviderListing =
  | { modelProvider: string; status: "available"; models: string[] }
  | { modelProvider: string; status: "unavailable"; reason: string };

/** Whether Diffwise's GitHub App has been created, and if so where to install it on Repositories. */
export type GitHubAppStatus =
  | { status: "not-created" }
  | { status: "created"; name: string; htmlUrl: string; installUrl: string };

export interface ApiError {
  error: string;
}

export { isOutdated } from "./outdated.ts";
export { DIFF_MARKERS, parsePatch, type DiffHunk, type DiffLine } from "./patch.ts";
export { applyReviewEvent, endsProgress, type ReviewEvent } from "./review-events.ts";
