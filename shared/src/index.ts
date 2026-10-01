// The API contract between the Diffwise backend and frontend.

export interface RepositoryRef {
  owner: string;
  repo: string;
}

/** The repositories Diffwise can read Pull Requests from. */
export interface RepositoryListing {
  repositories: RepositoryRef[];
  /** Why some repositories are missing from the listing, when they couldn't be listed (e.g. GitHub can't be reached). */
  unlisted?: string;
}

export interface PullRequestRef extends RepositoryRef {
  number: number;
}

export interface PullRequestSummary extends PullRequestRef {
  title: string;
  author: string;
  headCommit: string;
}

/** What the user sees of a Pull Request before starting a Review of it. */
export interface PullRequestDetail extends PullRequestSummary {
  /** The paths of the files it changes, in the Pull Request's file order. */
  changedFiles: string[];
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
  /** Running until every changed file has its File Outcome. */
  status: "running" | "complete";
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
  /** Whether the Pull Request's head commit is no longer the Review's. Worked out when the Reviews are listed, never saved. */
  outdated: boolean;
}

export interface StartReviewRequest extends ModelChoice {
  pullRequest: PullRequestRef;
}

/** One configured Model Provider in the Model listing: the Models it offers, or why it can't be used. */
export type ModelProviderListing =
  | { modelProvider: string; status: "available"; models: string[] }
  | { modelProvider: string; status: "unavailable"; reason: string };

/** Whether Diffwise's GitHub App has been created, and if so where to install it on repos. */
export type GitHubAppStatus =
  | { status: "not-created" }
  | { status: "created"; name: string; htmlUrl: string; installUrl: string };

export interface ApiError {
  error: string;
}

export { DIFF_MARKERS, parsePatch, type DiffHunk, type DiffLine } from "./patch.ts";
export { applyReviewEvent, type ReviewEvent } from "./review-events.ts";
