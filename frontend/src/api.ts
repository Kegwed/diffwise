import type { ApiError, PullRequestRef, PullRequestSummary, Review, StartReviewRequest } from "@diffwise/shared";

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

export function startReview(pullRequest: PullRequestRef): Promise<Review> {
  const body: StartReviewRequest = { pullRequest };
  return request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
