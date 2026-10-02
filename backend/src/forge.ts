import type { PullRequestRef, PullRequestSummary, RepositoryListing, RepositoryRef } from "@diffwise/shared";

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
  listRepositories(): Promise<RepositoryListing>;
  /** A Repository's open Pull Requests; throws a ForgeAccessError if Diffwise can't read the Repository. */
  listOpenPullRequests(repository: RepositoryRef): Promise<PullRequestSummary[]>;
  /** Undefined if there's no such Pull Request; throws a ForgeAccessError if Diffwise can't read its Repository. */
  getPullRequest(ref: PullRequestRef): Promise<PullRequestSnapshot | undefined>;
}

/** Diffwise can't read a Repository, e.g. because the GitHub App isn't installed on it. The message says what to do. */
export class ForgeAccessError extends Error {
  override name = "ForgeAccessError";
}
