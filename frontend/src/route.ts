import { useSyncExternalStore } from "react";
import type { PullRequestRef, RepositoryRef } from "@diffwise/shared";

/** The view the page's URL fragment asks for. A Pull Request's path mirrors its path on GitHub. */
export type Route =
  | { view: "repositories" }
  | { view: "repository"; repository: RepositoryRef }
  /** `reviewId` names the Review of the Pull Request to show, so a Review can be left and reopened. */
  | { view: "pull-request"; pullRequest: PullRequestRef; reviewId?: string };

export const REPOSITORIES_HREF = "#/";

export function repositoryHref({ owner, repo }: RepositoryRef): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function pullRequestHref(pullRequest: PullRequestRef): string {
  return `${repositoryHref(pullRequest)}/pull/${pullRequest.number}`;
}

export function reviewHref(pullRequest: PullRequestRef, reviewId: string): string {
  return `${pullRequestHref(pullRequest)}/reviews/${encodeURIComponent(reviewId)}`;
}

/** The Pull Request's own page on GitHub. */
export function githubHref({ owner, repo, number }: PullRequestRef): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}`;
}

/** Anything that isn't a Repository's or a Pull Request's fragment is the first view, the Repositories. */
export function parseRoute(hash: string): Route {
  const match = /^#\/([^/]+)\/([^/]+)(?:\/pull\/([1-9]\d*)(?:\/reviews\/([^/]+))?)?\/?$/.exec(hash);
  if (!match) return { view: "repositories" };
  let repository: RepositoryRef;
  let reviewId: string | undefined;
  try {
    repository = { owner: decodeURIComponent(match[1]!), repo: decodeURIComponent(match[2]!) };
    reviewId = match[4] === undefined ? undefined : decodeURIComponent(match[4]);
  } catch {
    return { view: "repositories" };
  }
  return match[3] === undefined
    ? { view: "repository", repository }
    : { view: "pull-request", pullRequest: { ...repository, number: Number(match[3]) }, reviewId };
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current Route, following the browser's back and forward buttons and its links. */
export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
}

export function navigate(href: string) {
  window.location.hash = href;
}
