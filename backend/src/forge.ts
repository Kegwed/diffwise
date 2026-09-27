import type { PullRequestRef, PullRequestSummary } from "@diffwise/shared";

export interface ChangedFile {
  path: string;
  /** Unified diff hunks for this file, as GitHub reports them. */
  patch: string;
}

/** Everything the Review Engine needs to know about a Pull Request at its head commit. */
export interface PullRequestSnapshot extends PullRequestSummary {
  description: string;
  files: ChangedFile[];
}

/** Where Pull Requests come from (GitHub, or fixtures). */
export interface Forge {
  listPullRequests(): Promise<PullRequestSummary[]>;
  getPullRequest(ref: PullRequestRef): Promise<PullRequestSnapshot | undefined>;
}
