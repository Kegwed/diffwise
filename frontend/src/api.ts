import type {
  ApiError,
  GitHubAppStatus,
  ModelChoice,
  ModelProviderListing,
  PullRequestRef,
  PullRequestSummary,
  Review,
  StartReviewRequest,
} from "@diffwise/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => undefined)) as T | ApiError | undefined;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return body as T;
}

export function listPullRequests(): Promise<PullRequestSummary[]> {
  return request("/api/pull-requests");
}

export function getGitHubApp(): Promise<GitHubAppStatus> {
  return request("/api/github-app");
}

/** The Pull Request a pasted GitHub Pull Request URL points at; throws with a message saying what's wrong otherwise. */
export function findPullRequestByUrl(url: string): Promise<PullRequestSummary> {
  return request(`/api/pull-requests/by-url?url=${encodeURIComponent(url)}`);
}

export function listModels(): Promise<ModelProviderListing[]> {
  return request("/api/models");
}

export function startReview(pullRequest: PullRequestRef, { modelProvider, model }: ModelChoice): Promise<Review> {
  const body: StartReviewRequest = { pullRequest, modelProvider, model };
  return request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
