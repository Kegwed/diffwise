import type {
  ApiError,
  GitHubAppStatus,
  ModelChoice,
  ModelProviderListing,
  PullRequestDetail,
  PullRequestRef,
  PullRequestSummary,
  RepositoryListing,
  RepositoryRef,
  Review,
  ReviewEvent,
  ReviewSummary,
  StartReviewRequest,
} from "@diffwise/shared";
import { endsProgress } from "@diffwise/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => undefined)) as T | ApiError | undefined;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return body as T;
}

export function listRepositories(): Promise<RepositoryListing> {
  return request("/api/repositories");
}

function repositoryPath({ owner, repo }: RepositoryRef): string {
  return `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function listOpenPullRequests(repository: RepositoryRef): Promise<PullRequestSummary[]> {
  return request(`${repositoryPath(repository)}/pull-requests`);
}

export function getPullRequest(pullRequest: PullRequestRef): Promise<PullRequestDetail> {
  return request(`${repositoryPath(pullRequest)}/pull-requests/${pullRequest.number}`);
}

/** The Pull Request's Reviews, newest first, each saying whether it's Outdated now. */
export function listReviews(pullRequest: PullRequestRef): Promise<ReviewSummary[]> {
  return request(`${repositoryPath(pullRequest)}/pull-requests/${pullRequest.number}/reviews`);
}

export function getGitHubApp(): Promise<GitHubAppStatus> {
  return request("/api/github-app");
}

/** The Pull Request a pasted GitHub Pull Request URL points at; throws with a message saying what's wrong otherwise. */
export function findPullRequestByUrl(url: string): Promise<PullRequestDetail> {
  return request(`/api/pull-requests/by-url?url=${encodeURIComponent(url)}`);
}

export function listModels(): Promise<ModelProviderListing[]> {
  return request("/api/models");
}

/** Starts a Review, which then runs on the backend: resolves right away with the Review, still running. */
export function startReview(pullRequest: PullRequestRef, { modelProvider, model }: ModelChoice): Promise<Review> {
  const body: StartReviewRequest = { pullRequest, modelProvider, model };
  return request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Follows a Review's progress stream until the Review completes: `onEvent` gets the Review as it stands, then each
 * change to it. After a dropped connection the browser reconnects by itself, and the stream starts again from the
 * Review as it then stands. `onLost` gets the reason if the stream can't be followed. Returns a function that stops
 * following.
 */
export function followReview(id: string, onEvent: (event: ReviewEvent) => void, onLost: (reason: string) => void): () => void {
  const path = `/api/reviews/${encodeURIComponent(id)}`;
  const source = new EventSource(`${path}/events`);
  let following = true;
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as ReviewEvent;
    // The stream ends there; left open, the browser would reconnect to it.
    if (endsProgress(event)) source.close();
    onEvent(event);
  };
  source.onerror = () => {
    // Still open means the browser is reconnecting; closed means it gave up, as it does when the backend answers with an error.
    if (source.readyState !== EventSource.CLOSED) return;
    // The stream doesn't say what the error was; asking for the Review does.
    request<Review>(path).then(
      () => following && onLost("Lost the connection to this Review's progress. Reload the page to follow it again."),
      (error: Error) => following && onLost(error.message),
    );
  };
  return () => {
    following = false;
    source.close();
  };
}
