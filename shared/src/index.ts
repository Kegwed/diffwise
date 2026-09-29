// The API contract between the Diffwise backend and frontend.

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestSummary extends PullRequestRef {
  title: string;
  author: string;
  headCommit: string;
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

/** What happened to one changed file within a Review. */
export type FileOutcome =
  | { file: string; outcome: "reviewed" }
  | { file: string; outcome: "skipped" | "failed"; reason: string };

/** A Model, on the Model Provider that offers it. */
export interface ModelChoice {
  /** Name of a configured Model Provider, as the Model listing shows it. */
  modelProvider: string;
  model: string;
}

/** Records the Model Provider and Model that ran it. */
export interface Review extends ModelChoice {
  id: string;
  pullRequest: PullRequestRef;
  headCommit: string;
  createdAt: string;
  /** One per changed file, in the Pull Request's file order. */
  fileOutcomes: FileOutcome[];
  findings: Finding[];
}

export interface StartReviewRequest extends ModelChoice {
  pullRequest: PullRequestRef;
}

/** One configured Model Provider in the Model listing: the Models it offers, or why it can't be used. */
export type ModelProviderListing =
  | { modelProvider: string; status: "available"; models: string[] }
  | { modelProvider: string; status: "unavailable"; reason: string };

export interface ApiError {
  error: string;
}
