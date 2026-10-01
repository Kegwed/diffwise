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

export function startReview(pullRequest: PullRequestRef, { modelProvider, model }: ModelChoice): Promise<Review> {
  const body: StartReviewRequest = { pullRequest, modelProvider, model };
  return request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
