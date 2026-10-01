import { useSyncExternalStore } from "react";
import type { PullRequestRef, RepositoryRef } from "@diffwise/shared";

/** The view the page's URL fragment asks for. A Pull Request's path mirrors its path on GitHub. */
export type Route =
  | { view: "repositories" }
  | { view: "repository"; repository: RepositoryRef }
  | { view: "pull-request"; pullRequest: PullRequestRef };

export const REPOSITORIES_HREF = "#/";

export function repositoryHref({ owner, repo }: RepositoryRef): string {
  return `#/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function pullRequestHref(pullRequest: PullRequestRef): string {
  return `${repositoryHref(pullRequest)}/pull/${pullRequest.number}`;
}

/** Anything that isn't a repository's or a Pull Request's fragment is the first view, the repositories. */
export function parseRoute(hash: string): Route {
  const match = /^#\/([^/]+)\/([^/]+)(?:\/pull\/([1-9]\d*))?\/?$/.exec(hash);
  if (!match) return { view: "repositories" };
  let repository: RepositoryRef;
  try {
    repository = { owner: decodeURIComponent(match[1]!), repo: decodeURIComponent(match[2]!) };
  } catch {
    return { view: "repositories" };
  }
  return match[3] === undefined
    ? { view: "repository", repository }
    : { view: "pull-request", pullRequest: { ...repository, number: Number(match[3]) } };
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
