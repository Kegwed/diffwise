import type { ModelChoice, PullRequestRef, Review, ReviewEvent } from "@diffwise/shared";
import type { createApp } from "../src/app.ts";

type App = ReturnType<typeof createApp>;

export async function startReview(
  app: App,
  pr: PullRequestRef,
  { modelProvider = "Ollama", model = "test-model" }: Partial<ModelChoice> = {},
) {
  return app.request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pullRequest: { owner: pr.owner, repo: pr.repo, number: pr.number }, modelProvider, model }),
  });
}

export async function fetchReview(app: App, id: string): Promise<Review> {
  return (await (await app.request(`/api/reviews/${id}`)).json()) as Review;
}

/** Starts a Review and follows its progress to the end, as the page does; resolves with the complete Review. */
export async function completedReview(app: App, pr: PullRequestRef, choice?: Partial<ModelChoice>): Promise<Review> {
  const { id } = (await (await startReview(app, pr, choice)).json()) as Review;
  await (await followReview(app, id)).rest();
  return fetchReview(app, id);
}

/** Connects to a Review's progress stream, to read its events one at a time. */
export async function followReview(app: App, id: string) {
  const response = await app.request(`/api/reviews/${id}/events`);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  /** The next event, or undefined once the stream has ended. */
  async function next(): Promise<ReviewEvent | undefined> {
    while (!buffered.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffered += value;
    }
    const end = buffered.indexOf("\n\n");
    const message = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    return JSON.parse(message.replace(/^data: /, "")) as ReviewEvent;
  }

  /** Every event from here until the stream ends. */
  async function rest(): Promise<ReviewEvent[]> {
    const events: ReviewEvent[] = [];
    for (let event = await next(); event; event = await next()) events.push(event);
    return events;
  }

  return { response, next, rest, disconnect: () => reader.cancel() };
}
