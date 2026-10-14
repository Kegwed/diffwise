import type { ChangedFileStat, PullRequestDetail, PullRequestRef, PullRequestSummary, RepositoryListing, RepositoryRef } from "@diffwise/shared";

export interface ChangedFile extends ChangedFileStat {
  /** Unified diff hunks for this file, as GitHub reports them; empty when GitHub sends none, as for a binary file. */
  patch: string;
}

/** Everything the Review Engine, and the user before starting a Review, need to know about a Pull Request at its head commit. */
export interface PullRequestSnapshot extends Omit<PullRequestDetail, "changedFiles"> {
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
  /**
   * The Pull Request without its description or changed files, so it's cheaper to read than getPullRequest. Its owner
   * and repo are the Forge's own spelling, whatever case `ref` used. Undefined if there's no such Pull Request; throws a ForgeAccessError if Diffwise can't read its Repository.
   */
  getPullRequestSummary(ref: PullRequestRef): Promise<PullRequestSummary | undefined>;
}

/** Diffwise can't read a Repository, e.g. because the GitHub App isn't installed on it. The message says what to do. */
export class ForgeAccessError extends Error {
  override name = "ForgeAccessError";
}
